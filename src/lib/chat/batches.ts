/**
 * Preview feedback in the chat: each list the captain sent from a task's
 * Preview tab (lib/previewhelper.ts), or from a plugin with the feedback
 * capability (server/plugins/feedback.ts), shows in the conversation as the
 * captain's card addressed to Firstmate, at the time it was sent, with
 * whether Firstmate has seen it, what came of it on the task (`actedOn`) and
 * the reply Firstmate recorded. It went to
 * Firstmate's inbox as one note about the task, so it is read from
 * Wheelhouse's own record of the messages it sent, not from the transcript.
 * Pure, so it is unit-tested.
 */
import { parseBatch, type Batch } from '../previewhelper';
import type { BridgeMessage, Delivery, TaskRuns } from '../types';
import type { Item } from './fold';

export interface ChatBatch {
	id: string;
	at: string;
	batch: Batch;
	/** In plain words: sending, sent, taken up by Firstmate, or not delivered. */
	status: string;
	/** Firstmate has taken it from its inbox. */
	seen: boolean;
	failed: boolean;
	/** Firstmate's reply, when it recorded one. */
	reply: string | null;
}

const STATUS: Record<Delivery, string> = {
	sending: 'Sending to Firstmate…',
	uncertain: 'Confirming Firstmate has it…',
	'saved-unannounced': 'Saved; Firstmate reads it at its next check',
	delivered: 'Sent to Firstmate',
	failed: 'Not delivered'
};

/** The feedback lists the captain sent, oldest first. */
export function chatBatches(messages: BridgeMessage[]): ChatBatch[] {
	const out: ChatBatch[] = [];
	for (const m of messages) {
		const batch = parseBatch(m.text);
		if (!batch) continue;
		const seen = m.delivery === 'delivered' && !!m.acknowledged;
		out.push({
			id: m.requestId,
			at: m.submittedAt,
			batch,
			status: seen ? 'Seen by Firstmate, which passes it to the same task' : STATUS[m.delivery],
			seen,
			failed: m.delivery === 'failed',
			reply: m.reply?.body ?? null
		});
	}
	return out;
}

/**
 * What came of a list on its task: the run that took it up as a change asked
 * for (server/firstmate/changes.ts keys those by the message's request id),
 * and whether the worker has reported the pull request ready again since.
 * Null while no run has it, as for a list sent before the first ready report.
 */
export function actedOn(
	id: string,
	runs: TaskRuns | null | undefined
): { run: number; addressed: boolean } | null {
	for (const r of runs?.runs ?? []) {
		const c = r.changes.find((x) => x.id === `wheelhouse:${id}`);
		if (c) return { run: r.n, addressed: c.state === 'addressed' };
	}
	return null;
}

/**
 * Where each card goes among the chat's items: before the first item after it
 * was sent, or after them all when it is newer than every item. One older
 * than the conversation's first item is left out with the rest of the history
 * the chat does not show.
 */
export function placeBatches(
	items: Item[],
	batches: ChatBatch[]
): { before: Map<number, ChatBatch[]>; end: ChatBatch[] } {
	const before = new Map<number, ChatBatch[]>();
	const end: ChatBatch[] = [];
	const times = items.map((it) => Date.parse(it.at));
	const first = times.find((t) => !Number.isNaN(t));
	for (const b of batches) {
		const at = Date.parse(b.at);
		if (first !== undefined && at < first) continue;
		const i = times.findIndex((t) => !Number.isNaN(t) && t > at);
		if (i < 0) end.push(b);
		else before.set(i, [...(before.get(i) ?? []), b]);
	}
	return { before, end };
}
