import { NOTE_MAX_BYTES, REQUEST_ID, TASK_ID, type FirstmateAdapter } from '../firstmate/adapter';
import type { InboxReceipt, InboxReceipts } from '../firstmate/contracts';
import { isChangeRequest } from '../firstmate/changes';
import type { BridgeMessage, MessagesView } from '../../types';
import type { MessageStore, StoredMessage } from './store';

/**
 * Sending messages to Firstmate and keeping their receipts current.
 *
 * Every message carries a stable request id (the client's Idempotency-Key). It
 * is recorded locally before `fm-inbox.sh note` runs, and every later attempt
 * reuses it, so Firstmate's own request-id replay guarantees that retries and
 * reconciliation never create a second note.
 *
 * Delivery (does Firstmate have it) and acknowledgement (did Firstmate drain
 * it) are tracked separately. A send that cannot be confirmed (a timeout, or
 * output Wheelhouse could not read) is `uncertain`; a saved note whose wake
 * failed (exit 3) is `saved-unannounced`. Both are re-issued with the original
 * request id on a backoff until Firstmate confirms them: a replay repairs the
 * wake and reports the note it already has.
 *
 * A change request about a task carries a routing line under it (the `route`
 * option, see changeRoute), decided once when it is first sent and kept in the
 * body every retry reuses.
 */

export const VIEW_MAX_MESSAGES = 200;
/** Room kept in a change request about a task for its routing line. */
export const ROUTE_ALLOWANCE_BYTES = 1024;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const RETRIES_PER_ROUND = 5;
const REPLY_PAGES_PER_ROUND = 10;

export type SendInput = { requestId: string; text: string; taskId: string | null };

export type SendResult =
	| { ok: true; created: boolean; message: BridgeMessage }
	| { ok: false; status: 400 | 413 | 422 | 503; error: string };

export interface MessengerOptions {
	adapter: FirstmateAdapter;
	store: MessageStore;
	/** Why messaging is off (incompatible inbox script); null when it is on. */
	unavailable?: string | null;
	/** Where a change request about the task should go, for Firstmate; null adds nothing. */
	route?: (taskId: string) => string | null;
	now?: () => number;
	retryBaseMs?: number;
	retryMaxMs?: number;
}

/** The body written to Firstmate: task context travels as a `Re: <task-id>` prefix. */
export function noteBody(text: string, taskId: string | null): string {
	return taskId ? `Re: ${taskId}\n${text}` : text;
}

export function toBridgeMessage(m: StoredMessage): BridgeMessage {
	return {
		requestId: m.requestId,
		text: m.text,
		taskId: m.taskId,
		submittedAt: m.submittedAt,
		delivery: m.delivery,
		deliveryDetail: m.deliveryDetail,
		acknowledged: m.acknowledged,
		noteId: m.noteId,
		reply: m.reply ? { body: m.reply.body, at: m.reply.at } : null
	};
}

const UNANNOUNCED =
	'Firstmate has the message but was not woken for it yet. Wheelhouse will retry.';
const UNCERTAIN = 'Wheelhouse could not confirm delivery. It is checking with the same request id.';

/** Validate a send request; returns the normalised input or why it is refused. */
export function validateSend(
	requestId: string | null,
	text: unknown,
	taskId: unknown
): { ok: true; input: SendInput } | { ok: false; status: 400 | 413; error: string } {
	if (!requestId)
		return { ok: false, status: 400, error: 'An Idempotency-Key header is required.' };
	if (!REQUEST_ID.test(requestId)) {
		return {
			ok: false,
			status: 400,
			error: 'The Idempotency-Key must be 1-128 characters of A-Z a-z 0-9 . _ : - (no leading dot).'
		};
	}
	if (typeof text !== 'string' || !text.trim()) {
		return { ok: false, status: 400, error: 'The message is empty.' };
	}
	if (
		taskId !== undefined &&
		taskId !== null &&
		(typeof taskId !== 'string' || !TASK_ID.test(taskId))
	) {
		return { ok: false, status: 400, error: 'The task id is not valid.' };
	}
	const input: SendInput = {
		requestId,
		text: text.trim(),
		taskId: (taskId as string | null) ?? null
	};
	const room = isChangeRequest(input) ? ROUTE_ALLOWANCE_BYTES : 0;
	if (Buffer.byteLength(noteBody(input.text, input.taskId)) > NOTE_MAX_BYTES - room) {
		return { ok: false, status: 413, error: `Messages are limited to ${NOTE_MAX_BYTES} bytes.` };
	}
	return { ok: true, input };
}

export class Messenger {
	private adapter: FirstmateAdapter;
	private store: MessageStore;
	private unavailable: string | null;
	private route: (taskId: string) => string | null;
	private now: () => number;
	private retryBaseMs: number;
	private retryMaxMs: number;
	private inflight = new Map<string, Promise<void>>();
	private listeners = new Set<(v: MessagesView) => void>();
	private reconciling: Promise<void> | null = null;
	private receiptsAt: string | null = null;
	private receiptsError: string | null = null;
	private storeError: string | null = null;
	private lastEmitted = '';

