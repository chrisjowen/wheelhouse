import type { GuideItem, HunkKind, ReviewFile, ReviewHunk, ReviewRun } from '../../prreview';
import { BOILERPLATE_LABEL } from '../../prreview';
import { hunkText } from './diff';
import { recordsText, type TaskRecord } from './records';

/**
 * What the review agent is told. Every prompt carries the task's records (each
 * labelled, see records.ts) and the diff with each hunk's id, and says plainly
 * that a reason not in the records is not a recorded reason.
 */

/** About this much of the diff goes into a prompt; the rest is listed by file. */
export const DIFF_BUDGET = 160 * 1024;

const GROUND = `Ground every "why" in the task's records, cited by their labels in square brackets (for example [I1], [C2], [F3]). If no record gives the reason for something, say so plainly ("No recorded reason.") and, only if it helps, add your own reading clearly marked as your inference. Never present a guess as the recorded reason.`;

export const GUIDE_SYSTEM = `You are the review guide for a pull request in Wheelhouse, written for the captain: the person who asked for this work and must decide whether it is right. You cannot run tools or change anything; you only read what you are given and answer.

Your job: rank the hunks so the captain reads the important ones first (behaviour changes, risky areas such as security, data loss, concurrency or error handling, and public APIs or interfaces), and for each important hunk explain what it does and why it was done this way. ${GROUND}

Answer with one JSON object and nothing else (no prose, no code fence):
{"summary": string, "items": [{"hunk": string, "importance": "key" | "notable" | "routine", "kind": "behaviour" | "risk" | "api" | "test" | "docs" | "other", "title": string, "what": string, "why": string | null, "basis": "recorded" | "inferred" | "none", "sources": string[]}]}

- summary: two or three plain sentences on what the change does as a whole.
- items: ranked, most important first. Include every hunk id you were shown, once. Use "key" for the few hunks the captain must read, "notable" for ones worth a look, "routine" for the rest (for routine hunks keep title short and what to one short sentence, why null, basis "none", sources []).
- title: a few words. what: one or two sentences.
- basis "recorded": why rests on the cited records (sources lists their labels). "inferred": no record says why; why is your reading, and must start with "Not recorded:". "none": no reason recorded and none offered (why null).
- Write in plain words, no Markdown.`;

export const ASK_SYSTEM = `You answer the captain's questions about a pull request in Wheelhouse. The captain asked for this work and decides whether it is right. You cannot run tools or change anything: you only read the diff and the task's records you are given. ${GROUND} If the diff or records do not show the answer, say what is missing rather than guessing. Be direct and brief: short paragraphs or a short list, Markdown allowed, quote code only when it helps. Do not write patches; if a change looks needed, say what and why, and the captain can ask Firstmate for it.`;

export const REVIEW_SYSTEM = `You give a focused code review of a pull request (or one hunk of it) in Wheelhouse, for the captain who asked for the work. You cannot run tools or change anything: you only read the diff and the task's records you are given. Look for correctness bugs, risky behaviour (security, data loss, concurrency, error handling), missing tests and anything that contradicts the captain's intent or the spec. Use the records to understand what was intended, cite them by label when you rely on them, and do not repeat findings the records show were already raised and settled unless the code still contradicts the call. Answer in Markdown: a one-line verdict first, then findings as a short list, most serious first, each with where it is and why it matters. If you find nothing worth raising, say so in one line. Do not write patches.`;

/** The diff for a prompt: every hunk with its id, cut to the budget; boilerplate only by file. */
export function diffForPrompt(
	files: ReviewFile[],
	focus: string | null = null,
	budget = DIFF_BUDGET
): { text: string; shown: Set<string> } {
	const shown = new Set<string>();
	const parts: string[] = [];
	const folded: string[] = [];
	const left: string[] = [];
	let used = 0;
	const focusHunk = focus ? files.flatMap((f) => f.hunks).find((h) => h.id === focus) : null;
	if (focusHunk) used += hunkText(focusHunk).length;
	for (const f of files) {
		if (f.boilerplate) {
			folded.push(
				`${f.path} (${BOILERPLATE_LABEL[f.boilerplate].toLowerCase()}, +${f.additions} −${f.deletions})`
			);
			continue;
		}
		const head = `### ${f.status} ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}`;
		const body: string[] = [];
		for (const h of f.hunks) {
			if (h.boilerplate) {
				body.push(`[hunk ${h.id}] ${h.header} (${BOILERPLATE_LABEL[h.boilerplate].toLowerCase()})`);
				continue;
			}
			const t = hunkText(h);
			if (h.id !== focus && used + t.length > budget) {
				left.push(`${f.path} ${h.header}`);
				continue;
			}
			if (h.id !== focus) used += t.length;
			shown.add(h.id);
			body.push(`[hunk ${h.id}]\n${t}`);
		}
		if (body.length) parts.push(`${head}\n${body.join('\n')}`);
	}
	if (folded.length) parts.push(`Boilerplate files, not shown:\n${folded.join('\n')}`);
	if (left.length) parts.push(`Hunks left out because the diff is large:\n${left.join('\n')}`);
	return { text: parts.join('\n\n'), shown };
}

