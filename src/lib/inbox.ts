/**
 * The decision inbox: every open question, those Firstmate escalated to the
 * captain (`escalated`) apart from those it is settling itself. Shared by the
 * server (which builds the cards, see server/inbox/cards.ts) and the browser
 * (which shows them and remembers "Ask me later" per browser). A question is
 * answered with the form that fits it (lib/decisionform.ts).
 *
 * An answer never bypasses Firstmate: it becomes an ordinary message through
 * `fm-inbox.sh note` whose body names the task, the decision key and the
 * chosen option (answerText), and Firstmate relays it under its own rules.
 * An answered card leaves every list at once (the Decisions page, On deck,
 * the task page), without waiting for Firstmate to close the question; one
 * whose answer was not delivered stays, saying why.
 *
 * Dismissing a question answers nothing: it asks Firstmate to record the
 * decision closed without an answer, with the captain's reason (closeText): a
 * held task as dismissed, a worker's question resolved on its key. The card
 * leaves the stack as soon as that message is taken, and every question can be
 * dismissed. A held question is keyed by its task id (the captain-held task),
 * the one id the Decisions page, the chat and Firstmate's records share.
 */
import type { Delivery } from './types';

/**
 *   review    the automated review's questions (ask-user findings) on a worker's gate
 *   decision  a question a worker raised (needs-decision)
 *   blocked   a worker that is stuck and asked for help
 *   hold      work Firstmate is holding for the captain's call
 *   merge     a pull request that is green and waits for the word to merge
 *   preview   a live preview waiting for the captain's sign-off (key board-review)
 */
export type InboxKind = 'review' | 'decision' | 'blocked' | 'hold' | 'merge' | 'preview';

export type InboxChoice = 'approve' | 'fix' | 'skip';

export const CHOICES: readonly InboxChoice[] = ['approve', 'fix', 'skip'];

/** What the captain can do with a card: one of its answers, or dismiss it without one (`close`). */
export type InboxAction = InboxChoice | 'close';

/** The reasons offered when dismissing a question; the captain can write their own instead. */
export const DISMISS_REASONS = [
	'No longer needed',
	'Already sorted elsewhere',
	'Wrong question'
] as const;

export interface InboxOption {
	choice: InboxChoice;
	/** The button: Approve, Fix (Request changes on a preview) or Skip. */
	label: string;
	/** What it means for this card, in plain words. */
	meaning: string;
}

const LABEL: Record<InboxChoice, string> = { approve: 'Approve', fix: 'Fix', skip: 'Skip' };

const KIND_LABEL: Partial<Record<InboxKind, Partial<Record<InboxChoice, string>>>> = {
	preview: { fix: 'Request changes' }
};

const MEANING: Record<InboxKind, Record<InboxChoice, string>> = {
	review: {
		approve: 'Keep the code as it is.',
		fix: 'Have the worker fix it.',
		skip: 'Defer it: no change in this work.'
	},
	decision: {
		approve: 'Go ahead as proposed.',
		fix: 'Change course (say how in a note).',
		skip: 'Leave the call to Firstmate.'
	},
	blocked: {
		approve: 'Go ahead as proposed.',
		fix: 'Try another way (say how in a note).',
		skip: 'Leave it to Firstmate to unblock.'
	},
	hold: {
		approve: 'Go ahead.',
		fix: 'Not like this (say what to change in a note).',
		skip: 'Not now: leave it held.'
	},
	merge: {
		approve: 'Merge the pull request.',
		fix: 'Request changes (say what in a note).',
		skip: 'Hold off merging for now.'
	},
	preview: {
		approve: 'Sign off the preview.',
		fix: 'Request changes (say what in a note).',
		skip: 'Not now: sign it off later.'
	}
};

/** Approve on a card with choices: it sends the picks. */
const PICKS_LABEL = 'Send picks';
const PICKS_MEANING = 'Go ahead with the picks below.';
/** An answer decided in the chat from a form Firstmate wrote there: it names the words decided. */
export const DECIDED_LABEL = 'Decided';
const DECIDED_MEANING = 'The captain decided in the chat, from the options you gave there.';