	constructor(opts: MessengerOptions) {
		this.adapter = opts.adapter;
		this.store = opts.store;
		this.unavailable = opts.unavailable ?? null;
		this.route = opts.route ?? (() => null);
		this.now = opts.now ?? Date.now;
		this.retryBaseMs = opts.retryBaseMs ?? RETRY_BASE_MS;
		this.retryMaxMs = opts.retryMaxMs ?? RETRY_MAX_MS;
	}

	get storeFile(): string {
		return this.store.file;
	}

	get available(): boolean {
		return this.unavailable === null;
	}

	get reason(): string | null {
		return this.unavailable;
	}

	view(): MessagesView {
		return {
			schema: 'wheelhouse-messages.v1',
			available: this.available,
			reason: this.unavailable,
			messages: this.store.messages().slice(-VIEW_MAX_MESSAGES).map(toBridgeMessage),
			receiptsAt: this.receiptsAt,
			receiptsError: this.receiptsError,
			storeError: this.storeError
		};
	}

	/** Every change request sent about a task, however old: the record its runs are read from. */
	changeRequests(): BridgeMessage[] {
		return this.store.messages().filter(isChangeRequest).map(toBridgeMessage);
	}

	subscribe(fn: (v: MessagesView) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private iso(): string {
		return new Date(this.now()).toISOString();
	}

	private emit(): void {
		const v = this.view();
		const key = JSON.stringify(v);
		if (key === this.lastEmitted) return;
		this.lastEmitted = key;
		for (const fn of this.listeners) {
			try {
				fn(v);
			} catch {
				// a broken subscriber must not stop messaging
			}
		}
	}

	/** Write the store; returns why it failed, or null. The in-memory state is kept either way. */
	private async save(): Promise<string | null> {
		try {
			await this.store.save();
			this.storeError = null;
		} catch (e) {
			this.storeError = `Wheelhouse could not write its message record (${this.store.file}): ${(e as Error).message}`;
		}
		return this.storeError;
	}

	private async persist(): Promise<void> {
		await this.save();
		this.emit();
	}

	/**
	 * Send a message, or return the one already sent with this request id. A
	 * repeat whose earlier attempt failed or is unconfirmed is retried now with
	 * the same request id; a repeat with different content is refused.
	 */
	async send(input: SendInput): Promise<SendResult> {
		if (this.unavailable) return { ok: false, status: 503, error: this.unavailable };
		const existing = this.store.get(input.requestId);
		if (existing) {
			if (existing.text !== input.text || existing.taskId !== input.taskId) {
				return {
					ok: false,
					status: 422,
					error: 'This Idempotency-Key was already used for a different message.'
				};
			}
			if (existing.delivery !== 'delivered') await this.deliver(existing, true);
			return { ok: true, created: false, message: toBridgeMessage(existing) };
		}
		const route = input.taskId && isChangeRequest(input) ? this.route(input.taskId) : null;
		const body = noteBody(input.text, input.taskId) + (route ? `\n\n${route}` : '');
		const m: StoredMessage = {
			requestId: input.requestId,
			text: input.text,
			taskId: input.taskId,
			body,
			submittedAt: this.iso(),
			delivery: 'sending',
			deliveryDetail: null,
			noteId: null,
			acknowledged: null,
			announced: null,
			reply: null,
			attempts: 0,
			lastAttemptAt: null
		};
		this.store.add(m);
		// Recorded before Firstmate sees it, so a crash mid-send is reconciled later.
		const failed = await this.save();
		if (failed) {
			this.store.remove(m.requestId);
			this.emit();
			return {
				ok: false,
				status: 503,
				error: `Wheelhouse could not record the message in its state directory, so it did not send it. ${failed}`
			};
		}
		this.emit();
		await this.deliver(m, true);
		return { ok: true, created: true, message: toBridgeMessage(m) };
	}

	/** Run `note` for a message; concurrent callers for one request id share the run. */
	private deliver(m: StoredMessage, visible: boolean): Promise<void> {
		const running = this.inflight.get(m.requestId);
		if (running) return running;
		const p = this.attempt(m, visible).finally(() => this.inflight.delete(m.requestId));
		this.inflight.set(m.requestId, p);
		return p;
	}

	private async attempt(m: StoredMessage, visible: boolean): Promise<void> {
		m.attempts++;
		m.lastAttemptAt = this.iso();
		if (visible && m.delivery !== 'sending') {
			m.delivery = 'sending';
			m.deliveryDetail = null;
			this.emit();
		}
		const r = await this.adapter.note(m.requestId, m.body);
		if (r.ok) {
			const n = r.value;
			m.noteId = n.noteId;
			m.announced = n.announced;
			if (n.acknowledged) m.acknowledged = true;
			// announced null only describes notes older than Firstmate's announce marker,
			// which woke Firstmate when they were written.
			if (n.announced === false && !n.acknowledged) {
				m.delivery = 'saved-unannounced';
				m.deliveryDetail = UNANNOUNCED;
			} else {
				m.delivery = 'delivered';
				m.deliveryDetail = null;
			}
		} else {
			const e = r.error;
			// exit 1 means nothing was saved; a bad argument or a missing script never ran.
			const refused =
				e.kind === 'exit' ||
				e.kind === 'invalid-argument' ||
				e.kind === 'missing-script' ||
				e.kind === 'spawn-error';
			m.delivery = refused ? 'failed' : 'uncertain';
			m.deliveryDetail = refused ? `Firstmate did not take the message: ${e.message}` : UNCERTAIN;
		}
		await this.persist();
	}

	private retryDue(m: StoredMessage): boolean {
		if (m.delivery !== 'uncertain' && m.delivery !== 'saved-unannounced') return false;
		if (this.inflight.has(m.requestId)) return false;
		if (!m.lastAttemptAt) return true;
		const wait = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.max(0, m.attempts - 1));
		return this.now() - Date.parse(m.lastAttemptAt) >= wait;
	}

