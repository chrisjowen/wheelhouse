import { ago } from './format';
import type { Available, CheckStepState, Pipeline, Verdict } from './types';

/**
 * What the captain can see about a task while it is built: the conversation
 * between the worker and Firstmate, what each validation step found, and the
 * docs and decision records the session read or changed. Shared by the server
 * (server/buildlog) and the task page. Everything here is already in plain words.
 */

/** Who said something: the task's worker, Firstmate, the captain, or the automated review. */
export type Party = 'worker' | 'firstmate' | 'captain' | 'review';

/**
 * One exchange in a task's conversation.
 *   question  the worker asked Firstmate to decide something
 *   blocked   the worker was stuck and asked for help
 *   review    the automated review raised questions, put to Firstmate
 *   steer     Firstmate sent the worker an instruction
 *   captain   the captain wrote to Firstmate about this task
 */
export interface TalkEntry {
	/** Stable anchor (not shown). */
	id: string;
	at: string;
	kind: 'question' | 'blocked' | 'review' | 'steer' | 'captain';
	from: Party;
	to: Party;
	/** One plain line. */
	title: string;
	/** The rest of what was said, when there is more than the title. */
	body: string | null;
	/** The review's questions, each with Firstmate's call once it is made. */
	questions: AskedQuestion[];
	reply: { at: string | null; from: Party; text: string } | null;
	/**
	 * open       asked and not answered yet
	 * answered   answered (by Firstmate, or by the captain through Firstmate)
	 * cleared    closed without an answer recorded (the worker moved on)
	 * read       an instruction the worker has read
	 * unread     an instruction the worker has not read yet
	 * sent       the captain's message, with its delivery in the label
	 */
	outcome: { state: 'open' | 'answered' | 'cleared' | 'read' | 'unread' | 'sent'; label: string };
}

/** One review question put to Firstmate, in plain words. */
export interface AskedQuestion {
	/** Stable anchor (not shown). */
	id: string;
	/** What was asked, in a sentence or two. */
	summary: string;
	/** The whole question, when there is more than the summary. */
	detail: string | null;
	/** Where in the change, e.g. "src/lib/export.ts, line 23". */
	where: string | null;
	/** The review marked it as an error. */
	serious: boolean;
	/** waiting: Firstmate has not answered; answered: it has; closed: closed with no answer recorded. */
	status: 'waiting' | 'answered' | 'closed';
	/** Firstmate's call on this question, once answered. */
	verdict: Verdict | null;
	reason: string | null;
}

/** A round of review questions put to Firstmate together. */
export interface QuestionRound {
	/** Stable anchor (not shown). */
	id: string;
	/** Where it was raised, in words: "the automated review", "the tests". */
	raisedIn: string;
	askedAt: string;
	answeredAt: string | null;
	status: AskedQuestion['status'];
	questions: AskedQuestion[];
	/** Only the start of Firstmate's answer was kept. */
	answerCut: boolean;
}

/** What a test run came to. Counts are null when the source does not give them. */
export interface TestResult {
	passed: number | null;
	failed: number | null;
	skipped: number | null;
	/** Where the result comes from, in plain words. */
	basis: string;
	/** Failed tests by name, with the start of what they printed. */
	failures: { name: string; output: string }[];
	/** Scenarios the test step drove, from the pull request's testing notes. */
	scenarios: { name: string; result: 'pass' | 'fail' | 'untested' | 'other'; detail: string }[];
}

/** One validation step and what it found. */
export interface CheckReport {
	/** The no-mistakes step key (never shown). */
	key: string;
	label: string;
	state: CheckStepState;
	/** What it came to, in one plain line. */
	summary: string;
	durationMs: number | null;
	/** What the step did, in plain sentences (its own narration and fix commits). */
	notes: string[];
	tests: TestResult | null;
	/** Docs step: the documentation the change touches and what the step wrote about it. */
	docs: { files: { title: string; path: string }[]; summary: string[] } | null;
}

export interface ChecksView {
	/** When the run started, when known. */
	startedAt: string | null;
	outcome: Pipeline['outcome'] | null;
	/** How many validation runs the task has had (the report is of the latest). */
	runs: number;
	steps: CheckReport[];
	/** The pull request's own summary of its testing, when it has one. */
	testingNote: string | null;
}

