import type { Item, Turn } from './fold';

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
	/** The id of the chat's last item when it was sent; only later items can confirm it. */
	after: string | null;
};

/** Times Firstmate finishes a turn after a message without the message showing, before it is let go. */
export const IDLE_FALLBACK = 2;

/** Text as the matching sees it: whitespace collapsed, padded for whole-word containment. */
const norm = (s: string) => ` ${s.replace(/\s+/g, ' ').trim()} `;

export const lastId = (items: Item[]) => items[items.length - 1]?.id ?? null;

/** Where `after` is in the chat; -1 once it is gone (the transcript started over or was trimmed). */
const at = (items: Item[], after: string | null) =>
	after === null ? -1 : items.findIndex((it) => it.id === after);

const isTurn = (i: Item | undefined): i is Turn => i?.kind === 'turn';

/**
 * The pending messages still to show. A session message clears once the chat
 * shows a message containing its text after the point it was sent (several
 * queued messages can arrive as one, and earlier pending copies of the same
 * text claim theirs first). One the transcript never matches is let go once
 * Firstmate has finished IDLE_FALLBACK turns since, rather than staying faded
 * below them. An inbox note clears once Firstmate starts a turn after it.
 */
export function unconfirmed(pending: Pending[], items: Item[]): Pending[] {
	const claimed = new Map<string, number>();
	return pending.filter((p) => {
		if (p.state === 'sending' || p.state === 'failed') return true;
		const pos = at(items, p.after);
		const newer = items.slice(pos + 1);
		if (p.via === 'inbox') return !newer.some(isTurn);
		const t = norm(p.text);
		const used = claimed.get(t) ?? 0;
		const echoes = newer.filter((i) => i.kind === 'user' && norm(i.text).includes(t)).length;
		if (echoes > used) {
			claimed.set(t, used + 1);
			return false;
		}
		return newer.filter((i) => isTurn(i) && i.done).length < IDLE_FALLBACK;
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
