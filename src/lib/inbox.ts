/**
 * The decision inbox: every open question in one stack, answered with one tap.
 * Shared by the server (which builds the cards, see server/inbox/cards.ts) and
 * the browser (which shows them and remembers "Ask me later" per browser).
 *
 * An answer never bypasses Firstmate: it becomes an ordinary message through
 * `fm-inbox.sh note` whose body names the task, the decision key and the
 * chosen option (answerText), and Firstmate relays it under its own rules.
 * A card reads "sent to Firstmate" while its question is still open, and
 * leaves the stack when the question closes in Firstmate's records.
 */

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

export function optionsFor(kind: InboxKind): InboxOption[] {
	return CHOICES.map((choice) => ({
		choice,
		label: KIND_LABEL[kind]?.[choice] ?? LABEL[choice],
		meaning: MEANING[kind][choice]
	}));
}

/** A choice's button label on a card. */
export const choiceLabel = (card: InboxCard, c: InboxChoice) =>
	card.options.find((o) => o.choice === c)?.label ?? LABEL[c];

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

export interface InboxEvidence {
	/** What the worker or Firstmate wrote about it, in plain words. */
	text: string | null;
	findings: InboxFinding[];
	/** The findings file the question names (its file name only). */
	file: string | null;
	pr: { url: string; number: number | null } | null;
	preview: string | null;
	/** CI as Wheelhouse last read it. */
	checks: 'green' | 'red' | 'pending' | null;
	screenshots: { name: string; url: string }[];
}

export interface InboxCard {
	/** Stable: `<task id>:<decision key>`. */
	id: string;
	taskId: string;
	taskTitle: string;
	projectId: string | null;
	kind: InboxKind;
	/**
	 * The decision key the answer names: the status-log key as written, or
	 * `captain-hold`, `merge-pr` or `open-<n>` for questions Firstmate records without one.
	 */
	key: string;
	/** The question, in plain words. */
	question: string;
	/** When it was asked, when known. */
	askedAt: string | null;
	/** captain: waiting on the captain; firstmate: Firstmate is handling it unless the captain steps in. */
	owner: 'captain' | 'firstmate';
	evidence: InboxEvidence;
	options: InboxOption[];
	/** Firstmate's recommendation, when one is recorded. */
	recommendation: { choice: InboxChoice | null; text: string } | null;
	/**
	 * The captain's latest answer, sent to Firstmate while the question is still
	 * open. One whose delivery failed leaves the question waiting, with the reason.
	 */
	sent: {
		choice: InboxChoice;
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

/**
 * The message body Firstmate receives for an answer. The messenger adds the
 * `Re: <task id>` line; the `Decision key:` and `Answer:` lines are what the
 * inbox reads back (answerOf) to show the card as sent.
 */
export function answerText(card: InboxCard, choice: InboxChoice, note: string | null): string {
	const option = card.options.find((o) => o.choice === choice)!;
	const lines = [
		`Decision inbox answer (${KIND_WORDS[card.kind]}).`,
		`Task: ${card.taskId} (${card.taskTitle})`,
		`Decision key: ${card.key}`,
		`Question: ${questionLine(card.question)}`
	];
	if (card.kind === 'merge' && card.evidence.pr)
		lines.push(`Pull request: ${card.evidence.pr.url}`);
	lines.push(`Answer: ${option.label} - ${option.meaning}`);
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
	CHOICES.find(
		(c) => LABEL[c] === label || Object.values(KIND_LABEL).some((l) => l?.[c] === label)
	);

/** Read an inbox answer back from a message's text: the key and question it names, and the choice. */
export function answerOf(
	text: string
): { key: string; question: string | null; choice: InboxChoice; note: string | null } | null {
	if (!text.startsWith('Decision inbox answer')) return null;
	const key = /^Decision key: (.+)$/m.exec(text)?.[1]?.trim();
	const label = /^Answer: (.+?) - /m.exec(text)?.[1];
	const choice = label ? labelChoice(label) : undefined;
	if (!key || !choice) return null;
	const question = /^Question: (.*)$/m.exec(text)?.[1] ?? null;
	const note = /^Note: ([\s\S]*)$/m.exec(text)?.[1]?.trim() || null;
	return { key, question, choice, note };
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

/** The cards to show now, and how many are snoozed. Sent cards stay, so the captain sees them land. */
export function visibleCards(
	cards: InboxCard[],
	snoozed: Snoozed,
	now: number
): { shown: InboxCard[]; snoozed: number } {
	const live = liveSnoozes(snoozed, now);
	const shown = cards.filter((c) => !live[c.id]);
	return { shown, snoozed: cards.length - shown.length };
}

/** No answer has reached Firstmate yet: none sent, or the latest was not delivered. */
export const awaitsAnswer = (c: InboxCard) => !c.sent || c.sent.delivery === 'failed';

/** Cards still waiting for an answer (the badge count). */
export const openCount = (cards: InboxCard[], snoozed: Snoozed, now: number) =>
	visibleCards(cards, snoozed, now).shown.filter(awaitsAnswer).length;

/** The keyboard: j/k move, a/f/s answer, l asks later, Enter opens the evidence. */
export type InboxKey =
	| { do: 'move'; by: 1 | -1 }
	| { do: 'answer'; choice: InboxChoice }
	| { do: 'later' }
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
			return { do: 'answer', choice: 'approve' };
		case 'f':
			return { do: 'answer', choice: 'fix' };
		case 's':
			return { do: 'answer', choice: 'skip' };
		case 'l':
			return { do: 'later' };
		case 'Enter':
			return { do: 'evidence' };
		default:
			return null;
	}
}
