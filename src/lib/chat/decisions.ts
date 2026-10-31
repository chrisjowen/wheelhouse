/**
 * Decisions in the chat: every question in the decision inbox shows as a card
 * of its own in the conversation, at the time it was asked, whether or not
 * Firstmate's replies mention it. An open one is the Decisions page's own
 * decision box; one the captain answered (here or anywhere else in
 * Wheelhouse) stays where it was, folded to its answer: at once from this
 * browser's answer, then from the inbox's record of what was sent, then, once
 * the question has left the inbox, from the answered log. Pure, so it is
 * unit-tested.
 */
import {
	choiceLabel,
	type AnsweredDecision,
	type InboxAction,
	type InboxCard,
	type InboxKind
} from '../inbox';
import type { Delivery } from '../types';
import type { Item } from './fold';

/** What a decision card shows about its question, open or answered. */
export interface DecisionHead {
	cardId: string;
	taskId: string;
	taskTitle: string;
	projectId: string | null;
	kind: InboxKind;
	key: string;
	question: string;
	askedAt: string | null;
}

export interface DecisionAnswer {
	choice: InboxAction;
	label: string;
	picks: string | null;
	note: string | null;
	/** When it was sent; null while this browser is still sending it. */
	at: string | null;
	/** sending: this browser has not had Firstmate's inbox take it yet. */
	delivery: Delivery | 'sending' | null;
}

export interface ChatDecision {
	/** Stable across the open card, its fold and the log: the card id, or the answer's request id. */
	id: string;
	head: DecisionHead;
	/** The open card, while the inbox still has the question. */
	card: InboxCard | null;
	/** The answer, once given: the card then shows folded. */
	answer: DecisionAnswer | null;
}

/** An answer this browser sent that the inbox may not show yet (lib/client/inbox.svelte.ts). */
export interface LocalAnswer {
	choice: InboxAction;
	picks: string | null;
	note: string | null;
	question: string;
	posted: boolean;
}

const headOf = (c: InboxCard): DecisionHead => ({
	cardId: c.id,
	taskId: c.taskId,
	taskTitle: c.taskTitle,
	projectId: c.projectId,
	kind: c.kind,
	key: c.key,
	question: c.choices?.intro || c.question,
	askedAt: c.askedAt
});

/** Every decision to show: the open questions, the ones answered, and those answered earlier. */
export function chatDecisions(
	cards: InboxCard[],
	answered: AnsweredDecision[],
	local: Record<string, LocalAnswer>
): ChatDecision[] {
	const out: ChatDecision[] = [];
	const shown = new Set<string>();
	for (const c of cards) {
		const head = headOf(c);
		const mine = local[c.id]?.question === c.question ? local[c.id] : null;
		if (mine) {
			out.push({
				id: c.id,
				head,
				card: c,
				answer: {
					choice: mine.choice,
					label: choiceLabel(c, mine.choice),
					picks: mine.picks,
					note: mine.note,
					at: null,
					delivery: mine.posted ? 'delivered' : 'sending'
				}
			});
		} else if (c.sent && c.sent.delivery !== 'failed') {
			shown.add(c.sent.requestId);
			out.push({
				id: c.id,
				head,
				card: c,
				answer: {
					choice: c.sent.choice,
					label: choiceLabel(c, c.sent.choice),
					picks: c.sent.picks,
					note: c.sent.note,
					at: c.sent.at,
					delivery: c.sent.delivery as Delivery
				}
			});
		} else {
			out.push({ id: c.id, head, card: c, answer: null });
		}
	}
	const open = new Map(out.map((d) => [d.id, d]));
	for (const a of answered) {
		if (shown.has(a.requestId)) continue;
		// The same question still open here is the card above; this answer did not settle it.
		const same = open.get(a.cardId);
		if (same && same.head.question === a.question && same.answer) continue;
		out.push({
			id: `answer:${a.requestId}`,
			head: {
				cardId: a.cardId,
				taskId: a.taskId,
				taskTitle: a.taskTitle,
				projectId: a.projectId,
				kind: a.kind,
				key: a.key,
				question: a.question,
				askedAt: a.askedAt
			},
			card: null,
			answer: {
				choice: a.choice,
				label: a.label,
				picks: a.picks,
				note: a.note,
				at: a.answeredAt,
				delivery: a.delivery
			}
		});
	}
	return out;
}

const time = (s: string | null | undefined) => {
	const t = s ? Date.parse(s) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** When a decision sits in the conversation: when it was asked, else when it was answered. */
const placeAt = (d: ChatDecision) => time(d.head.askedAt) ?? time(d.answer?.at);

/**
 * Where each decision goes among the chat's items: before the first item
 * after it was asked (`before`, by item index), or after them all (`end`) when
 * it is newer than every item or its time is unknown. An answered decision
 * from before the conversation's first item is left out with the rest of the
 * history the chat does not show; an open one goes first.
 */
export function placeDecisions(
	items: Item[],
	decisions: ChatDecision[]
): { before: Map<number, ChatDecision[]>; end: ChatDecision[] } {
	const before = new Map<number, ChatDecision[]>();
	const end: ChatDecision[] = [];
	const times = items.map((it) => time(it.at));
	const first = times.find((t) => t !== null) ?? null;
	const sorted = decisions
		.map((d) => ({ d, at: placeAt(d) }))
		.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.d.id.localeCompare(b.d.id));
	for (const { d, at } of sorted) {
		if (at === null) {
			end.push(d);
			continue;
		}
		if (d.answer && (first === null || at < first)) continue;
		const i = times.findIndex((t) => t !== null && t > at);
		if (i < 0) end.push(d);
		else before.set(i, [...(before.get(i) ?? []), d]);
	}
	return { before, end };
}