const context = (o: { title: string; prUrl: string | null; records: TaskRecord[] }) =>
	`Task: ${o.title}${o.prUrl ? `\nPull request: ${o.prUrl}` : ''}

## The task's records
${recordsText(o.records)}`;

export function guidePrompt(o: {
	title: string;
	prUrl: string | null;
	records: TaskRecord[];
	files: ReviewFile[];
}): { prompt: string; shown: Set<string> } {
	const diff = diffForPrompt(o.files);
	return {
		shown: diff.shown,
		prompt: `${context(o)}

## The diff
${diff.text}

Write the guide now, as the JSON object described.`
	};
}

const history = (runs: ReviewRun[]) =>
	runs
		.filter((r) => r.kind === 'ask' && r.status === 'done')
		.slice(-4)
		.map((r) => `Captain: ${r.question}\nYou: ${r.text}`)
		.join('\n\n');

export function askPrompt(o: {
	title: string;
	prUrl: string | null;
	records: TaskRecord[];
	files: ReviewFile[];
	hunk: ReviewHunk | null;
	question: string;
	earlier: ReviewRun[];
	guideSummary: string | null;
}): string {
	const diff = diffForPrompt(o.files, o.hunk?.id ?? null, o.hunk ? DIFF_BUDGET / 2 : DIFF_BUDGET);
	const before = history(o.earlier);
	return `${context(o)}
${o.guideSummary ? `\n## The guide's summary\n${o.guideSummary}\n` : ''}
## The diff
${diff.text}
${o.hunk ? `\n## The hunk the question is about\n[hunk ${o.hunk.id}] ${o.hunk.path}\n${hunkText(o.hunk)}\n` : ''}${before ? `\n## Earlier questions here\n${before}\n` : ''}
## The captain's question
${o.question}`;
}

export function reviewPrompt(o: {
	title: string;
	prUrl: string | null;
	records: TaskRecord[];
	files: ReviewFile[];
	hunk: ReviewHunk | null;
}): string {
	const diff = diffForPrompt(o.files, o.hunk?.id ?? null);
	return `${context(o)}

## The diff
${diff.text}

${o.hunk ? `Review this hunk (read the rest of the diff only for context):\n[hunk ${o.hunk.id}] ${o.hunk.path}\n${hunkText(o.hunk)}` : 'Review the whole pull request.'}`;
}

const KINDS: HunkKind[] = ['behaviour', 'risk', 'api', 'test', 'docs', 'other'];
const IMPORTANCE = ['key', 'notable', 'routine'] as const;
const str = (v: unknown, max = 1200) =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** The first JSON object in the agent's answer (it may wrap it in a code fence). */
function jsonIn(text: string): unknown {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

/**
 * The guide from the agent's answer, checked: only hunks that exist, each once;
 * sources only labels that exist; a "recorded" why with no real source becomes
 * the agent's inference, and an inference is always marked as one.
 */
export function parseGuide(
	text: string,
	hunks: Set<string>,
	labels: Set<string>
): { summary: string; items: GuideItem[] } | null {
	const v = jsonIn(text) as { summary?: unknown; items?: unknown } | null;
	if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return null;
	const items: GuideItem[] = [];
	const seen = new Set<string>();
	for (const raw of v.items as Record<string, unknown>[]) {
		const hunk = str(raw?.hunk, 40);
		if (!hunk || !hunks.has(hunk) || seen.has(hunk)) continue;
		seen.add(hunk);
		const sources = Array.isArray(raw.sources)
			? [...new Set(raw.sources.filter((s): s is string => typeof s === 'string' && labels.has(s)))]
			: [];
		let why = str(raw.why);
		let basis: GuideItem['basis'] =
			raw.basis === 'recorded' || raw.basis === 'inferred' ? raw.basis : 'none';
		if (basis === 'recorded' && !sources.length) basis = why ? 'inferred' : 'none';
		if (!why) basis = 'none';
		if (basis === 'none') why = null;
		if (basis === 'inferred' && why && !/^not recorded/i.test(why)) why = `Not recorded: ${why}`;
		items.push({
			hunk,
			importance: IMPORTANCE.includes(raw.importance as never)
				? (raw.importance as GuideItem['importance'])
				: 'routine',
			kind: KINDS.includes(raw.kind as HunkKind) ? (raw.kind as HunkKind) : 'other',
			title: str(raw.title, 120) ?? 'Change',
			what: str(raw.what, 600) ?? '',
			why,
			basis,
			sources: basis === 'recorded' ? sources : []
		});
	}
	return { summary: str(v.summary, 1500) ?? '', items };
}
