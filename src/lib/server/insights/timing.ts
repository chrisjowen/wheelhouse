import type { TimeSegment, TimeSplit, WorkEta, WorkPhase } from '../../types';

/**
 * Where a task's time went, and a rough estimate of the work time it has left.
 * Pure functions over the fleet ledger's status history and the step timings
 * of the task's no-mistakes runs (see service.ts for the reads).
 */

export interface StatusLine {
	ts: number;
	state: string | null;
	key: string | null;
	text: string;
}

export interface RunTiming {
	id: string;
	/** Steps in the order they started; seconds since the epoch. */
	steps: { step: string; startedAt: number; endedAt: number }[];
	/** The repository declares no CI, so the CI step only waits for the merge. */
	noCi: boolean;
}

export interface TimingInput {
	id: string;
	kind: string | null;
	project: string | null;
	dispatchedAt: number;
	statuses: StatusLine[];
	mergedAt: number | null;
	cleanedUpAt: number | null;
	/** Firstmate still runs this task. */
	live: boolean;
	runs: RunTiming[];
}

const STEP_LABEL: Record<string, string> = {
	rebase: 'Catching up with main',
	review: 'Code review',
	test: 'Tests',
	document: 'Docs',
	lint: 'Lint',
	push: 'Push',
	pr: 'Pull request'
};

const isRunKey = (s: StatusLine) => (s.key ?? '').startsWith('nm-');
const RUN_STARTED = /no-mistakes|fix round/i;
const GREEN = /checks green|CI green/i;
const PROGRESS = new Set(['working', 'paused', 'done']);

/**
 * Seconds spent waiting on questions: from needs-decision to the resolved line
 * on the same key, or until the worker reports progress on something else
 * (it moved on while the question was open). Open waits run to `until`.
 */
export function waited(statuses: StatusLine[], pick: (s: StatusLine) => boolean, until: number) {
	const open = new Map<string, number>();
	const spans: [number, number][] = [];
	for (const s of statuses) {
		if (s.state && PROGRESS.has(s.state) && open.size) {
			for (const at of open.values()) spans.push([at, s.ts]);
			open.clear();
		}
		if (!s.key || !pick(s)) continue;
		if (s.state === 'needs-decision' && !open.has(s.key)) open.set(s.key, s.ts);
		else if (s.state === 'resolved' && open.has(s.key)) {
			spans.push([open.get(s.key)!, s.ts]);
			open.delete(s.key);
		}
	}
	for (const at of open.values()) spans.push([at, until]);
	const merged = union(spans);
	return { total: within(merged, -Infinity, until), open: open.size > 0, spans: merged };
}

/** Overlapping waits merged, so time when several questions were open counts once. */
export function union(spans: [number, number][]) {
	const out: [number, number][] = [];
	for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
		const prev = out.at(-1);
		if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
		else out.push([s, e]);
	}
	return out;
}

/** Seconds of the waits that fall between `from` and `to`. */
export const within = (spans: [number, number][], from: number, to: number) =>
	spans.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, to) - Math.max(s, from)), 0);

const zero = (): Record<TimeSegment, number> => ({
	build: 0,
	review: 0,
	deciding: 0,
	ci: 0,
	captain: 0
});