export function optionsFor(kind: InboxKind, picks = false): InboxOption[] {
	return CHOICES.map((choice) =>
		picks && choice === 'approve'
			? { choice, label: PICKS_LABEL, meaning: PICKS_MEANING }
			: {
					choice,
					label: KIND_LABEL[kind]?.[choice] ?? LABEL[choice],
					meaning: MEANING[kind][choice]
				}
	);
}

/** A choice's button label on a card. */
export const choiceLabel = (card: InboxCard, c: InboxAction) =>
	c === 'close' ? 'Dismiss' : (card.options.find((o) => o.choice === c)?.label ?? LABEL[c]);

/** One question the automated review raised, in plain words. */
export interface InboxFinding {
	id: string;
	summary: string;
	/** The full finding, when it says more than the summary. */
	detail: string | null;
	/** Where it is, e.g. "src/lib/export.ts, line 23". */
	where: string | null;
	serious: boolean;
}

/** One option of a call, as the hold text names it. */
export interface InboxPick {
	/** The letter (A, B, C) when the text letters its options, else its place (1, 2, 3). */
	id: string;
	/** The letter, or the option's words. */
	label: string;
	/** What a lettered option is. */
	detail: string | null;
	recommended: boolean;
}

/**
 * One call within a question: its own options, picked one of, or none (the
 * captain writes the answer).
 */
export interface InboxCall {
	/** Stable within the card: the call's number, `main`, or `then-<n>` for a follow-up. */
	id: string;
	/** The number the text gives the call, as in "2) First channel: …". */
	number: number | null;
	/** What the call is about ("First channel"), or the question it asks. */
	prompt: string | null;
	options: InboxPick[];
	/** A pick is needed before the answer goes; follow-ups and written answers are optional. */
	required: boolean;
}

/** The calls a question asks the captain to make, read from its text. */
export interface InboxChoices {
	/** The question's opening words, before the calls. */
	intro: string;
	calls: InboxCall[];
	/** Other words around the calls (after the options). */
	after: string | null;
}

export interface InboxEvidence {
	/** What the worker or Firstmate wrote about it, in plain words. */
	text: string | null;
	/** The report the question names, and where Wheelhouse serves it (null when it cannot be read). */
	report: { path: string; url: string | null } | null;
	findings: InboxFinding[];
	/** The findings file the question names (its file name only). */
	file: string | null;
	pr: { url: string; number: number | null } | null;
	/**
	 * Where the work can be seen: the latest preview the task's status lines name
	 * (lib/previewnote.ts), or those of the task it came from when its own name
	 * none; never read from the question's own words.
	 */
	preview: string | null;
	/** The task whose preview that is, to check it (and reach a remote one); null when none is. */
	previewTask: string | null;
	/** The latest review board (a Lavish board session) the task's status lines name. */
	board: string | null;
	/** CI as Wheelhouse last read it. */
	checks: 'green' | 'red' | 'pending' | null;
	screenshots: { name: string; url: string }[];
	/**
	 * The documents the question rests on: the report it names, then the
	 * Markdown files and patches in the data folders of its task and the task
	 * it came from, each read through the inbox's own reader (`url`, null when
	 * the file cannot be read).
	 */
	docs: InboxDoc[];
}

/** A document a question rests on: a report, another Markdown file, or a patch. */
export interface InboxDoc {
	/** As the Firstmate home names it, e.g. `data/<task>/report.md`. */
	path: string;
	kind: 'report' | 'doc' | 'patch';
	url: string | null;
}

