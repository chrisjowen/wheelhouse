/**
 * Questions Firstmate asks in the conversation itself, outside any decision
 * card: a reply of Firstmate's that ends with a `decision-form` block
 * (lib/decisionform.ts) shows its words without the block, then the form, as
 * a decision's discussion does. Firstmate only receives text, so answering
 * sends an ordinary chat message from the captain naming what they decided
 * and the question it answers, with any note after a blank line:
 *
 *     Decided: Welcome page only — for: “Which should ship?”
 *
 *     After the release, please.
 *
 * A form without a question line is answered with `Decided: <words>` alone,
 * or `Decided (other): <words>` for the captain's own words. Dismissing a form
 * answers nothing, and says so the same way, with the reason after a blank line:
 *
 *     Dismissed — for: “Which should ship?”
 *
 *     Reason: Already sorted elsewhere
 *
 * A form that names a decision (`id=<task>`) or asks a held decision's
 * question is that decision's card instead (Chat.svelte), answered through
 * the inbox like any card; the rest are quick questions, not tracked anywhere
 * but here.
 *
 * What was answered is read only from the conversation's own records: the
 * transcript for answers typed into the session, Wheelhouse's record of the
 * notes it sent to Firstmate's inbox (placed among the transcript's items by
 * when they were sent) for answers sent there while Firstmate runs in
 * another terminal, and the captain's messages still being sent, until one
 * of those shows them. The page keeps no record of its own, so a message
 * counts once, for one form, and an answer that failed and was discarded
 * leaves its form open again. An answer naming a question goes to the latest
 * form asked before it with that question that is still waiting, so a form
 * keeps its own answer even when a later one with another question was asked
 * first (an answer queued while Firstmate's turn went on); when the same
 * question was asked again, the latest asking takes it. An answer naming no
 * question goes to the latest form asked before it, only when that form is
 * still waiting and the words are one of its options (any words for a
 * written form). So every waiting form can be answered while it is the
 * latest form with its question; a form without a question only while it is
 * the latest form of all. Any other waiting form was replaced by a later one
 * and stays closed. Pure, so it is unit-tested.
 */
import { DECIDED_MAX, formIdIn, formIn, type DecisionForm, type FormAnswer } from '../decisionform';
import type { BridgeMessage } from '../types';
import type { Item } from './fold';
import type { Pending } from './outbox';

/** A form Firstmate asked in the conversation, and where it stands. */
export interface ChatForm {
	form: DecisionForm;
	/** The reply's words before the form, as its bubble shows them. */
	words: string;
	/** The decision it names (`id=<task>`), if any. */
	id: string | null;
	/** The words the captain decided, once answered. */
	decided: string | null;
	/** Dismissed without an answer: the reason given ('' for none); null otherwise. */
	dismissed: string | null;
	/** Still waiting, and the latest form with its question: one that can be answered. */
	active: boolean;
}

/** A reply's words and the form it ends with. */
export interface ReplyForm {
	form: DecisionForm;
	words: string;
	/** The decision it names (`id=<task>`), if any. */
	id: string | null;
}

/** An answer read back from a message: the words decided and the question it names, if any. */
export interface Answer {
	words: string;
	question: string | null;
	/** The captain's own words, not one of the options. */
	other: boolean;
	/** A dismissal, with its reason ('' for none); `words` is then empty. */
	dismissed: string | null;
}

const BLOCK = /```decision-form[^\n]*\n[\s\S]*?(?:```|$)/g;
const ANSWER = /^Decided( \(other\))?: (.+?)(?: — for: “(.+)”)?$/;
const DISMISSED = /^Dismissed(?: — for: “(.+)”)?$/;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The form a reply of Firstmate's ends with, and its words before it; null when it does not end with one. */
export function formAtEnd(text: string): ReplyForm | null {
	const blocks = [...text.matchAll(BLOCK)];
	const last = blocks[blocks.length - 1];
	if (!last || text.slice(last.index + last[0].length).trim()) return null;
	const form = formIn(text);
	return form && { form, words: text.slice(0, last.index).trim(), id: formIdIn(text) };
}

/** The message Firstmate receives for an answer to a form; empty when it names nothing. */
export function answerText(form: DecisionForm, a: FormAnswer, note: string | null): string {
	const words = tidy(a.decided ?? '').slice(0, DECIDED_MAX);
	if (!words) return '';
	const question = tidy(form.prompt ?? '');
	const line = question
		? `Decided: ${words} — for: “${question}”`
		: `Decided${a.other ? ' (other)' : ''}: ${words}`;
	const more = note?.trim();
	return more ? `${line}\n\n${more}` : line;
}

