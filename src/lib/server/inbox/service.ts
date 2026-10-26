import { CHOICES, NOTE_MAX, answerText, type InboxChoice, type InboxView } from '../../inbox';
import type { Messenger, SendResult } from '../store/messenger';
import { validateSend } from '../store/messenger';
import { FindingsFiles, buildInbox, findingsWanted, inboxView, type InboxSources } from './cards';

/**
 * The decision inbox over the collector's records: `view` builds the cards,
 * `answer` sends one card's answer to Firstmate as an ordinary message (the
 * messenger runs `fm-inbox.sh note`, with the request id as its idempotency
 * key), so an answer reaches the worker only the way Firstmate relays it.
 */

export interface InboxDeps {
	/** Everything buildInbox needs except the findings files, which this service reads. */
	sources: () => Omit<InboxSources, 'findings'>;
	dataDir: () => string;
	messenger: Messenger | null;
	/** Why answering is off, when there is no messenger. */
	unavailable: () => string | null;
}

export type AnswerResult = SendResult | { ok: false; status: 404 | 409; error: string };

export class InboxService {
	private files: FindingsFiles;

	constructor(private deps: InboxDeps) {
		this.files = new FindingsFiles(deps.dataDir);
	}

	async view(): Promise<InboxView> {
		const src = this.deps.sources();
		await this.files.load(findingsWanted(src.tasks, src.row, src.ledger));
		const cards = buildInbox({ ...src, findings: (t, f) => this.files.get(t, f) });
		const reason = this.deps.messenger
			? this.deps.messenger.reason
			: (this.deps.unavailable() ?? 'Messaging is not set up.');
		return inboxView(cards, !!this.deps.messenger?.available, reason);
	}

	/**
	 * Answer one open card. A card that is no longer open is refused (404), so
	 * an answer never lands on a question Firstmate already closed; the same
	 * request id repeats the original message rather than sending a second one.
	 */
	async answer(
		requestId: string | null,
		body: { cardId?: unknown; choice?: unknown; note?: unknown }
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
		if (typeof body.choice !== 'string' || !CHOICES.includes(body.choice as InboxChoice)) {
			return { ok: false, status: 400, error: 'Choose Approve, Fix or Skip.' };
		}
		if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
			return { ok: false, status: 400, error: 'The note must be text.' };
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
		const valid = validateSend(
			requestId,
			answerText(card, body.choice as InboxChoice, note || null),
			card.taskId
		);
		if (!valid.ok) return valid;
		return messenger.send(valid.input);
	}
}