	/** One reconciliation round (the collector runs one per tick). Concurrent callers share it. */
	reconcile(): Promise<void> {
		this.reconciling ??= this.reconcileOnce().finally(() => (this.reconciling = null));
		return this.reconciling;
	}

	private async reconcileOnce(): Promise<void> {
		if (this.unavailable || this.store.messages().length === 0) return;
		const due = this.store
			.messages()
			.filter((m) => this.retryDue(m))
			.slice(0, RETRIES_PER_ROUND);
		for (const m of due) await this.deliver(m, false);

		const first = await this.adapter.receipts({ after: this.store.receiptCursor });
		if (!first.ok) {
			this.receiptsError = first.error.message;
			this.emit();
			return;
		}
		let changed = false;
		const seen = new Set<string>();
		changed = this.applyNotes(first.value, seen) || changed;
		changed = (await this.applyReplies(first.value)) || changed;

		// A note we still need may sit beyond receipts' default bounds.
		const omittedNotes = first.value.omitted.some((o) => /pending|handled/.test(o.surface));
		const missing = this.store.messages().some((m) => this.open(m) && !seen.has(m.requestId));
		if (omittedNotes && missing) {
			const all = await this.adapter.receipts({ after: this.store.receiptCursor, allNotes: true });
			if (all.ok) changed = this.applyNotes(all.value, seen) || changed;
		}

		this.receiptsAt = this.iso();
		this.receiptsError = null;
		if (changed) await this.persist();
		else this.emit();
	}

	/** A message whose receipt can still change. */
	private open(m: StoredMessage): boolean {
		return m.delivery !== 'failed' && m.delivery !== 'sending' && !(m.acknowledged && m.reply);
	}

	private applyNotes(r: InboxReceipts, seen: Set<string>): boolean {
		const byRequest = new Map<string, InboxReceipt>();
		const byNote = new Map<string, InboxReceipt>();
		for (const n of [...r.pending, ...r.handled]) {
			if (n.requestId) byRequest.set(n.requestId, n);
			byNote.set(n.noteId, n);
		}
		let changed = false;
		for (const m of this.store.messages()) {
			if (m.delivery === 'sending') continue;
			const n = byRequest.get(m.requestId) ?? (m.noteId ? byNote.get(m.noteId) : undefined);
			if (!n) continue;
			seen.add(m.requestId);
			const before = JSON.stringify(m);
			m.noteId = n.noteId;
			m.acknowledged = n.acknowledged;
			if (n.announced !== null) m.announced = n.announced;
			// Firstmate has it: it was announced, drained, or predates announce markers.
			if (n.acknowledged || n.announced !== false) {
				m.delivery = 'delivered';
				m.deliveryDetail = null;
			} else if (m.delivery !== 'saved-unannounced') {
				m.delivery = 'saved-unannounced';
				m.deliveryDetail = UNANNOUNCED;
			}
			if (n.reply) m.reply = { body: n.reply.body, at: n.reply.at, cursor: n.reply.cursor };
			if (JSON.stringify(m) !== before) changed = true;
		}
		return changed;
	}

	/** Attach replies after the stored cursor and advance it, paging past the bound. */
	private async applyReplies(first: InboxReceipts): Promise<boolean> {
		let page: InboxReceipts = first;
		let changed = false;
		for (let i = 0; i < REPLY_PAGES_PER_ROUND; i++) {
			for (const reply of page.replies) {
				const m = this.store.messages().find((x) => x.noteId === reply.noteId);
				if (m && m.reply?.cursor !== reply.cursor) {
					m.reply = { body: reply.body, at: reply.at, cursor: reply.cursor };
					changed = true;
				}
			}
			if (page.replyCursor && page.replyCursor !== this.store.receiptCursor) {
				this.store.receiptCursor = page.replyCursor;
				changed = true;
			}
			if (!page.omitted.some((o) => /replies omitted/.test(o.surface))) break;
			const next = await this.adapter.receipts({ after: this.store.receiptCursor });
			if (!next.ok) break;
			page = next.value;
		}
		return changed;
	}
}