/** The message Firstmate receives when the captain dismisses a form without answering it. */
export function dismissText(form: DecisionForm, reason: string | null): string {
	const question = tidy(form.prompt ?? '');
	const line = question ? `Dismissed — for: “${question}”` : 'Dismissed';
	const why = tidy(reason ?? '');
	return why ? `${line}\n\nReason: ${why}` : line;
}

/** What a sent answer decided, and the question it names; null when the message is not one. */
export function parseAnswer(text: string): Answer | null {
	const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
	const d = DISMISSED.exec(lines[0]);
	if (d) {
		const why = lines.slice(1).find((l) => l.startsWith('Reason: '));
		return {
			words: '',
			question: d[1] ? tidy(d[1]) : null,
			other: false,
			dismissed: why ? tidy(why.slice('Reason: '.length)) : ''
		};
	}
	const m = ANSWER.exec(lines[0]);
	const words = m ? tidy(m[2]) : '';
	return words
		? { words, question: m?.[3] ? tidy(m[3]) : null, other: !!m?.[1], dismissed: null }
		: null;
}

/** Whether what a message decided answers a form: one of its answers, or the captain's own words. */
const fits = (form: DecisionForm, a: Answer) =>
	a.other ||
	a.dismissed !== null ||
	form.kind === 'text' ||
	(form.kind !== 'picks' && form.options.some((o) => o.answer.decided === a.words));

/**
 * The forms Firstmate asked in the conversation, by the id of the reply part
 * that asks each. `hidden` are the items in a decision's thread, whose forms
 * belong to that decision; `inbox` Wheelhouse's record of the notes it sent
 * to Firstmate's inbox, which count from when they were sent unless their
 * delivery failed; `pending` the captain's messages from this page not in
 * either yet, which come after everything. A pending message is left out once
 * the transcript or the inbox record shows it after the point it was sent,
 * including as a failed note, which answers nothing.
 */
export function chatForms(
	items: Item[],
	hidden: ReadonlySet<string>,
	pending: Pick<Pending, 'text' | 'after'>[] = [],
	inbox: BridgeMessage[] = []
): Map<string, ChatForm> {
	// The conversation in order: its items, with the inbox notes placed among them by when they were sent.
	// A failed note still shows its pending copy, so that copy is left out, but answers nothing.
	const said: { id: string | null; text: string | null; item: Item | null; failed: boolean }[] = [];
	const note = (m: BridgeMessage) => ({
		id: null,
		text: m.text,
		item: null,
		failed: m.delivery === 'failed'
	});
	let n = 0;
	for (const it of items) {
		const at = Date.parse(it.at);
		while (n < inbox.length && Date.parse(inbox[n].submittedAt) < at) said.push(note(inbox[n++]));
		if (hidden.has(it.id)) continue;
		said.push({ id: it.id, text: it.kind === 'user' ? it.text : null, item: it, failed: false });
	}
	for (const m of inbox.slice(n)) said.push(note(m));

	const shown = new Set<number>();
	const unshown = pending.filter((p) => {
		const from = said.findIndex((x) => x.id !== null && x.id === p.after);
		const echo = said.findIndex(
			(x, i) => i > from && !shown.has(i) && x.text !== null && tidy(x.text) === tidy(p.text)
		);
		if (echo < 0) return true;
		shown.add(echo);
		return false;
	});

	const out = new Map<string, ChatForm>();
	// Every form asked so far, oldest first.
	const asked: ChatForm[] = [];
	const waiting = (f: ChatForm) => f.decided === null && f.dismissed === null;
	const answer = (text: string) => {
		const a = parseAnswer(text);
		if (!a) return;
		const to = a.question
			? asked.findLast((f) => waiting(f) && tidy(f.form.prompt ?? '') === a.question)
			: asked.at(-1);
		if (!to || !waiting(to) || !(a.question || fits(to.form, a))) return;
		if (a.dismissed !== null) to.dismissed = a.dismissed;
		else to.decided = a.words;
	};
	for (const { text, item, failed } of said) {
		if (text !== null && !failed) answer(text);
		if (item?.kind !== 'turn') continue;
		for (const p of item.parts) {
			const reply = p.kind === 'text' ? formAtEnd(p.text) : null;
			if (!reply) continue;
			const f: ChatForm = { ...reply, decided: null, dismissed: null, active: false };
			out.set(p.id, f);
			asked.push(f);
		}
	}
	for (const p of unshown) answer(p.text);
	const seen = new Set<string>();
	for (const f of asked.toReversed()) {
		const key = f.form.prompt ? tidy(f.form.prompt) : null;
		f.active = waiting(f) && (key === null ? f === asked.at(-1) : !seen.has(key));
		if (key !== null) seen.add(key);
	}
	return out;
}
