import type { Item } from './fold';

/**
 * Messages the captain sent that the transcript does not show yet. Each shows
 * at once as a pending bubble: sending, then queued (Firstmate was busy, so
 * Claude Code holds it until the turn ends), delivered, or failed with a retry.
 * It turns into a normal bubble when the transcript records the same text. Pure,
 * so it is unit-tested; the page's state lives in lib/client/chat.svelte.ts.
 */
export type PendingState = 'sending' | 'queued' | 'delivered' | 'failed';

export type Pending = {
	id: string;
	text: string;
	via: 'session' | 'inbox';
	state: PendingState;
	error: string | null;
	/** How many of the captain's messages with this text the chat already held when it was sent. */
	baseline: number;
	/** How many of Firstmate's turns the chat held when it was sent (an inbox note has no echo). */
	turns: number;
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export const countUser = (items: Item[], text: string) => {
	const t = norm(text);
	return items.filter((i) => i.kind === 'user' && norm(i.text) === t).length;
};

export const countTurns = (items: Item[]) => items.filter((i) => i.kind === 'turn').length;

/**
 * The pending messages still to show. A session message clears once the chat has
 * more messages with its text than when it was sent (earlier pending copies of
 * the same text claim theirs first); an inbox note once Firstmate starts a turn.
 */
export function unconfirmed(pending: Pending[], items: Item[]): Pending[] {
	const claimed = new Map<string, number>();
	const turns = countTurns(items);
	return pending.filter((p) => {
		if (p.state === 'sending' || p.state === 'failed') return true;
		if (p.via === 'inbox') return turns <= p.turns;
		const t = norm(p.text);
		const used = claimed.get(t) ?? 0;
		if (countUser(items, p.text) > p.baseline + used) {
			claimed.set(t, used + 1);
			return false;
		}
		return true;
	});
}

export function pendingLabel(p: Pending): string {
	switch (p.state) {
		case 'sending':
			return 'Sending…';
		case 'queued':
			return 'Queued · Firstmate is busy and will read it next';
		case 'failed':
			return p.error ? `Not sent · ${p.error}` : 'Not sent';
		default:
			return p.via === 'inbox' ? 'In Firstmate’s inbox' : 'Delivered · waiting for Firstmate';
	}
}