/** A document or decision record the task's session read or changed. */
export interface DocRef {
	/** Path in the repository (the reader's key; only the file name is shown). */
	path: string;
	name: string;
	/** Its first heading, else a readable name. */
	title: string;
	kind: 'decision' | 'readme' | 'doc';
	changed: boolean;
	read: boolean;
	additions: number | null;
	deletions: number | null;
	/** The file on GitHub, when the project is there. */
	github: string | null;
}

export interface BuildInsight {
	conversation: Available<TalkEntry[]>;
	checks: Available<ChecksView>;
	docs: Available<DocRef[]>;
}

/** One document, for the reader page. */
export type DocView = Available<{
	path: string;
	name: string;
	title: string;
	kind: DocRef['kind'];
	markdown: string;
	truncated: boolean;
	github: string | null;
	/** This task's work changed it (else the worker only read it). */
	changed: boolean;
}>;

/**
 * The Harbour card's hint: questions asked about the task (each review finding counts), and the
 * docs and decision records its session referenced (read or changed), of which `docsChanged` changed.
 */
export interface BuildHint {
	questions: number;
	open: number;
	docs: number;
	docsChanged: number;
	/** The automated review's question rounds, newest first, with each question and Firstmate's call. */
	rounds: QuestionRound[];
}

export const DOC_KIND_LABEL: Record<DocRef['kind'], string> = {
	decision: 'Decision record',
	readme: 'Readme',
	doc: 'Doc'
};

export const PARTY_LABEL: Record<Party, string> = {
	worker: 'The worker',
	firstmate: 'Firstmate',
	captain: 'You',
	review: 'The automated review'
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The card's one line, in its two parts (the docs part opens the Docs tab), or null when there is nothing to say. */
export function hintLine(
	h: BuildHint | null | undefined
): { questions: string | null; docs: string | null } | null {
	if (!h || (!h.questions && !h.docs)) return null;
	const answered = h.questions - h.open;
	const questions = !h.questions
		? null
		: h.open
			? answered
				? `${plural(answered, 'question')} answered, ${h.open} open`
				: `${plural(h.open, 'question')} open`
			: `${plural(h.questions, 'question')} answered`;
	const docs = !h.docs
		? null
		: `${plural(h.docs, 'doc')} referenced${h.docsChanged ? ` · ${h.docsChanged} changed` : ''}`;
	return { questions, docs };
}

/** An opaque, stable anchor for a question round, from its decision key and when it was asked (neither is shown). */
export function roundId(key: string, askedAt: number): string {
	let h = 0x811c9dc5;
	for (const ch of `${key}@${askedAt}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
	return `q${h.toString(36)}`;
}

/** A question round in one plain line, e.g. "The automated review asked 3 questions 4 min ago · waiting on Firstmate". */
export function roundLine(r: QuestionRound, now: number): string {
	const who = r.raisedIn.charAt(0).toUpperCase() + r.raisedIn.slice(1);
	const asked = `${who} asked ${r.questions.length === 1 ? 'a question' : plural(r.questions.length, 'question')} ${ago(r.askedAt, now)}`;
	if (r.status === 'answered')
		return `${asked} · Firstmate answered ${ago(r.answeredAt, now)}${r.answerCut ? ' (only the start of its answer was kept)' : ''}`;
	if (r.status === 'closed') return `${asked} · closed without an answer`;
	return `${asked} · waiting on Firstmate`;
}

/** A test result in one plain line. */
export function testLine(t: TestResult): string {
	const { passed, failed, skipped } = t;
	if (passed !== null || failed !== null) {
		const total = (passed ?? 0) + (failed ?? 0);
		const skip = skipped ? `, ${skipped} skipped` : '';
		const live = t.scenarios.length
			? `; ${t.scenarios.filter((s) => s.result === 'pass').length} of ${plural(t.scenarios.length, 'scenario')} passed when tried live`
			: '';
		if (failed) return `${failed} of ${plural(total, 'test')} failed${skip}${live}`;
		return `All ${plural(total, 'test')} passed${skip}${live}`;
	}
	if (t.scenarios.length) {
		const n = (r: string) => t.scenarios.filter((s) => s.result === r).length;
		const parts = [`${n('pass')} of ${plural(t.scenarios.length, 'scenario')} passed`];
		if (n('fail')) parts.push(`${n('fail')} failed`);
		if (n('untested')) parts.push(`${n('untested')} not tested`);
		return parts.join(', ');
	}
	return t.failures.length ? `${plural(t.failures.length, 'test')} failed` : 'Tests ran';
}
