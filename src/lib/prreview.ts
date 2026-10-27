/**
 * The live PR review: a task's pull request as a diff, with a guide written by
 * a read-only review agent on top (the important hunks first, with why each was
 * done that way, from the task's own records), and questions and focused
 * reviews the captain asks for. Shared by the server (server/prreview) and the
 * review page. Nothing here writes code: a change the captain wants goes to
 * Firstmate as a note.
 */

/** Why a hunk is folded away as boilerplate. */
export type Boilerplate = 'lockfile' | 'generated' | 'snapshot' | 'formatting' | 'binary';

export const BOILERPLATE_LABEL: Record<Boilerplate, string> = {
	lockfile: 'Lockfile',
	generated: 'Generated file',
	snapshot: 'Test snapshot',
	formatting: 'Formatting only',
	binary: 'Binary file'
};

export interface ReviewHunk {
	/** Stable for this head: a hash of the file and the hunk's lines. */
	id: string;
	path: string;
	/** The `@@ -a,b +c,d @@ context` line. */
	header: string;
	/** The hunk's lines, each starting with ' ', '+', '-' or '\'. */
	lines: string[];
	/** First line number on the new side. */
	newStart: number;
	additions: number;
	deletions: number;
	boilerplate: Boilerplate | null;
	/** The guide's agent was not shown this hunk (the diff was too large). */
	unseen: boolean;
}

export interface ReviewFile {
	path: string;
	oldPath: string | null;
	/** A, M, D, R. */
	status: string;
	additions: number;
	deletions: number;
	boilerplate: Boilerplate | null;
	hunks: ReviewHunk[];
}

/** What a hunk is, in the guide's words. */
export type HunkKind = 'behaviour' | 'risk' | 'api' | 'test' | 'docs' | 'other';

export const KIND_LABEL: Record<HunkKind, string> = {
	behaviour: 'Behaviour change',
	risk: 'Risky area',
	api: 'Public API',
	test: 'Tests',
	docs: 'Docs',
	other: 'Change'
};

/**
 * Where the guide's "why" comes from.
 *   recorded  the task's records say so (sources name which)
 *   inferred  no record says why; this is the agent's reading of the code
 *   none      no recorded reason, and the agent offers none
 */
export type WhyBasis = 'recorded' | 'inferred' | 'none';

export interface GuideItem {
	hunk: string;
	importance: 'key' | 'notable' | 'routine';
	kind: HunkKind;
	/** A few words: what this hunk does. */
	title: string;
	/** What changed, in a sentence or two. */
	what: string;
	why: string | null;
	basis: WhyBasis;
	/** Record labels the why rests on (see RecordRef). */
	sources: string[];
}

/** One of the task's records the agent was given, by its label. */
export interface RecordRef {
	/** I1, S1, C1, F1, P1 … */
	label: string;
	/** In plain words: "Captain's intent", "Commit 3f2a1c0", "Review finding". */
	name: string;
	/** The start of what it says. */
	excerpt: string;
}

export interface Usage {
	/** The CLI's own cost figure, at list price (a subscription is not billed per run). */
	costUsd: number | null;
	inputTokens: number;
	outputTokens: number;
	/** Cache reads and writes, counted in with input. */
	cachedTokens: number;
	durationMs: number;
	model: string;
}

export type RunKind = 'guide' | 'ask' | 'review';
export type RunStatus = 'running' | 'done' | 'failed' | 'stopped';

export interface ReviewRun {
	id: string;
	kind: RunKind;
	/** The hunk it is about; null for the whole pull request. */
	hunk: string | null;
	/** The captain's question (ask runs). */
	question: string | null;
	status: RunStatus;
	/** The answer so far (Markdown); for the guide, what the agent wrote. */
	text: string;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	model: string;
	effort: string;
	usage: Usage | null;
}

export interface Guide {
	runId: string;
	head: string;
	at: string;
	/** The change as a whole, in two or three sentences. */
	summary: string;
	/** Ranked: the order to read the change in. */
	items: GuideItem[];
	/** Hunks the agent was not shown, because the diff was too large. */
	unseen: string[];
	records: RecordRef[];
	usage: Usage | null;
	model: string;
	effort: string;
}

export interface ReviewConfig {
	model: string;
	effort: string;
	/** Models offered beside the default. */
	models: string[];
	efforts: string[];
	/** The agent cannot run here (no claude CLI, turned off): why. */
	unavailable: string | null;
}

export type ReviewView =
	| {
			schema: 'wheelhouse-pr-review.v1';
			available: true;
			taskId: string;
			pr: { url: string; number: number | null; title: string | null } | null;
			head: string;
			base: string;
			/** Where the diff was read from, in plain words. */
			source: string;
			files: ReviewFile[];
			/** The diff was cut to its first files or lines. */
			truncated: boolean;
			guide: Guide | null;
			/** A guide written for an earlier head of this PR, when there is none for this one. */
			staleGuide: { head: string; at: string } | null;
			/** Questions and reviews for this head, oldest first, and the guide's run. */
			runs: ReviewRun[];
			config: ReviewConfig;
	  }
	| { schema: 'wheelhouse-pr-review.v1'; available: false; taskId: string; reason: string };

