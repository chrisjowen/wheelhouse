/**
 * The form a decision is answered with, fitted to the question rather than the
 * same three buttons for every card. Shared by the chat (where decisions are
 * answered and talked through), the Decisions page's one-tap Agree, and the
 * server, which names the answer the same way when it records it. Pure, so it
 * is unit-tested.
 *
 * A card's own form comes from what Firstmate recorded:
 *
 * - the options its question names (server/inbox/options.ts): one call with
 *   options is a pick-then-Decide choice; several calls, or a written answer,
 *   keep the calls as they are (`picks`);
 * - otherwise two plain answers that fit the kind of question (Merge / Not yet
 *   on a merge call, Go ahead / Not like this on work held for the captain),
 *   each one tap; a review question keeps its three calls as a choice; and a
 *   held question that asks which, what or how is answered in words.
 *
 * When the captain talks a decision through, Firstmate can replace the form by
 * ending a reply with a `decision-form` block (the discussion message tells it
 * how, see lib/chat/discuss.ts):
 *
 *     ```decision-form
 *     Which should ship?
 *     - Welcome page, tour behind a link: a "Show me around" link opens it (recommended)
 *     - Welcome page only
 *     - Three-step tour
 *     ```
 *
 * Its first line is the question; each `- ` line an option, with `: ` before
 * what it means and `(recommended)` on the one Firstmate recommends; a line
 * `- (written)` asks for a written answer instead. Two options are one-tap
 * buttons; more are picked, then decided. The answer names the option's words
 * (`decided`), which Firstmate receives as the captain's pick. Every form also
 * takes an answer in the captain's own words (Other).
 *
 * A form can name the decision it asks (```` ```decision-form id=<task> ````,
 * the captain-held task's id): the chat then shows that decision's own card,
 * so it reads and is answered the same there as on the Decisions page.
 */
import type { InboxCard, InboxChoice, InboxChoices, InboxKind, Picks } from './inbox';

/** What answering with an option sends: one of the card's answers, and the picks or words it carries. */
export interface FormAnswer {
	choice: InboxChoice;
	/** The card's own picks (option id by call id), for a card whose question names its options. */
	picks: Picks | null;
	/** The words decided, for an option Firstmate wrote in the chat or a written answer. */
	decided: string | null;
	/** The captain's own words rather than one of the options (Other). */
	other?: boolean;
}

export interface FormOption {
	id: string;
	label: string;
	/** What it means, when it says more than the label. */
	detail: string | null;
	recommended: boolean;
	answer: FormAnswer;
}

export type DecisionForm =
	/** Two plain answers, each sent with one tap. */
	| { kind: 'buttons'; prompt: string | null; options: FormOption[]; from: FormSource }
	/** Options picked, then sent with Decide. */
	| { kind: 'choice'; prompt: string | null; options: FormOption[]; from: FormSource }
	/** The card's own calls, several or written, picked then sent with Decide. */
	| { kind: 'picks'; prompt: string | null; choices: InboxChoices; from: 'card' }
	/** A written answer. */
	| { kind: 'text'; prompt: string | null; from: FormSource };

/** card: read from the question as Firstmate recorded it; firstmate: written by Firstmate in the chat. */
export type FormSource = 'card' | 'firstmate';

/** The longest option label shown as a one-tap button, and the longest decided words. */
export const BUTTON_MAX = 28;
export const DECIDED_MAX = 300;

const answer = (choice: InboxChoice, more: Partial<FormAnswer> = {}): FormAnswer => ({
	choice,
	picks: null,
	decided: null,
	...more
});

/** The plain answers for a kind of question without named options, first the one meaning yes. */
const PLAIN: Record<InboxKind, { label: string; choice: InboxChoice }[]> = {
	merge: [
		{ label: 'Merge', choice: 'approve' },
		{ label: 'Not yet', choice: 'skip' }
	],
	preview: [
		{ label: 'Sign it off', choice: 'approve' },
		{ label: 'Request changes', choice: 'fix' }
	],
	hold: [
		{ label: 'Go ahead', choice: 'approve' },
		{ label: 'Not like this', choice: 'fix' }
	],
	decision: [
		{ label: 'Go ahead', choice: 'approve' },
		{ label: 'Change course', choice: 'fix' }
	],
	blocked: [
		{ label: 'Go ahead', choice: 'approve' },
		{ label: 'Try another way', choice: 'fix' }
	],
	review: [
		{ label: 'Keep it as is', choice: 'approve' },
		{ label: 'Fix it', choice: 'fix' },
		{ label: 'Leave it for later', choice: 'skip' }
	]
};

/** A question that asks for something other than yes or no ("Which should ship?"), by its last question. */
const OPEN_QUESTION = /^(?:which|what|how|where|who|when|why)\b/i;
function asksOpen(question: string | undefined): boolean {
	const asked = (question ?? '').match(/[^.?!]*\?/g);
	const last = asked?.[asked.length - 1]?.trim();
	return !!last && OPEN_QUESTION.test(last);
}

