import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DECIDED_MAX } from '../../decisionform';
import {
	CHOICES,
	DECIDED_LABEL,
	NOTE_MAX,
	answerText,
	choiceLabel,
	closeText,
	followKey,
	followingFor,
	picksLine,
	type InboxCard,
	type InboxChoice,
	type InboxDoc,
	type InboxView,
	type Picks
} from '../../inbox';
import { isInside } from '../store/store';
import type { AnsweredLog } from './answered';
import { followableId, type FollowingLog } from './following';
import type { Messenger, SendResult } from '../store/messenger';
import { validateSend } from '../store/messenger';
import { FindingsFiles, buildInbox, findingsWanted, inboxView, type InboxSources } from './cards';

/**
 * The decision inbox over the collector's records: `view` builds the cards,
 * `answer` sends one card's answer, or the captain's dismissal, to Firstmate as
 * an ordinary message (the messenger runs `fm-inbox.sh note`, with the request
 * id as its idempotency key), so an answer reaches the worker only the way
 * Firstmate relays it, and a dismissal reaches Firstmate's record of the
 * decision only through Firstmate closing it. Each answer Firstmate's inbox takes
 * is also recorded in the answered log (when there is one), which the view
 * carries so the chat can show a decision's answer after the card has gone.
 * `follow` marks a task's decision as being followed up with Firstmate in the
 * main chat (the following log), which every view then carries on its cards.
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
	/** The decisions being followed up in the main chat; null keeps none. */
	following?: FollowingLog | null;
}

export type AnswerResult = SendResult | { ok: false; status: 404 | 409; error: string };

/** The largest report the inbox serves. */
export const MAX_REPORT_BYTES = 1024 * 1024;