/** A live update on the shared event stream (`review` events). */
export type ReviewEvent =
	| { taskId: string; head: string; type: 'run'; run: ReviewRun }
	| { taskId: string; head: string; type: 'text'; runId: string; text: string }
	| { taskId: string; head: string; type: 'guide'; guide: Guide };

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);

/** The small cost and usage note under a run. */
export function usageLine(u: Usage, effort: string): string {
	const cost =
		u.costUsd === null
			? null
			: u.costUsd < 0.01
				? `under 1¢`
				: `$${u.costUsd.toFixed(u.costUsd < 1 ? 3 : 2)}`;
	const parts = [
		cost ? `${cost} at list price` : null,
		`${k(u.inputTokens + u.cachedTokens)} tokens in, ${k(u.outputTokens)} out`,
		`${u.model}${effort ? `, ${effort} effort` : ''}`,
		`${Math.max(1, Math.round(u.durationMs / 1000))} s`
	];
	return parts.filter(Boolean).join(' · ');
}

/** What the agent has spent on this pull request's head so far. */
export function spent(runs: ReviewRun[]): { usd: number; runs: number } {
	let usd = 0;
	let n = 0;
	for (const r of runs) {
		if (!r.usage) continue;
		n++;
		usd += r.usage.costUsd ?? 0;
	}
	return { usd, runs: n };
}

/**
 * The hunks in reading order: the guide's ranked items first (key, then
 * notable, in its order), then everything else in file order, boilerplate last.
 */
export function readingOrder(
	files: ReviewFile[],
	guide: Guide | null
): { start: ReviewHunk[]; rest: ReviewHunk[]; boilerplate: ReviewHunk[] } {
	const all = files.flatMap((f) => f.hunks);
	const byId = new Map(all.map((h) => [h.id, h]));
	const start: ReviewHunk[] = [];
	const taken = new Set<string>();
	for (const imp of ['key', 'notable'] as const) {
		for (const it of guide?.items ?? []) {
			const h = byId.get(it.hunk);
			if (it.importance !== imp || !h || h.boilerplate || taken.has(h.id)) continue;
			start.push(h);
			taken.add(h.id);
		}
	}
	const rest = all.filter((h) => !taken.has(h.id) && !h.boilerplate);
	const boilerplate = all.filter((h) => h.boilerplate);
	return { start, rest, boilerplate };
}

/** A short form of a hunk for headings: "src/a.ts, line 42". */
export const hunkWhere = (h: Pick<ReviewHunk, 'path' | 'newStart'>) =>
	`${h.path}, line ${h.newStart}`;

/** The note sent to Firstmate when the captain asks for a change from the review. */
export function changeNote(
	pr: { url: string } | null,
	hunk: Pick<ReviewHunk, 'path' | 'newStart'> | null,
	text: string
): string {
	const where = hunk ? ` at ${hunkWhere(hunk)}` : '';
	const on = pr ? ` (${pr.url})` : '';
	return `Change requested from the PR review${on}${where}:\n${text.trim()}`;
}

/** Read a changeNote back: the file and line it names, and what was asked. */
export function changeNoteOf(
	text: string
): { where: { path: string; line: number } | null; text: string } | null {
	const m =
		/^Change requested from the PR review(?: \([^)\n]*\))?(?: at (.+), line (\d+))?:\n([\s\S]*)$/.exec(
			text
		);
	if (!m) return null;
	return { where: m[1] ? { path: m[1], line: Number(m[2]) } : null, text: m[3].trim() };
}

/** A review view with a live update applied (events for another task or head change nothing). */
export function applyReviewEvent(view: ReviewView, e: ReviewEvent): ReviewView {
	if (!view.available || e.taskId !== view.taskId || e.head !== view.head) return view;
	if (e.type === 'guide') return { ...view, guide: e.guide, staleGuide: null };
	if (e.type === 'text') {
		return {
			...view,
			runs: view.runs.map((r) =>
				r.id === e.runId && r.status === 'running' ? { ...r, text: e.text } : r
			)
		};
	}
	const at = view.runs.findIndex((r) => r.id === e.run.id);
	const runs =
		at < 0 ? [...view.runs, e.run] : view.runs.map((r, i) => (i === at ? mergeRun(r, e.run) : r));
	return { ...view, runs };
}

/**
 * A run's newer copy over its older one. Updates can arrive out of order (the
 * answer to the request that started a run may land after its first text), so
 * a finished run is never put back to running, and running text never shrinks.
 */
export function mergeRun(old: ReviewRun, next: ReviewRun): ReviewRun {
	if (old.status !== 'running' && next.status === 'running') return old;
	if (next.status === 'running' && old.text.length > next.text.length)
		return { ...next, text: old.text };
	return next;
}

/** The runs about one hunk (or, with null, the whole pull request), questions and reviews only. */
export const threadOf = (runs: ReviewRun[], hunk: string | null) =>
	runs.filter((r) => r.kind !== 'guide' && r.hunk === hunk);