export interface InboxCard {
	/** Stable: `<task id>:<decision key>`, or `<task id>:captain-hold` for a held question. */
	id: string;
	taskId: string;
	taskTitle: string;
	projectId: string | null;
	kind: InboxKind;
	/**
	 * The decision key the answer names: the status-log key as written, the
	 * held task's id for a captain hold, or `merge-pr` or `open-<n>` for
	 * questions Firstmate records without one.
	 */
	key: string;
	/** The question as Firstmate wrote it, in plain words. */
	question: string;
	/** The question as a short heading: never a whole paragraph of Firstmate's words. */
	title: string;
	/** The task the held work came from (`Captain hold origin:`), when it is another. */
	origin: string | null;
	/**
	 * When the captain chose to talk it through with Firstmate in the main chat
	 * (Chat with Firstmate about this): it stays listed as following up, but no
	 * longer counts as waiting on them. Null while it waits.
	 */
	following: string | null;
	/** When it was asked, when known. */
	askedAt: string | null;
	/** captain: waiting on the captain; firstmate: Firstmate is handling it unless the captain steps in. */
	owner: 'captain' | 'firstmate';
	evidence: InboxEvidence;
	options: InboxOption[];
	/** Firstmate's recommendation, when one is recorded. */
	recommendation: { choice: InboxChoice | null; text: string } | null;
	/** The options the question names, when they can be read from it; Approve then sends the picks. */
	choices: InboxChoices | null;
	/**
	 * The captain's latest answer, sent to Firstmate while the question is still
	 * open. One whose delivery failed leaves the question waiting, with the reason.
	 * A close that was taken never shows here: the card leaves the stack.
	 */
	/**
	 * A question from a second mate's home: the second mate (also `taskId`, so
	 * an answer goes to Firstmate about it, which passes it on), and the task in
	 * its home the question is about (null for the second mate's own question).
	 * A question about a task in its home cannot be closed from here: the record
	 * of it is the second mate's. Its own question is Firstmate's, as any worker's is.
	 */
	secondMate?: { id: string; taskId: string | null; taskTitle: string | null } | null;
	sent: {
		choice: InboxAction;
		/** The picks an answer carried, as the `Picks:` line reads. */
		picks: string | null;
		note: string | null;
		at: string;
		delivery: string;
		detail: string | null;
		requestId: string;
	} | null;
}

export interface InboxView {
	schema: 'wheelhouse-inbox.v1';
	available: boolean;
	reason: string | null;
	/** Answering is possible (messaging to Firstmate works). */
	canAnswer: boolean;
	cards: InboxCard[];
	/** The questions answered or closed from Wheelhouse, oldest first (the chat shows each folded). */
	answered?: AnsweredDecision[];
}

/**
 * A question the captain answered or closed from Wheelhouse, as recorded when
 * Firstmate's inbox took the answer: enough for the chat to keep showing the
 * question and its answer after the card leaves the inbox. `delivery` is the
 * answer message's, read when the view is built (null once the message
 * record has dropped it).
 */
export interface AnsweredDecision {
	/** The answer's request id: one record per answer. */
	requestId: string;
	cardId: string;
	taskId: string;
	taskTitle: string;
	projectId: string | null;
	kind: InboxKind;
	key: string;
	/** The question as its card headed it. */
	question: string;
	askedAt: string | null;
	choice: InboxAction;
	/** The answer's button, e.g. Approve or Send picks (Dismiss for a dismissal). */
	label: string;
	/** The picks an answer carried, as the `Picks:` line reads. */
	picks: string | null;
	note: string | null;
	answeredAt: string;
	delivery: Delivery | null;
}

const KIND_WORDS: Record<InboxKind, string> = {
	review: 'review question',
	decision: 'decision',
	blocked: 'blocker',
	hold: 'captain hold',
	merge: 'merge call',
	preview: 'preview sign-off'
};

export const NOTE_MAX = 2000;
/** A written answer to one call. */
export const WRITTEN_MAX = 300;

/** The captain's picks: option id (or written words) by call id. */
export type Picks = Record<string, string>;

/** The picks with each call's recommended option filled in where the captain made no pick. */
export function resolvePicks(choices: InboxChoices, picks: Picks): Picks {
	const out: Picks = {};
	for (const call of choices.calls) {
		const own = picks[call.id]?.trim();
		const rec = call.options.find((o) => o.recommended)?.id;
		const v = own || rec;
		if (v) out[call.id] = v;
	}
	return out;
}

/** The required calls still without a pick. */
export const unpicked = (choices: InboxChoices, picks: Picks) =>
	choices.calls.filter((c) => c.required && !resolvePicks(choices, picks)[c.id]);