/** Split one task's time into segments, and say where it is now. */
export function splitTime(t: TimingInput, now: number): TimeSplit {
	const st = [...t.statuses].sort((a, b) => a.ts - b.ts);
	const runs = t.runs
		.filter((r) => r.steps.length && r.steps[0].startedAt >= t.dispatchedAt - 60)
		.sort((a, b) => a.steps[0].startedAt - b.steps[0].startedAt);
	const end = t.mergedAt ?? (t.live ? now : (t.cleanedUpAt ?? now));
	const seconds = zero();
	const captain = waited(st, (s) => !isRunKey(s), end);
	seconds.captain = within(captain.spans, t.dispatchedAt, end);
	let phase: WorkPhase = 'building';
	let phaseStartedAt = t.dispatchedAt;
	let readyAfter: number | null = null;
	const last = runs.at(-1) ?? null;

	if (t.kind === 'scout') {
		seconds.build = Math.max(0, end - t.dispatchedAt - seconds.captain);
		phase = !t.live ? 'done' : captain.open ? 'captain' : 'building';
	} else {
		const fromStatus = st.find((s) => s.state === 'paused' && RUN_STARTED.test(s.text))?.ts;
		const fromRun = runs[0]?.steps[0].startedAt;
		const validating =
			[fromStatus, fromRun].filter((x): x is number => x !== undefined).sort((a, b) => a - b)[0] ??
			null;
		const greens = st
			.filter(
				(s) => s.state === 'done' && GREEN.test(s.text) && (!validating || s.ts >= validating)
			)
			.map((s) => s.ts);
		const ok = greens.at(-1) ?? null;
		const built = validating ?? ok ?? end;
		seconds.build = Math.max(
			0,
			built - t.dispatchedAt - within(captain.spans, t.dispatchedAt, built)
		);
		if (validating !== null) {
			// The next run step after a moment, other than CI or intent: work resuming.
			const resumed = (after: number) =>
				runs
					.flatMap((r) => r.steps)
					.filter((s) => s.startedAt > after && s.step !== 'ci' && s.step !== 'intent')
					.reduce<number | null>(
						(a, s) => (a === null ? s.startedAt : Math.min(a, s.startedAt)),
						null
					);
			// Back in review after the latest green (a rebase or a later fix): not ready yet.
			const back = ok !== null && t.live && !t.mergedAt ? resumed(ok) : null;
			const ready = ok !== null && back === null;
			const reviewEnd = ready ? ok : end;
			// From each green to the next run picking the work up again, it waited on the captain.
			const gaps = greens.flatMap((g): [number, number][] => {
				const r = resumed(g);
				return r !== null && r <= reviewEnd ? [[g, r]] : [];
			});
			const waiting = union([...captain.spans, ...gaps]);
			const deciding = waited(
				st.filter((s) => s.ts >= validating),
				isRunKey,
				reviewEnd
			);
			const held = union([...waiting, ...deciding.spans]);
			seconds.deciding =
				within(held, validating, reviewEnd) - within(waiting, validating, reviewEnd);
			// CI: from each run's ci step starting to the green that followed it, or to now while it runs.
			for (const r of runs) {
				const ci = r.steps.find((s) => s.step === 'ci');
				if (!ci || r.noCi) continue;
				const until = greens.find((x) => x >= ci.startedAt) ?? reviewEnd;
				const next = resumed(ci.startedAt);
				if (next !== null && next < until) continue;
				seconds.ci += Math.max(0, until - ci.startedAt - within(held, ci.startedAt, until));
			}
			seconds.review = Math.max(
				0,
				reviewEnd - validating - seconds.ci - within(held, validating, reviewEnd)
			);
			seconds.captain = within(waiting, t.dispatchedAt, reviewEnd) + Math.max(0, end - reviewEnd);
			if (ready) {
				phase = 'captain';
				phaseStartedAt = ok;
				readyAfter = ok - t.dispatchedAt - within(waiting, t.dispatchedAt, ok);
			} else {
				phase = 'review';
				phaseStartedAt = back ?? validating;
				const lastStep = last?.steps.at(-1);
				if (lastStep?.step === 'ci' && (ok === null || lastStep.startedAt > ok)) {
					phase = 'ci';
					phaseStartedAt = lastStep.startedAt;
				}
			}
		}
		if (t.mergedAt) phase = 'landed';
		else if (!t.live) phase = 'done';
	}

	const total = Object.values(seconds).reduce((a, b) => a + b, 0);
	const reviewSteps = (last?.steps ?? [])
		.filter((s) => STEP_LABEL[s.step] && s.endedAt > s.startedAt)
		.map((s) => ({ step: s.step, label: STEP_LABEL[s.step], seconds: s.endedAt - s.startedAt }));
	return {
		taskId: t.id,
		seconds,
		total,
		phase,
		phaseStartedAt,
		ongoing: t.live && phase !== 'landed' && phase !== 'done',
		readyAfter: readyAfter !== null ? Math.max(0, readyAfter) : null,
		reviewSteps
	};
}

