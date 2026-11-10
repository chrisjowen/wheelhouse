import type { TalkEntry } from './buildlog';
import type { PassageStep, TaskRun, TimelineEntry, ValidationRun } from './types';

/**
 * The task page's timeline: everything that happened on a task, oldest first,
 * as one story grouped under the passage stage it happened in. It merges what
 * the page used to show in separate tabs: the ship's log (the fleet ledger's
 * history, or a second mate's task's status log), the conversation between
 * the worker and Firstmate, the previews and screenshots the worker reported,
 * each validation run and each later run with the changes that started it.
 * Pure, so it is unit-tested.
 */

export type Shot = { name: string; url: string; modifiedAt: string };

export type TimelineItem =
	| {
			kind: 'event';
			at: string;
			event: 'launched' | 'pr-ready' | 'merged' | 'cleaned-up';
			/** The pull request it names, when it names one, and its address. */
			pr: number | null;
			url: string | null;
			text: string;
	  }
	/** One of the worker's status lines (its questions are `talk` items instead). */
	| { kind: 'status'; at: string; state: string | null; text: string }
	| { kind: 'preview'; at: string | null; url: string }
	| { kind: 'talk'; at: string; entry: TalkEntry }
	| { kind: 'shots'; at: string; shots: Shot[] }
	/** A later run, started by changes asked after the pull request was ready. */
	| { kind: 'run'; at: string; run: TaskRun }
	| { kind: 'validation'; at: string; run: ValidationRun; latest: boolean };

export interface TimelineSection {
	step: PassageStep;
	/** When the stage was first reached, when the history shows it. */
	at: string | null;
	items: TimelineItem[];
}

export interface TaskTimeline {
	/** Every stage reached so far (and those skipped), in passage order. */
	sections: TimelineSection[];
	/** Stages not reached yet. */
	upcoming: PassageStep[];
}

export interface TimelineInput {
	steps: PassageStep[];
	/** The ledger's (or status log's) history, any order. */
	history: TimelineEntry[];
	/** The conversation, when it could be read; its questions then replace their status lines. */
	talk: TalkEntry[] | null;
	shots: Shot[];
	validations: ValidationRun[];
	runs: TaskRun[];
	/** The preview the worker reported last, and when, when there is one. */
	preview: { url: string; at: string | null } | null;
}

/** Screenshots saved within this long of each other show as one entry. */
const SHOT_GAP_MS = 15 * 60_000;
const PULL = /\/pull\/(\d+)/;
const PREVIEW = /^\s*preview:?\s+(https?:\/\/\S+)/i;
/** Status lines that are the worker's questions and their answers: the conversation shows them. */
const ASKED = new Set(['needs-decision', 'blocked', 'resolved']);

const PULL_URL = /https?:\/\/[^\s)]+\/pull\/\d+/;
const urlOf = (text: string) => PULL_URL.exec(text)?.[0] ?? null;
const prOf = (text: string) => {
	const n = PULL.exec(text)?.[1];
	return n ? Number(n) : null;
};

/** One kind of entry, for the timeline's filter. */
export type Strand = 'talk' | 'updates' | 'checks';

export function strandOf(i: TimelineItem): Strand {
	switch (i.kind) {
		case 'talk':
			return 'talk';
		case 'validation':
		case 'run':
			return 'checks';
		case 'event':
			return i.event === 'pr-ready' || i.event === 'merged' ? 'checks' : 'updates';
		default:
			return 'updates';
	}
}