/** A call as an answer names it: "2) First channel", or the follow-up's question. */
export function callName(call: InboxCall): string {
	const prompt = call.prompt ? oneLine(call.prompt, 48) : '';
	if (call.number === null) return prompt;
	return prompt ? `${call.number}) ${prompt}` : `${call.number})`;
}

/** A call as a sentence names it; an unnamed call is "this question". */
export const callRef = (call: InboxCall) => callName(call) || 'this question';

/**
 * The picks as one line for Firstmate, e.g. "1) Approach: A (core gateway)  2) First
 * channel: Discord", or an error naming what is invalid or still missing.
 */
export function picksLine(
	choices: InboxChoices,
	picks: Picks
): { ok: true; line: string } | { ok: false; error: string } {
	const known = new Set(choices.calls.map((c) => c.id));
	const stray = Object.keys(picks).find((id) => !known.has(id));
	if (stray) return { ok: false, error: 'A pick names a call this question does not ask.' };
	const all = resolvePicks(choices, picks);
	const parts: string[] = [];
	for (const call of choices.calls) {
		const v = all[call.id];
		if (!v) {
			if (call.required) return { ok: false, error: `Pick an option for ${callRef(call)}.` };
			continue;
		}
		let answer: string;
		if (call.options.length) {
			const o = call.options.find((x) => x.id === v);
			if (!o) return { ok: false, error: `That is not an option for ${callRef(call)}.` };
			answer = o.detail ? `${o.label} (${oneLine(o.detail, 60)})` : oneLine(o.label, 80);
		} else {
			if (v.length > WRITTEN_MAX) {
				return { ok: false, error: `Answers are limited to ${WRITTEN_MAX} characters.` };
			}
			answer = oneLine(v, WRITTEN_MAX);
		}
		const name = callName(call);
		parts.push(name ? `${name}${/[?:]$/.test(name) ? '' : ':'} ${answer}` : answer);
	}
	return parts.length
		? { ok: true, line: parts.join('  ') }
		: { ok: false, error: 'Make a pick first.' };
}

/**
 * The message body Firstmate receives for an answer. The messenger adds the
 * `Re: <task id>` line; the `Decision key:` and `Answer:` lines are what the
 * inbox reads back (answerOf) to show the card as sent.
 */
export function answerText(
	card: InboxCard,
	choice: InboxChoice,
	note: string | null,
	picks: string | null = null,
	decided: string | null = null
): string {
	const option = card.options.find((o) => o.choice === choice)!;
	const lines = heading(card, 'answer');
	if (card.kind === 'merge' && card.evidence.pr)
		lines.push(`Pull request: ${card.evidence.pr.url}`);
	if (decided) {
		lines.push(`Answer: ${DECIDED_LABEL} - ${DECIDED_MEANING}`, `Picks: ${oneLine(decided, 300)}`);
	} else {
		lines.push(`Answer: ${option.label} - ${option.meaning}`);
		if (picks) lines.push(`Picks: ${picks}`);
	}
	return withNote(lines, note);
}

/**
 * The message that dismisses a question without an answer, with the captain's
 * reason. A held task is closed as dismissed, not as answered; a worker's
 * question is resolved on its key (the record the open decisions are folded
 * from). The `Decision key:` line is read back (answerOf) as a dismissal.
 */
export function closeText(card: InboxCard, reason: string | null): string {
	const lines = heading(card, 'dismiss');
	lines.push(`Dismiss: ${dismissAsk(card)}`);
	const r = reason?.trim();
	if (r) lines.push(`Reason: ${r}`);
	return lines.join('\n');
}

function dismissAsk(card: InboxCard): string {
	const settle = 'settle anything the work still waits for under your own rules.';
	if (card.kind === 'hold') {
		return `The captain dismissed this call without choosing an answer. Close the held task ${card.key} as dismissed (not answered), record the reason below, and ${settle}`;
	}
	if (card.kind === 'merge') {
		return `The captain dismissed this merge call: leave the pull request unmerged, stop asking about it, and ${settle}`;
	}
	if (/^open-\d+$/.test(card.key)) {
		return `The captain dismissed this question without choosing an answer. Record it closed so it leaves the open decisions, and ${settle}`;
	}
	return `The captain dismissed this question without choosing an answer. Record it resolved on key ${card.key} so it leaves the open decisions, and ${settle}`;
}

