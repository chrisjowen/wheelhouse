/**
 * Handled by Firstmate: everything on the Decisions page that is not waiting
 * on the captain. Two kinds, both Firstmate's to settle under its own rules:
 *
 * - questions it is settling now: open inbox cards it was not asked to
 *   escalate (a worker's decision, a blocker, the review's questions);
 * - calls it has made: the review questions it answered on the captain's
 *   behalf (the Logbook's Decided for you), from the last week.
 *
 * Either can be taken over: an open one opens in the chat with its form
 * (`/?decision=<card id>`), a made one starts a message to Firstmate saying
 * the captain would decide differently. Pure, so it is unit-tested.
 */
import { awaitsAnswer, escalated, type InboxCard } from './inbox';
import type { DecisionView } from './types';

/** How far back Handled by Firstmate lists the calls Firstmate made. */
export const HANDLED_DAYS = 7;

export interface Handled {
	/** Questions Firstmate is settling now, oldest first. */
	open: InboxCard[];
	/** Calls Firstmate made, newest first. */
	made: DecisionView[];
	count: number;
}

export function handled(cards: InboxCard[], made: DecisionView[], now: number): Handled {
	const open = cards.filter((c) => !escalated(c) && awaitsAnswer(c));
	const since = now - HANDLED_DAYS * 86_400_000;
	const recent = made
		.filter((d) => Date.parse(d.decidedAt) >= since)
		.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
	return { open, made: recent, count: open.length + recent.length };
}

const short = (s: string) => (s.length > 90 ? s.slice(0, 87).trimEnd() + '…' : s);

/** The chat link that takes over a call Firstmate made: a message about its task, not yet sent. */
export function changeCallHref(d: DecisionView): string {
	const call = d.calls[0];
	const draft = `I'd decide differently on "${short(call?.question ?? d.taskTitle)}" (your call: ${call?.verdict ?? d.verdict}). `;
	return `/?chat=${encodeURIComponent(d.taskId)}&draft=${encodeURIComponent(draft)}`;
}

/** The chat link that brings a question into the conversation with its form. */
export const decisionHref = (cardId: string) => `/?decision=${encodeURIComponent(cardId)}`;

/**
 * Chat with Firstmate about this: the main chat, with a message started about
 * the decision (its task as the chip, then the decision named), not yet sent.
 * The decision is then followed up there (lib/client/inbox.svelte.ts follow).
 */
export function chatAboutHref(
	card: Pick<InboxCard, 'taskId' | 'kind' | 'key' | 'title' | 'secondMate'>
): string {
	const task = card.secondMate?.taskId
		? `${card.secondMate.taskId}@${card.secondMate.id}`
		: card.taskId;
	const id = card.kind === 'hold' ? card.key : `${card.taskId}, key ${card.key}`;
	const draft = `About decision ${id} (“${short(card.title)}”), not an answer yet: `;
	return `/?chat=${encodeURIComponent(task)}&draft=${encodeURIComponent(draft)}`;
}
