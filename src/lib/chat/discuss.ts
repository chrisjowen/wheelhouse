/**
 * Discussing a decision in the chat: the captain asks Firstmate about an open
 * question (or one already answered) from under its card. Firstmate only
 * receives text, so the question reaches it as an ordinary chat message that
 * starts with a one-line Markdown quote naming the task, the decision key and
 * the question, then a blank line, then the captain's words:
 *
 *     > About the decision on lumen-pricing (key layout), not an answer yet: “Which pricing layout should ship?”
 *
 *     What's the risk?
 *
 * The chat reads that form back from the transcript and shows the message, and
 * the turn Firstmate answers it with, in the thread under the decision's card
 * instead of in the conversation. Pure, so it is unit-tested.
 */
import type { Item } from './fold';
import type { Pending } from './outbox';
import { snippetOf } from './reply';

/** What a discussion names: the decision's card id is `<task id>:<key>`. */
export interface DiscussRef {
	taskId: string;
	key: string;
	question: string;
}

/** One message in a decision's thread. */
export interface ThreadMsg {
	id: string;
	who: 'captain' | 'firstmate';
	/** The captain's words without the quote, or Firstmate's reply as Markdown. */
	text: string;
	at: string | null;
}

/** A decision's thread: its messages, and whether Firstmate is still answering. */
export interface Thread {
	messages: ThreadMsg[];
	answering: boolean;
}

const SLUG = /^[^\s()]+$/;
const QUOTED =
	/^> About the decision on ([^\s()]+) \(key ([^\s()]+)\), not an answer yet: “(.*)”\n\n([\s\S]+)$/;

export const cardIdOf = (ref: Pick<DiscussRef, 'taskId' | 'key'>) => `${ref.taskId}:${ref.key}`;

/** Whether a discussion can name the decision: its task id and key have no spaces or brackets. */
export const canDiscuss = (ref: Pick<DiscussRef, 'taskId' | 'key'>) =>
	SLUG.test(ref.taskId) && SLUG.test(ref.key);

/** The text Firstmate receives for a question about a decision; empty when there are no words. */
export function discussText(ref: DiscussRef, body: string): string {
	const words = body.trim();
	if (!words || !canDiscuss(ref)) return '';
	return `> About the decision on ${ref.taskId} (key ${ref.key}), not an answer yet: “${snippetOf(ref.question)}”\n\n${words}`;
}

/** A sent message back as the decision it is about and the captain's words; null when it is not one. */
export function parseDiscuss(text: string): { cardId: string; body: string } | null {
	const m = text.replace(/\r\n?/g, '\n').match(QUOTED);
	if (!m || !m[4].trim()) return null;
	return { cardId: cardIdOf({ taskId: m[1], key: m[2] }), body: m[4].trim() };
}

/**
 * The threads of the decisions the chat shows (`cards`, by card id): each
 * captain message about one of them, with the reply Firstmate started right
 * after it, and the ids of those items, which the conversation leaves out. A
 * reply that also asks the captain something (a question picker) stays in the
 * conversation, where it can be answered.
 */
export function threads(
	items: Item[],
	cards: ReadonlySet<string>
): { byCard: Map<string, Thread>; hidden: Set<string> } {
	const byCard = new Map<string, Thread>();
	const hidden = new Set<string>();
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (it.kind !== 'user') continue;
		const d = parseDiscuss(it.text);
		if (!d || !cards.has(d.cardId)) continue;
		const thread = byCard.get(d.cardId) ?? { messages: [], answering: false };
		byCard.set(d.cardId, thread);
		thread.messages.push({ id: it.id, who: 'captain', text: d.body, at: it.at });
		thread.answering = false;
		hidden.add(it.id);
		const next = items[i + 1];
		if (next?.kind !== 'turn' || next.trigger !== 'captain') continue;
		if (next.parts.some((p) => p.kind === 'question')) continue;
		hidden.add(next.id);
		for (const p of next.parts) {
			if (p.kind === 'text')
				thread.messages.push({ id: p.id, who: 'firstmate', text: p.text, at: next.at });
		}
		thread.answering = !next.done && !next.interrupted;
		i++;
	}
	return { byCard, hidden };
}

/** The captain's questions still on their way, by card id; the conversation leaves them out. */
export function pendingThreads(
	pending: Pending[]
): Map<string, { pending: Pending; body: string }[]> {
	const out = new Map<string, { pending: Pending; body: string }[]>();
	for (const p of pending) {
		const d = parseDiscuss(p.text);
		if (!d) continue;
		out.set(d.cardId, [...(out.get(d.cardId) ?? []), { pending: p, body: d.body }]);
	}
	return out;
}