function heading(card: InboxCard, what: 'answer' | 'dismiss'): string[] {
	const mate = card.secondMate;
	return [
		`Decision inbox ${what} (${KIND_WORDS[card.kind]}).`,
		`Task: ${card.taskId} (${card.taskTitle})`,
		...(mate
			? [
					mate.taskId
						? `Second mate: ${mate.id}, about its task ${mate.taskId}${mate.taskTitle ? ` (${mate.taskTitle})` : ''}; pass this answer to that second mate.`
						: `Second mate: ${mate.id}; pass this answer to that second mate.`
				]
			: []),
		`Decision key: ${card.key}`,
		`Question: ${questionLine(card.question)}`
	];
}

function withNote(lines: string[], note: string | null): string {
	const n = note?.trim();
	if (n) lines.push(`Note: ${n}`);
	return lines.join('\n');
}

const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** A question as an answer's `Question:` line carries it. */
export const questionLine = (question: string) => oneLine(question, 300);

const labelChoice = (label: string): InboxChoice | undefined =>
	label === PICKS_LABEL || label === DECIDED_LABEL
		? 'approve'
		: CHOICES.find(
				(c) => LABEL[c] === label || Object.values(KIND_LABEL).some((l) => l?.[c] === label)
			);

/**
 * Read an inbox answer or dismissal back from a message's text: the key and
 * question it names, and the choice. A dismissal's reason reads as its note;
 * a close from before Dismiss reads as a dismissal.
 */
export function answerOf(text: string): {
	key: string;
	question: string | null;
	choice: InboxAction;
	picks: string | null;
	note: string | null;
} | null {
	const closing =
		text.startsWith('Decision inbox dismiss') || text.startsWith('Decision inbox close');
	if (!closing && !text.startsWith('Decision inbox answer')) return null;
	const key = /^Decision key: (.+)$/m.exec(text)?.[1]?.trim();
	const label = closing ? null : /^Answer: (.+?) - /m.exec(text)?.[1];
	const choice: InboxAction | undefined = closing
		? 'close'
		: label
			? labelChoice(label)
			: undefined;
	if (!key || !choice) return null;
	const question = /^Question: (.*)$/m.exec(text)?.[1] ?? null;
	const picks = /^Picks: (.*)$/m.exec(text)?.[1]?.trim() || null;
	const note = /^(?:Note|Reason): ([\s\S]*)$/m.exec(text)?.[1]?.trim() || null;
	return { key, question, choice, picks, note };
}

/* ------------------------------------------------------------ ask me later */

/** "Ask me later" hides a card in this browser only, for SNOOZE_MS. */
export const SNOOZE_MS = 4 * 3600 * 1000;
export const SNOOZE_KEY = 'wheelhouse-inbox-snoozed';

export type Snoozed = Record<string, number>;

/** Snoozes still in force (expired ones dropped). */
export function liveSnoozes(s: Snoozed, now: number): Snoozed {
	return Object.fromEntries(Object.entries(s).filter(([, until]) => until > now));
}

export function parseSnoozes(raw: string | null, now: number): Snoozed {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw) as unknown;
		if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
		const out: Snoozed = {};
		for (const [k, until] of Object.entries(v)) if (typeof until === 'number') out[k] = until;
		return liveSnoozes(out, now);
	} catch {
		return {};
	}
}

/** The cards still waiting to show now, and how many of them are snoozed. Answered cards are gone. */
export function visibleCards(
	cards: InboxCard[],
	snoozed: Snoozed,
	now: number
): { shown: InboxCard[]; snoozed: number } {
	const live = liveSnoozes(snoozed, now);
	const open = cards.filter(awaitsAnswer);
	const shown = open.filter((c) => !live[c.id]);
	return { shown, snoozed: open.length - shown.length };
}

/** No answer has reached Firstmate yet: none sent, or the latest was not delivered. */
export const awaitsAnswer = (c: InboxCard) => !c.sent || c.sent.delivery === 'failed';

