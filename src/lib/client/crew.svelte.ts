import { fold, type Chat } from '$lib/chat/fold';
import { SESSION_HEADER } from '$lib/client/messages';
import { watchedStream, type Connection } from '$lib/client/stream';
import type { CrewKind } from '$lib/crew';
import type { FirstmateSessionView, TranscriptSource } from '$lib/types';
import type { ActionResult } from './chat.svelte';

/**
 * A crew discussion's page side (lib/crew.ts): opening and ending one, sending
 * the captain's messages to the worker, and the worker's own conversation as
 * it streams from /api/tasks/<id>/chat. The discussions themselves, with each
 * message's receipts, arrive live on the shared stream (live.crew).
 */

/** The most records a discussion keeps (the server keeps as many for pages that connect later). */
const MAX_RECORDS = 6000;

async function post(
	path: string,
	token: string,
	body: unknown,
	headers: Record<string, string> = {}
): Promise<ActionResult> {
	try {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token, ...headers },
			body: JSON.stringify(body)
		});
		if (res.ok) return { ok: true };
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		return { ok: false, error: data?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}

/** Open a discussion on a task (`open`) or end it (`close`). */
export const discussion = (taskId: string, action: 'open' | 'close', token: string) =>
	post('/api/crew', token, { taskId, action });

/**
 * Send the captain's message, or a quick action, to the worker. `id` makes a
 * retry safe: send a failed message again with its own id.
 */
export const sayToWorker = (
	taskId: string,
	kind: CrewKind,
	text: string,
	token: string,
	id: string = crypto.randomUUID()
) => post('/api/crew/messages', token, { taskId, kind, text }, { 'idempotency-key': id });

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One worker's conversation, as the chat follows Firstmate's. */
export class WorkerChat {
	session = $state<FirstmateSessionView | null>(null);
	source = $state<TranscriptSource | null>(null);
	records = $state.raw<Record<string, any>[]>([]);
	connection = $state<Connection>('connecting');
	/** This connection has the transcript as it stands. */
	synced = $state(false);
	readonly chat: Chat = $derived(fold(this.records));
	/** The worker is mid-turn: its last turn is still open. */
	readonly working: boolean = $derived.by(() => {
		const last = this.chat.items[this.chat.items.length - 1];
		return this.session?.busy === true || (last?.kind === 'turn' && !last.done);
	});

	constructor(private taskId: string) {}

	connect(): () => void {
		this.synced = false;
		const listen = (es: EventSource) => {
			es.addEventListener('session', (e) => {
				this.session = JSON.parse((e as MessageEvent).data);
			});
			es.addEventListener('reset', (e) => {
				this.source = JSON.parse((e as MessageEvent).data);
				this.records = [];
			});
			es.addEventListener('records', (e) => {
				const next = [...this.records, ...JSON.parse((e as MessageEvent).data)];
				this.records = next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next;
			});
			es.addEventListener('replace', (e) => {
				const next = JSON.parse((e as MessageEvent).data);
				this.records = next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next;
			});
			es.addEventListener('synced', () => (this.synced = true));
		};
		return watchedStream(
			`/api/tasks/${encodeURIComponent(this.taskId)}/chat`,
			listen,
			(s) => (this.connection = s)
		);
	}
}
