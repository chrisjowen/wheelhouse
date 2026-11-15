/**
 * Crew discussions: the captain talking to one of Firstmate's workers
 * directly, which is opened on purpose from a task's page and closed again
 * when it is done. Most of the time the captain talks to Firstmate, so none is
 * open by default.
 *
 * What the captain says goes into the task's steering inbox (fm-send.sh), the
 * way Firstmate steers it, marked as the captain's own words (a captain
 * sidebar), so the worker may answer the captain in its conversation, which
 * Wheelhouse shows. Each message carries a reference, which matches it to its
 * inbox record: the worker moving that record to handled/ is the "seen"
 * receipt. Firstmate gets a short note of each, so it stays in step.
 *
 * Pure (the server writes and reads these, the page renders them), so it is unit-tested.
 */

import type { Item } from './chat/fold';

export const CREW_SCHEMA = 'wheelhouse-crew.v1';

/** The marker a captain sidebar message starts with, as the prototype's report names it. */
export const SIDEBAR_MARK = 'captain-sidebar';

/**
 * say     what the captain typed
 * status  a short ask for where the worker is
 * pause   stop after the current step and wait
 * resume  carry on after a pause
 */
export type CrewKind = 'say' | 'status' | 'pause' | 'resume';
export const CREW_KINDS: readonly CrewKind[] = ['say', 'status', 'pause', 'resume'];

/** The longest message the captain can send a worker. */
export const CREW_TEXT_MAX = 8000;

export interface CrewMessage {
	/** The request id (the page's Idempotency-Key), which also makes its inbox reference. */
	id: string;
	kind: CrewKind;
	/** What the captain said, or the canned words of a quick action. */
	text: string;
	/** When it was sent (ISO). */
	at: string;
	/**
	 * sending  fm-send.sh is running
	 * sent     it is in the worker's inbox
	 * failed   it could not be put there (error says why); sending it again is safe
	 */
	delivery: 'sending' | 'sent' | 'failed';
	error: string | null;
	/** The worker moved its inbox record to handled/: it has read it. */
	seen: boolean;
	/** Firstmate's note about it: sent, failed, or off (messaging is not set up). */
	told: 'sending' | 'sent' | 'failed' | 'off';
}

export interface CrewDiscussion {
	taskId: string;
	/** The task's title and project when it was opened, for when the task has left the fleet. */
	title: string;
	projectId: string;
	openedAt: string;
	/** The captain asked the worker to pause, and has not asked it to resume. */
	paused: boolean;
	messages: CrewMessage[];
}

export interface CrewView {
	schema: typeof CREW_SCHEMA;
	available: boolean;
	reason: string | null;
	/** Open discussions only, oldest first. */
	discussions: CrewDiscussion[];
}

/** The reference a message's inbox record carries: `wh-crew-<request id>`. */
export const crewRef = (id: string) => `wh-crew-${id}`;

const CANNED: Record<Exclude<CrewKind, 'say'>, string> = {
	status:
		'Where are you with the task? Reply in a few lines: what is done, what you are doing now, and what is next.',
	pause:
		'Please pause: finish the step you are on, then stop and wait. Do not start the next step until I say to resume. Report the pause to Firstmate as your brief says.',
	resume: 'Please resume: carry on with the task from where you stopped.'
};

/** What a quick action says, or the captain's own words for `say`. */
export function crewText(kind: CrewKind, text: string): string {
	return kind === 'say' ? text.trim() : CANNED[kind];
}

/**
 * The inbox body for a captain sidebar message: the marker line with its
 * reference, what it means for the worker, then the captain's words.
 */
export function crewBody(ref: string, text: string): string {
	return [
		`[${SIDEBAR_MARK} ref=${ref}] From the captain directly, in a crew discussion in Wheelhouse (not relayed by Firstmate).`,
		'This is the captain speaking to you: reply to the captain in your conversation, which the captain reads in Wheelhouse. Keep reporting your state to Firstmate as usual; Firstmate is told of this discussion.',
		'',
		text
	].join('\n');
}

const MARK_LINE = new RegExp(`^\\[${SIDEBAR_MARK} ref=([A-Za-z0-9._:-]+)\\][^\\n]*\\n`);