/** The form a card is answered with, from what Firstmate recorded about it. */
export function cardForm(
	card: Pick<InboxCard, 'kind' | 'choices' | 'recommendation'> & { question?: string }
): DecisionForm {
	const c = card.choices;
	if (c) {
		const [only] = c.calls;
		if (c.calls.length === 1 && only.options.length) {
			return {
				kind: 'choice',
				prompt: only.prompt,
				from: 'card',
				options: only.options.map((o) => ({
					id: o.id,
					label: o.label,
					detail: o.detail,
					recommended: o.recommended,
					answer: answer('approve', { picks: { [only.id]: o.id } })
				}))
			};
		}
		return { kind: 'picks', prompt: null, choices: c, from: 'card' };
	}
	// "Which should ship?" is not answered with Go ahead: without named options it is written.
	if ((card.kind === 'hold' || card.kind === 'decision') && asksOpen(card.question)) {
		return { kind: 'text', prompt: null, from: 'card' };
	}
	const rec = card.recommendation?.choice ?? (card.kind === 'merge' ? 'approve' : null);
	const plain = PLAIN[card.kind];
	const options = plain.map((p) => ({
		id: p.choice,
		label: p.label,
		detail: null,
		recommended: p.choice === rec,
		answer: answer(p.choice)
	}));
	return { kind: plain.length === 2 ? 'buttons' : 'choice', prompt: null, options, from: 'card' };
}

const BLOCK = /```decision-form[^\n]*\n([\s\S]*?)(?:```|$)/g;
const RECOMMENDED = /\s*\((?:recommended|rec)\)\s*/i;
const WRITTEN = /^\(written(?: answer)?\)$/i;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The last `decision-form` block in a reply of Firstmate's, as a form; null
 * when there is none or it names nothing to answer.
 */
export function formIn(text: string): DecisionForm | null {
	const blocks = [...text.matchAll(BLOCK)];
	const body = blocks[blocks.length - 1]?.[1];
	if (body === undefined) return null;
	let prompt: string | null = null;
	let written = false;
	const options: FormOption[] = [];
	for (const raw of body.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const item = /^[-*•]\s+(.*)$/.exec(line)?.[1];
		if (item === undefined) {
			prompt ??= tidy(line);
			continue;
		}
		if (WRITTEN.test(item.trim())) {
			written = true;
			continue;
		}
		const recommended = RECOMMENDED.test(item);
		const words = tidy(item.replace(RECOMMENDED, ' '));
		const cut = words.search(/:\s|\s[–—]\s/);
		const label = (cut > 0 ? words.slice(0, cut) : words).trim().slice(0, DECIDED_MAX);
		const detail =
			cut > 0
				? words
						.slice(cut)
						.replace(/^[:–—]?\s*/, '')
						.trim() || null
				: null;
		if (!label) continue;
		options.push({
			id: `o${options.length + 1}`,
			label,
			detail,
			recommended,
			answer: answer('approve', { decided: label })
		});
	}
	if (!options.length)
		return written || prompt ? { kind: 'text', prompt, from: 'firstmate' } : null;
	const buttons =
		options.length === 2 && options.every((o) => !o.detail && o.label.length <= BUTTON_MAX);
	return { kind: buttons ? 'buttons' : 'choice', prompt, options, from: 'firstmate' };
}

const ID = /^```decision-form[^\S\n]+(?:[^\n]*\s)?id=([A-Za-z0-9][\w.@-]{0,199})(?=\s|$)/;

/** The decision the last `decision-form` block in a reply names (`id=<task>`), if any. */
export function formIdIn(text: string): string | null {
	const blocks = [...text.matchAll(BLOCK)];
	const last = blocks[blocks.length - 1];
	return last ? (ID.exec(last[0])?.[1] ?? null) : null;
}

/** A reply of Firstmate's without its form blocks, for showing as words. */
export const withoutForm = (text: string) => text.replace(BLOCK, '').trim();

/** An option as one line names it: a lettered option with what it is, e.g. "A (core gateway)". */
export function optionName(o: Pick<FormOption, 'label' | 'detail'>): string {
	if (!o.detail || o.label.length > 3) return o.label;
	const d = o.detail.length > 40 ? o.detail.slice(0, 39).trimEnd() + '…' : o.detail;
	return `${o.label} (${d})`;
}

/** The option Firstmate recommends, when there is one: the Decisions page's one-tap Agree. */
export function recommendedOption(form: DecisionForm): FormOption | null {
	return form.kind === 'buttons' || form.kind === 'choice'
		? (form.options.find((o) => o.recommended) ?? null)
		: null;
}

/** How an answer reads once given: the words decided or picked, else the option's label. */
export function decidedLabel(
	form: DecisionForm | null,
	a: { choice: string; label: string; picks: string | null }
): string {
	if (a.picks) return a.picks;
	if (form && (form.kind === 'buttons' || form.kind === 'choice')) {
		const o = form.options.find((x) => x.answer.choice === a.choice && !x.answer.decided);
		if (o) return o.label;
	}
	return a.label;
}
