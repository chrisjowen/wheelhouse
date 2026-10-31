import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
	CHOICES,
	NOTE_MAX,
	answerText,
	choiceLabel,
	closable,
	closeText,
	picksLine,
	type InboxCard,
	type InboxChoice,
	type InboxView,
	type Picks
} from '../../inbox';
import { isInside } from '../store/store';
import type { AnsweredLog } from './answered';
import type { Messenger, SendResult } from '../store/messenger';
import { validateSend } from '../store/messenger';
import { FindingsFiles, buildInbox, findingsWanted, inboxView, type InboxSources } from './cards';

/**
 * The decision inbox over the collector's records: `view` builds the cards,
 * `answer` sends one card's answer, or the captain's close, to Firstmate as an
 * ordinary message (the messenger runs `fm-inbox.sh note`, with the request id
 * as its idempotency key), so an answer reaches the worker only the way
 * Firstmate relays it, and a close reaches Firstmate's record of the decision
 * only through Firstmate resolving its key. Each answer Firstmate's inbox takes
 * is also recorded in the answered log (when there is one), which the view
 * carries so the chat can show a decision's answer after the card has gone.
 */

export interface InboxDeps {
	/** Everything buildInbox needs except the findings files, which this service reads. */
	sources: () => Omit<InboxSources, 'findings'>;
	dataDir: () => string;
	messenger: Messenger | null;
	/** Why answering is off, when there is no messenger. */
	unavailable: () => string | null;
	/** The answers recorded for the chat; null keeps none. */
	answered?: AnsweredLog | null;
}

export type AnswerResult = SendResult | { ok: false; status: 404 | 409; error: string };

/** The largest report the inbox serves. */
export const MAX_REPORT_BYTES = 1024 * 1024;

/** The picks an answer carries: call id to option id (or written words). */
function picksOf(v: unknown): Picks | null | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== 'object' || Array.isArray(v)) return null;
	const entries = Object.entries(v);
	if (entries.length > 50 || entries.some(([, x]) => typeof x !== 'string')) return null;
	return Object.fromEntries(entries) as Picks;
}

export class InboxService {
	private files: FindingsFiles;

	constructor(private deps: InboxDeps) {
		this.files = new FindingsFiles(deps.dataDir);
	}

	async view(): Promise<InboxView> {
		const src = this.deps.sources();
		await this.files.load(findingsWanted(src.tasks, src.row, src.ledger));
		const cards = buildInbox({ ...src, findings: (t, f) => this.files.get(t, f) });
		await Promise.all(cards.map((c) => this.locateReport(c)));
		const reason = this.deps.messenger
			? this.deps.messenger.reason
			: (this.deps.unavailable() ?? 'Messaging is not set up.');
		const view = inboxView(cards, !!this.deps.messenger?.available, reason);
		const log = this.deps.answered;
		if (log) {
			const delivery = new Map(src.messages.map((m) => [m.requestId, m.delivery]));
			view.answered = log
				.list()
				.map((r) => ({ ...r, delivery: delivery.get(r.requestId) ?? null }));
		}
		return view;
	}

	/**
	 * The file of the report an open card names: only a Markdown file inside
	 * Firstmate's data folder, small enough to show.
	 */
	private async reportPath(card: InboxCard): Promise<string | null> {
		const named = card.evidence.report?.path;
		if (!named || !named.endsWith('.md')) return null;
		const data = this.deps.dataDir();
		const file = path.resolve(path.dirname(data), named);
		if (!isInside(file, data)) return null;
		const st = await stat(file).catch(() => null);
		return st?.isFile() && st.size <= MAX_REPORT_BYTES ? file : null;
	}

	private async locateReport(card: InboxCard) {
		const r = card.evidence.report;
		if (!r) return;
		r.url = (await this.reportPath(card))
			? `/api/inbox/report?card=${encodeURIComponent(card.id)}`
			: null;
	}

	/** The report file an open card names, or null when there is none to show. */
	async reportFile(cardId: string): Promise<string | null> {
		const card = (await this.view()).cards.find((c) => c.id === cardId);
		return card ? this.reportPath(card) : null;
	}

	/**
	 * Answer one open card, or close it (`choice: close`, only on a card
	 * Firstmate keeps under a decision key). A card that is no longer open is
	 * refused (404), so an answer never lands on a question Firstmate already
	 * closed; the same request id repeats the original message rather than
	 * sending a second one.
	 */
	async answer(
		requestId: string | null,
		body: { cardId?: unknown; choice?: unknown; note?: unknown; picks?: unknown }
	): Promise<AnswerResult> {
		const messenger = this.deps.messenger;
		if (!messenger) {
			return {
				ok: false,
				status: 503,
				error: this.deps.unavailable() ?? 'Messaging is not set up.'
			};
		}
		if (typeof body.cardId !== 'string' || !body.cardId) {
			return { ok: false, status: 400, error: 'Name the card to answer.' };
		}
		const closing = body.choice === 'close';
		if (
			!closing &&
			(typeof body.choice !== 'string' || !CHOICES.includes(body.choice as InboxChoice))
		) {
			return { ok: false, status: 400, error: 'Choose Approve, Fix or Skip, or close it.' };
		}
		if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
			return { ok: false, status: 400, error: 'The note must be text.' };
		}
		const picks = picksOf(body.picks);
		if (picks === null) {
			return { ok: false, status: 400, error: 'Send the picks as option ids by call.' };
		}
		const note = typeof body.note === 'string' ? body.note.trim() : '';
		if (note.length > NOTE_MAX) {
			return { ok: false, status: 413, error: `Notes are limited to ${NOTE_MAX} characters.` };
		}
		const view = await this.view();
		const card = view.cards.find((c) => c.id === body.cardId);
		if (!card) {
			return {
				ok: false,
				status: 404,
				error: 'This question is no longer open; Firstmate may have settled it already.'
			};
		}
		if (closing && !closable(card)) {
			return { ok: false, status: 400, error: 'This one closes when you answer it.' };
		}
		const choice = body.choice as InboxChoice;
		let line: string | null = null;
		// Approving a card with choices sends the picks (the recommended ones where none was made).
		if (choice === 'approve' && card.choices) {
			const p = picksLine(card.choices, picks ?? {});
			if (!p.ok) return { ok: false, status: 400, error: p.error };
			line = p.line;
		}
		const text = closing
			? closeText(card, note || null)
			: answerText(card, choice, note || null, line);
		const valid = validateSend(requestId, text, card.taskId);
		if (!valid.ok) return valid;
		const sent = await messenger.send(valid.input);
		if (sent.ok && sent.message.delivery !== 'failed') {
			// The answer stands whether or not the log can be written.
			await this.deps.answered
				?.record({
					requestId: sent.message.requestId,
					cardId: card.id,
					taskId: card.taskId,
					taskTitle: card.taskTitle,
					projectId: card.projectId,
					kind: card.kind,
					key: card.key,
					question: card.choices?.intro || card.question,
					askedAt: card.askedAt,
					choice: closing ? 'close' : choice,
					label: choiceLabel(card, closing ? 'close' : choice),
					picks: line,
					note: note || null,
					answeredAt: sent.message.submittedAt
				})
				.catch(() => {});
		}
		return sent;
	}
}