/** A captain sidebar message's reference and the captain's words, or null for any other inbox body. */
export function parseCrewBody(body: string): { ref: string; text: string } | null {
	const t = body.replace(/\r\n?/g, '\n');
	const m = MARK_LINE.exec(t);
	if (!m) return null;
	const rest = t.slice(m[0].length);
	const gap = rest.indexOf('\n\n');
	return { ref: m[1], text: (gap >= 0 ? rest.slice(gap + 2) : rest).trim() };
}

const EXCERPT_MAX = 400;
const excerpt = (s: string) => {
	const one = s.replace(/\s+/g, ' ').trim();
	return one.length > EXCERPT_MAX ? `${one.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : one;
};

/**
 * The note Firstmate gets about a message the captain sent a worker directly:
 * which task, that it is already in the worker's inbox (so it is not passed
 * on again), and what was said.
 */
export function digestText(taskId: string, kind: CrewKind, text: string): string {
	const head = `Crew discussion with ${taskId}: I spoke to the worker directly from Wheelhouse. It is already in the worker's inbox, so there is no need to pass it on.`;
	const said =
		kind === 'pause'
			? 'I asked it to pause after its current step.'
			: kind === 'resume'
				? 'I asked it to resume.'
				: kind === 'status'
					? 'I asked it where it is.'
					: `I said: “${excerpt(text)}”`;
	return `${head}\n${said}`;
}

/** The note Firstmate gets when the captain ends a discussion in which something was said or the worker is still paused. */
export function closedText(taskId: string, paused: boolean): string {
	const head = `Crew discussion with ${taskId}: I have ended my direct discussion with the worker. Steer it as usual from here.`;
	return paused
		? `${head}\nI had asked it to pause, and it is still waiting for me to say resume: please tell it to resume.`
		: head;
}

/** Tasks a discussion can be opened on: the captain's own workers still at work (not a second mate's). */
export function canDiscuss(task: { id: string; status: string; secondMate?: unknown }): boolean {
	return (
		!task.id.includes('@') &&
		!task.secondMate &&
		!['queued', 'done', 'landed', 'closed'].includes(task.status)
	);
}

/**
 * One line of a discussion, oldest first:
 * worker     the worker's turn (its words and its folded work), or its output or a notice
 * firstmate  something typed into the worker's session (Firstmate's brief or a nudge)
 * captain    what the captain sent in this discussion, with its receipts
 */
export type DiscussionEntry =
	| { kind: 'worker'; at: string; item: Item }
	| { kind: 'firstmate'; at: string; item: Extract<Item, { kind: 'user' }> }
	| { kind: 'captain'; at: string; message: CrewMessage };

/** The inbox doorbell typed into a worker's session; the message itself is shown instead. */
const DOORBELL = /(?:instruction|operational input) waiting\b/i;

/**
 * The discussion as one conversation: the worker's transcript (folded as the
 * chat folds Firstmate's) with the captain's messages placed by time. Unless
 * `all`, it starts with the worker's last turn before the discussion opened,
 * so there is something to talk about; `earlier` counts what that leaves out.
 */
export function discussionEntries(
	items: Item[],
	messages: CrewMessage[],
	openedAt: string,
	all = false
): { entries: DiscussionEntry[]; earlier: number } {
	const worker: DiscussionEntry[] = [];
	for (const item of items) {
		if (item.kind === 'user') {
			if (!DOORBELL.test(item.text)) worker.push({ kind: 'firstmate', at: item.at, item });
		} else worker.push({ kind: 'worker', at: item.at, item });
	}
	let from = 0;
	if (!all) {
		const after = worker.findIndex((e) => e.at >= openedAt);
		const opened = after < 0 ? worker.length : after;
		const last = worker.findLastIndex((e, i) => i < opened && e.kind === 'worker');
		from = last >= 0 ? last : opened;
	}
	const shown = worker.slice(from);
	const said: DiscussionEntry[] = messages.map((m) => ({ kind: 'captain', at: m.at, message: m }));
	const entries = [...shown, ...said].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
	return { entries, earlier: from };
}