/**
 * Firstmate escalated it to the captain: work it holds for the captain's call,
 * a green pull request waiting for the word to merge, or a preview waiting
 * for sign-off. Every other open question (a worker's decision, a blocker, the
 * review's questions) is Firstmate's to settle under its own rules: it shows
 * under Handled by Firstmate, where the captain can still take it over.
 */
export const escalated = (c: Pick<InboxCard, 'owner'>) => c.owner === 'captain';

/**
 * Cards still waiting for the captain's answer (the badge count): only what
 * Firstmate escalated, without those the captain is following up in the chat.
 */
export const openCount = (cards: InboxCard[], snoozed: Snoozed, now: number) =>
	visibleCards(
		cards.filter((c) => escalated(c) && !c.following),
		snoozed,
		now
	).shown.length;

/**
 * What a card says beyond its heading, in a line or two: Firstmate's words
 * without the heading they start with and without the options the form
 * already shows; null when they say nothing more.
 */
export function cardContext(c: Pick<InboxCard, 'question' | 'title' | 'choices'>): string | null {
	const words = c.choices
		? [c.choices.intro, c.choices.after].filter(Boolean).join(' ')
		: c.question;
	let rest = words.replace(/\s+/g, ' ').trim();
	const title = c.title.replace(/\s+/g, ' ').trim();
	if (rest.startsWith(title)) rest = rest.slice(title.length);
	rest = rest.replace(/^[\s:;,.–—-]+/, '').trim();
	return rest && rest !== title ? rest : null;
}

/** The card of the work Firstmate holds for the captain's call on a task (server/inbox/cards.ts). */
export const holdCardId = (taskId: string) => `${taskId}:captain-hold`;

/**
 * The task a card's follow-up is kept under: its task, or for a question
 * about a task in a second mate's home, that task there (`<task>@<mate>`).
 */
export const followKey = (c: Pick<InboxCard, 'taskId' | 'secondMate'>) =>
	c.secondMate?.taskId ? `${c.secondMate.taskId}@${c.secondMate.id}` : c.taskId;

/**
 * When a card is being followed up, from the record kept for its task: none
 * when the record is older than the question, which was asked after the
 * captain started following its task up.
 */
export const followingFor = (at: string | null, askedAt: string | null) =>
	at && !(askedAt && Date.parse(askedAt) > Date.parse(at)) ? at : null;

/** Where a card's task line leads:the task's page, or a second mate's place on the Second mates page. */
export const cardTaskHref = (c: Pick<InboxCard, 'taskId' | 'secondMate'>) =>
	c.secondMate?.taskId
		? `/tasks/${encodeURIComponent(`${c.secondMate.taskId}@${c.secondMate.id}`)}`
		: c.secondMate
			? `/second-mates#mate-${encodeURIComponent(c.secondMate.id)}`
			: `/tasks/${encodeURIComponent(c.taskId)}`;

/** The Decisions page, opened on one card. */
export const cardHref = (cardId: string) => `/inbox#card-${encodeURIComponent(cardId)}`;

/**
 * The keyboard: j/k move, a agrees, Enter or c opens it in the chat with
 * Firstmate, e shows the details, o writes another answer, l asks later, d dismisses.
 */
export type InboxKey =
	| { do: 'move'; by: 1 | -1 }
	| { do: 'agree' }
	| { do: 'chat' }
	| { do: 'later' }
	| { do: 'close' }
	| { do: 'other' }
	| { do: 'evidence' };

export function keyAction(key: string): InboxKey | null {
	switch (key) {
		case 'j':
		case 'ArrowDown':
			return { do: 'move', by: 1 };
		case 'k':
		case 'ArrowUp':
			return { do: 'move', by: -1 };
		case 'a':
			return { do: 'agree' };
		case 'Enter':
		case 'c':
			return { do: 'chat' };
		case 'e':
			return { do: 'evidence' };
		case 'o':
			return { do: 'other' };
		case 'l':
			return { do: 'later' };
		case 'd':
			return { do: 'close' };
		default:
			return null;
	}
}