/** The history and the rest as timeline entries, oldest first (undated ones last). */
export function timelineItems(i: TimelineInput): TimelineItem[] {
	const out: TimelineItem[] = [];
	for (const e of i.history) {
		if (e.kind === 'status') {
			const state = e.state?.toLowerCase() ?? null;
			if (i.talk && state && ASKED.has(state)) continue;
			const p = PREVIEW.exec(e.text);
			if (p) out.push({ kind: 'preview', at: e.at, url: p[1].replace(/[),.;]+$/, '') });
			else out.push({ kind: 'status', at: e.at, state: e.state, text: e.text });
		} else if (e.kind === 'dispatched') {
			out.push({
				kind: 'event',
				at: e.at,
				event: 'launched',
				pr: null,
				url: null,
				text: 'Firstmate started the worker'
			});
		} else if (e.kind === 'pr-ready') {
			const n = prOf(e.text);
			out.push({
				kind: 'event',
				at: e.at,
				event: 'pr-ready',
				pr: n,
				url: urlOf(e.text),
				text: `Pull request${n ? ` #${n}` : ''} ready`
			});
		} else if (e.kind === 'merged') {
			const n = prOf(e.text);
			out.push({
				kind: 'event',
				at: e.at,
				event: 'merged',
				pr: n,
				url: urlOf(e.text),
				text: n ? `Merged pull request #${n}` : e.text
			});
		} else {
			out.push({
				kind: 'event',
				at: e.at,
				event: 'cleaned-up',
				pr: null,
				url: null,
				text: 'Cleaned up'
			});
		}
	}
	for (const entry of i.talk ?? []) out.push({ kind: 'talk', at: entry.at, entry });

	const shots = [...i.shots].sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
	let group: Shot[] = [];
	const flush = () => {
		if (group.length) out.push({ kind: 'shots', at: group[0].modifiedAt, shots: group });
		group = [];
	};
	for (const s of shots) {
		const last = group.at(-1);
		if (last && Date.parse(s.modifiedAt) - Date.parse(last.modifiedAt) > SHOT_GAP_MS) flush();
		group.push(s);
	}
	flush();

	for (const r of i.runs) {
		if (r.n > 1 && r.startedAt) out.push({ kind: 'run', at: r.startedAt, run: r });
	}
	const runs = i.validations.filter((v) => v.startedAt);
	runs.forEach((run, n) =>
		out.push({ kind: 'validation', at: run.startedAt!, run, latest: n === runs.length - 1 })
	);
	if (i.preview && !out.some((x) => x.kind === 'preview' && x.url === i.preview!.url)) {
		out.push({ kind: 'preview', at: i.preview.at, url: i.preview.url });
	}

	// Oldest first; entries with no time go last, in the order they came.
	return out
		.map((x, n) => ({ x, n }))
		.sort((a, b) =>
			a.x.at && b.x.at
				? a.x.at.localeCompare(b.x.at) || a.n - b.n
				: a.x.at
					? -1
					: b.x.at
						? 1
						: a.n - b.n
		)
		.map((e) => e.x);
}

/**
 * When the history shows each stage (by the chart column it lines up with)
 * was first reached: Building when the worker started, Checks at the first
 * validation run, Pull request when one is first named, Your review when it
 * was reported ready, Landed at the merge.
 */
function reachedAt(column: string, items: TimelineItem[]): string | null {
	const first = (f: (i: TimelineItem) => boolean) => items.find((i) => i.at && f(i))?.at ?? null;
	switch (column) {
		case 'building':
			return (
				first((i) => i.kind === 'event' && i.event === 'launched') ??
				first((i) => i.kind === 'status' || i.kind === 'talk')
			);
		case 'checks':
			return first((i) => i.kind === 'validation');
		case 'pr':
			return first(
				(i) => (i.kind === 'event' && i.pr !== null) || (i.kind === 'status' && PULL.test(i.text))
			);
		case 'review':
			return (
				first((i) => i.kind === 'event' && i.event === 'pr-ready') ??
				first((i) => i.kind === 'status' && i.state === 'done' && PULL.test(i.text))
			);
		case 'landed':
			return first((i) => i.kind === 'event' && i.event === 'merged');
		default:
			return null;
	}
}

/**
 * The timeline grouped by stage: each entry goes under the latest stage
 * reached by its time (the first stage when it came before any), entries with
 * no time under the latest stage. A stage the history does not date starts
 * where the one before it did, so it holds only what it shows of its own.
 */
export function taskTimeline(i: TimelineInput): TaskTimeline {
	const items = timelineItems(i);
	const reached = i.steps.filter((s) => s.state !== 'upcoming');
	const sections: TimelineSection[] = reached.map((step) => ({
		step,
		at: step.state === 'skipped' ? null : reachedAt(step.column, items),
		items: []
	}));
	const open = sections.filter((s) => s.step.state !== 'skipped');
	// Stages are reached in order, so each starts no earlier than the one before.
	let floor: string | null = null;
	const starts = open.map((s) => {
		if (s.at && floor && s.at < floor) s.at = floor;
		floor = s.at ?? floor;
		return floor;
	});
	for (const item of items) {
		let k = 0;
		if (!item.at) k = open.length - 1;
		else
			for (let n = 0; n < open.length; n++) if (starts[n] !== null && starts[n]! <= item.at) k = n;
		open[k]?.items.push(item);
	}
	return { sections, upcoming: i.steps.filter((s) => s.state === 'upcoming') };
}