/** The documents listed from a task's data folder: Markdown files and patches. */
const DOC_FILE = /\.(?:md|patch)$/i;
/** At most this many documents on one card. */
const MAX_DOCS = 12;

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
		await Promise.all(cards.map((c) => this.locateDocs(c)));
		const following = this.deps.following;
		if (following) {
			if (src.read !== false) await following.retain(new Set(cards.map(followKey))).catch(() => {});
			for (const c of cards) c.following = followingFor(following.get(followKey(c)), c.askedAt);
		}
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

	/** A path the Firstmate home names (`data/<task>/x.md`) as a file inside its data folder, or null. */
	private dataFile(named: string): string | null {
		const data = this.deps.dataDir();
		const file = path.resolve(path.dirname(data), named);
		return isInside(file, data) ? file : null;
	}

	/** A readable document file: a Markdown file or a patch inside the data folder, small enough to show. */
	private async readable(named: string): Promise<string | null> {
		if (!DOC_FILE.test(named)) return null;
		const file = this.dataFile(named);
		if (!file) return null;
		const st = await stat(file).catch(() => null);
		return st?.isFile() && st.size <= MAX_REPORT_BYTES ? file : null;
	}

	/**
	 * The documents a card rests on, each served by the inbox's reader: the
	 * report its question names, then the Markdown files and patches in the data
	 * folders of its task and of the task it came from.
	 */
	private async locateDocs(card: InboxCard) {
		const url = (p: string) =>
			`/api/inbox/report?card=${encodeURIComponent(card.id)}&path=${encodeURIComponent(p)}`;
		const r = card.evidence.report;
		const docs: InboxDoc[] = [];
		if (r) {
			const found = r.path.endsWith('.md') && !!(await this.readable(r.path));
			r.url = found ? `/api/inbox/report?card=${encodeURIComponent(card.id)}` : null;
			docs.push({ path: r.path, kind: 'report', url: found ? url(r.path) : null });
		}
		const folders = [card.secondMate ? null : card.taskId, card.origin].filter(
			(id): id is string => !!id && followableId(id)
		);
		for (const id of new Set(folders)) {
			const dir = this.dataFile(path.join('data', id));
			if (!dir) continue;
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			const names = entries
				.filter((e) => e.isFile() && DOC_FILE.test(e.name) && !e.name.startsWith('.'))
				.map((e) => e.name)
				.sort(
					(a, b) => Number(b === 'report.md') - Number(a === 'report.md') || a.localeCompare(b)
				);
			for (const name of names) {
				const p = `data/${id}/${name}`;
				if (docs.length >= MAX_DOCS || docs.some((d) => d.path === p)) continue;
				if (!(await this.readable(p))) continue;
				docs.push({
					path: p,
					kind: /\.patch$/i.test(name) ? 'patch' : name === 'report.md' ? 'report' : 'doc',
					url: url(p)
				});
			}
		}
		card.evidence.docs = docs;
	}

	/**
	 * A document an open card rests on (`path`, one its docs list), else the
	 * report it names: the file, or null when there is none to show.
	 */
	async reportFile(cardId: string, named: string | null = null): Promise<string | null> {
		const card = (await this.view()).cards.find((c) => c.id === cardId);
		if (!card) return null;
		if (named === null) {
			const r = card.evidence.report?.path;
			return r && r.endsWith('.md') ? this.readable(r) : null;
		}
		const doc = card.evidence.docs.find((d) => d.path === named && d.url);
		return doc ? this.readable(doc.path) : null;
	}

	/**
	 * Mark a task's decision as being followed up with Firstmate in the main
	 * chat (`on`), or put it back to waiting. Only a task with an open question
	 * can be followed up; putting one back always works.
	 */
	async follow(body: {
		taskId?: unknown;
		following?: unknown;
	}): Promise<
		{ ok: true; following: string | null } | { ok: false; status: 400 | 404 | 503; error: string }
	> {
		const log = this.deps.following;
		if (!log) return { ok: false, status: 503, error: 'Wheelhouse cannot keep this here.' };
		if (!followableId(body.taskId)) return { ok: false, status: 400, error: 'Name the task.' };
		if (typeof body.following !== 'boolean') {
			return { ok: false, status: 400, error: 'Say whether you are following it up.' };
		}
		const taskId = body.taskId;
		if (!body.following) {
			await log.unfollow(taskId).catch(() => {});
			return { ok: true, following: null };
		}
		const view = await this.view();
		if (!view.cards.some((c) => followKey(c) === taskId)) {
			return {
				ok: false,
				status: 404,
				error: 'This question is no longer open; Firstmate may have settled it already.'
			};
		}
		await log.follow(taskId, new Date().toISOString()).catch(() => {});
		return { ok: true, following: log.get(taskId) };
	}

	/**
	 * Answer one open card, or dismiss it (`choice: close`, with the captain's
	 * reason as the note). A card that is no longer open is
	 * refused (404), so an answer never lands on a question Firstmate already
	 * closed; the same request id repeats the original message rather than
	 * sending a second one.
	 */
	async answer(
		requestId: string | null,
		body: {
			cardId?: unknown;
			choice?: unknown;
			note?: unknown;
			picks?: unknown;
			decided?: unknown;
		}
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
			return { ok: false, status: 400, error: 'Choose Approve, Fix or Skip, or dismiss it.' };
		}
		if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
			return { ok: false, status: 400, error: 'The note must be text.' };
		}
		const picks = picksOf(body.picks);
		if (picks === null) {
			return { ok: false, status: 400, error: 'Send the picks as option ids by call.' };
		}
		if (body.decided !== undefined && body.decided !== null && typeof body.decided !== 'string') {
			return { ok: false, status: 400, error: 'Send what was decided as text.' };
		}
		const decided =
			typeof body.decided === 'string' ? body.decided.replace(/\s+/g, ' ').trim() : '';
		if (decided.length > DECIDED_MAX) {
			return {
				ok: false,
				status: 413,
				error: `What was decided is limited to ${DECIDED_MAX} characters.`
			};
		}
		if (decided && body.choice !== 'approve') {
			return { ok: false, status: 400, error: 'A decided answer goes with Approve.' };
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
		const choice = body.choice as InboxChoice;
		let line: string | null = null;
		// Approving a card with choices sends the picks (the recommended ones where none was made).
		if (decided) line = decided;
		else if (choice === 'approve' && card.choices) {
			const p = picksLine(card.choices, picks ?? {});
			if (!p.ok) return { ok: false, status: 400, error: p.error };
			line = p.line;
		}
		const text = closing
			? closeText(card, note || null)
			: answerText(card, choice, note || null, decided ? null : line, decided || null);
		const valid = validateSend(requestId, text, card.taskId);
		if (!valid.ok) return valid;
		const sent = await messenger.send(valid.input);
		if (sent.ok && sent.message.delivery !== 'failed') {
			// Answered or dismissed: no longer being followed up. Either stands whether or not a log is written.
			await this.deps.following?.unfollow(followKey(card)).catch(() => {});
			await this.deps.answered
				?.record({
					requestId: sent.message.requestId,
					cardId: card.id,
					taskId: card.taskId,
					taskTitle: card.taskTitle,
					projectId: card.projectId,
					kind: card.kind,
					key: card.key,
					question: card.title,
					askedAt: card.askedAt,
					choice: closing ? 'close' : choice,
					label: decided ? DECIDED_LABEL : choiceLabel(card, closing ? 'close' : choice),
					picks: line,
					note: note || null,
					answeredAt: sent.message.submittedAt
				})
				.catch(() => {});
		}
		return sent;
	}
}