// ------------------------------------------------------------------ ETA

export const ETA_PHASES = ['building', 'review', 'ci'] as const;
type EtaPhase = (typeof ETA_PHASES)[number];

export const percentile = (xs: number[], p: number) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const i = (s.length - 1) * p;
	const lo = Math.floor(i);
	return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

const phaseSeconds = (s: TimeSplit, p: EtaPhase) =>
	p === 'building'
		? s.seconds.build
		: p === 'review'
			? s.seconds.review + s.seconds.deciding
			: s.seconds.ci;

export interface EtaSubject {
	split: TimeSplit;
	kind: string | null;
	project: string | null;
}

/**
 * Work-time estimate to "ready for your review".
 *
 * Reference class: other work of the same kind that reached the captain's
 * review, from the same project when it has at least 3, else across projects.
 * For the phase under way it takes what similar work still had left once it
 * had been in that phase this long (so a slow phase never counts below zero),
 * then adds each later phase's duration from the same tasks. The estimate is
 * the median, the range the 25th to 75th percentile. Confidence follows both
 * how much history there is and how much it agreed.
 */
export function estimate(subject: EtaSubject, history: EtaSubject[], now: number): WorkEta {
	const { split } = subject;
	const elapsed = split.total;
	const base: WorkEta = {
		openEnded: false,
		minutes: null,
		low: null,
		high: null,
		basis: 0,
		scope: null,
		confidence: 'none',
		overdue: false,
		elapsed,
		ahead: []
	};
	if (subject.kind !== 'ship') return { ...base, openEnded: true };
	const at = ETA_PHASES.indexOf(split.phase as EtaPhase);
	if (at < 0) return base;
	const done = history.filter(
		(h) => h.split.taskId !== split.taskId && h.kind === subject.kind && h.split.readyAfter !== null
	);
	const same = done.filter((h) => h.project && h.project === subject.project);
	const set = same.length >= 3 ? same : done;
	const scope = same.length >= 3 ? 'project' : 'kind';
	const inPhase = Math.max(0, now - split.phaseStartedAt);
	const ahead = ETA_PHASES.slice(at).map((p, i) => {
		const xs = set.map((h) => phaseSeconds(h.split, p)).filter((x) => x > 0);
		return {
			phase: p,
			usual: xs.length ? percentile(xs, 0.5) : null,
			current: i === 0,
			spent: i === 0 ? inPhase : 0
		};
	});
	if (!set.length) return { ...base, ahead };

	const samples = set.map((h) => {
		const cur = phaseSeconds(h.split, ETA_PHASES[at]);
		const rest = ETA_PHASES.slice(at + 1).reduce((a, p) => a + phaseSeconds(h.split, p), 0);
		return { cur, left: Math.max(0, cur - inPhase) + rest };
	});
	const still = samples.filter((s) => s.cur > inPhase);
	const pool = (still.length >= 2 ? still : samples).map((s) => s.left);
	const toMin = (x: number) => Math.max(1, Math.round(x / 60));
	const mid = percentile(pool, 0.5);
	const spread = (percentile(pool, 0.75) - percentile(pool, 0.25)) / Math.max(60, mid);
	const n = set.length;
	return {
		...base,
		minutes: toMin(mid),
		low: toMin(percentile(pool, 0.25)),
		high: toMin(percentile(pool, 0.75)),
		basis: n,
		scope,
		confidence: n < 3 ? 'early' : n >= 8 && spread <= 0.6 ? 'guide' : 'rough',
		overdue: still.length === 0,
		ahead
	};
}
