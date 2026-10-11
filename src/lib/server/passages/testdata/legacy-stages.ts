/**
 * FROZEN TEST ORACLE: the hand-written stage model as it was before passages
 * became data (commit 77b0ad2, src/lib/server/firstmate/stages.ts). The
 * no-file equivalence test compares the declarative built-in passages with it
 * over every combination of facts. Do not edit it to make a test pass.
 */

type Track = 'ship' | 'scout';
type StageKey = string;

export interface LegacyStep {
	key: StageKey;
	label: string;
	short: string;
	state: 'done' | 'current' | 'upcoming' | 'skipped';
	note: string | null;
	column: string;
	evidence: string[];
}

export interface LegacyPassage {
	track: Track;
	steps: LegacyStep[];
	current: number;
	basis: string;
}

/**
 * Passage stage derivation, behind one interface so a declarative,
 * config-driven definition of stages and their checks can replace it later
 * without touching the rest of Wheelhouse.
 *
 * The default model is mode-aware:
 * - ship work: Queued → Building → Checks → Pull request → Your review → Landed;
 *   direct-PR skips the local Checks step, local-only skips the Pull request
 *   step, and yolo-on skips Your review (Firstmate merges it itself);
 * - scout work: Queued → Scout → Report → Your call → Done.
 * There is no Deployed step: Firstmate records no deployments.
 *
 * In no-mistakes mode the pipeline opens the pull request before CI runs, so
 * CI checks belong to the Pull request step; the Checks step is local
 * validation.
 */

/** The facts a stage model may use, all read from Firstmate records. */
export interface LegacyFacts {
	track: Track;
	/** Backlog section: in_flight, queued or done (null when there is no backlog row). */
	backlogState: string | null;
	/** True when a live worker record exists for the task. */
	live: boolean;
	/** Crew state from Firstmate's current-state read. */
	crewState: string | null;
	/** Where that crew state came from (run-step, pane, status-log, ...). */
	crewSource: string | null;
	mode: string | null;
	yolo: string | null;
	prUrl: string | null;
	/**
	 * The pull request is open (not a draft), CI-ready and waiting only on a
	 * merge decision (model.ts decides this from crew state, the status history
	 * and the no-mistakes CI monitor).
	 */
	prReady: boolean;
	/** A merge or landing was recorded (backlog or fleet ledger). */
	merged: boolean;
	reportPresent: boolean;
	captainHold: boolean;
}

interface StageModel {
	passage(facts: LegacyFacts): LegacyPassage;
}

/** Built-in step keys. Step keys are open strings; these are the ones this model emits. */
export const KNOWN_STEPS = {
	queued: 'queued',
	building: 'building',
	checks: 'checks',
	pr: 'pr',
	review: 'review',
	landed: 'landed',
	investigating: 'investigating',
	report: 'report',
	decision: 'decision',
	done: 'done'
} as const;

/**
 * Evidence block ids a step can show (rendered by the task page in this
 * order). Keeping this mapping here, as data, lets a later stage definition
 * attach different evidence without editing page markup.
 */
export const EVIDENCE = {
	queue: 'queue',
	progress: 'progress',
	files: 'files',
	validation: 'validation',
	pr: 'pr',
	report: 'report',
	screenshots: 'screenshots',
	preview: 'preview',
	decision: 'decision',
	landed: 'landed'
} as const;

interface StepDef {
	key: StageKey;
	label: string;
	short: string;
	/** Step key this one lines up with on the shared chart (defaults to its own key). */
	align?: StageKey;
	evidence: string[];
}

const K = KNOWN_STEPS;
const E = EVIDENCE;

const SHIP_STEPS: readonly StepDef[] = [
	{ key: K.queued, label: 'Queued', short: 'Queued', evidence: [E.queue] },
	{ key: K.building, label: 'Building', short: 'Build', evidence: [E.progress, E.files] },
	{ key: K.checks, label: 'Checks', short: 'Checks', evidence: [E.validation] },
	{ key: K.pr, label: 'Pull request', short: 'PR', evidence: [E.pr] },
	{
		key: K.review,
		label: 'Your review',
		short: 'Review',
		evidence: [E.decision, E.screenshots, E.preview]
	},
	{ key: K.landed, label: 'Landed', short: 'Landed', evidence: [E.landed] }
];

const SCOUT_STEPS: readonly StepDef[] = [
	{ key: K.queued, label: 'Queued', short: 'Queued', evidence: [E.queue] },
	{
		key: K.investigating,
		label: 'Scout',
		short: 'Scout',
		align: K.building,
		evidence: [E.progress, E.files]
	},
	{ key: K.report, label: 'Report', short: 'Report', align: K.pr, evidence: [E.report] },
	{
		key: K.decision,
		label: 'Your call',
		short: 'Your call',
		align: K.review,
		evidence: [E.decision, E.screenshots, E.preview]
	},
	{ key: K.done, label: 'Done', short: 'Done', align: K.landed, evidence: [E.landed] }
];

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[_\s]/g, '-');

function skippedSteps(f: LegacyFacts): Partial<Record<StageKey, string>> {
	if (f.track !== 'ship') return {};
	const mode = norm(f.mode);
	const skipped: Partial<Record<StageKey, string>> = {};
	if (mode === 'direct-pr') skipped.checks = 'Direct-PR work runs no local validation.';
	if (mode === 'local-only') skipped.pr = 'Local-only work lands without a pull request.';
	if (norm(f.yolo) === 'on') skipped.review = 'Yolo is on, so Firstmate merges this itself.';
	return skipped;
}

function currentShip(f: LegacyFacts): { key: StageKey; basis: string } {
	const crew = f.crewState
		? `crew state ${f.crewState}${f.crewSource ? ` (${f.crewSource})` : ''}`
		: null;
	if (f.merged || f.backlogState === 'done') {
		return { key: 'landed', basis: f.merged ? 'Merge recorded' : 'Backlog marks it done' };
	}
	if (!f.live) {
		if (f.backlogState === 'queued') return { key: 'queued', basis: 'Backlog: queued' };
		return { key: 'building', basis: 'Backlog: in flight, no worker record' };
	}
	const yoloOn = norm(f.yolo) === 'on';
	if (f.prUrl && f.prReady) {
		const ready = f.crewState === 'done' ? crew : `checks green, awaiting merge; ${crew}`;
		return yoloOn
			? { key: 'pr', basis: `Pull request recorded; ${ready}; Firstmate merges it` }
			: { key: 'review', basis: `Pull request recorded; ${ready}` };
	}
	if (f.prUrl) return { key: 'pr', basis: `Pull request recorded; ${crew}` };
	if (norm(f.mode) === 'local-only' && f.crewState === 'done' && !yoloOn) {
		return { key: 'review', basis: `Local-only work finished; ${crew}` };
	}
	if (f.crewSource === 'run-step') return { key: 'checks', basis: `Validation run; ${crew}` };
	return { key: 'building', basis: crew ? `Worker ${crew}` : 'Worker record present' };
}

function currentScout(f: LegacyFacts): { key: StageKey; basis: string } {
	if (f.backlogState === 'done') return { key: 'done', basis: 'Backlog marks it done' };
	if (!f.live) {
		if (f.captainHold) return { key: 'decision', basis: 'Held for your decision' };
		if (f.backlogState === 'queued') return { key: 'queued', basis: 'Backlog: queued' };
		return { key: 'investigating', basis: 'Backlog: in flight, no worker record' };
	}
	if (f.captainHold) return { key: 'decision', basis: 'Held for your decision' };
	if (f.crewState === 'done' && f.reportPresent) {
		return { key: 'report', basis: 'Worker finished and wrote its report' };
	}
	return {
		key: 'investigating',
		basis: `Worker crew state ${f.crewState ?? 'unknown'}${f.reportPresent ? '; report in progress' : ''}`
	};
}

export const legacyStageModel: StageModel = {
	passage(f) {
		const defs = f.track === 'scout' ? SCOUT_STEPS : SHIP_STEPS;
		const { key, basis } = f.track === 'scout' ? currentScout(f) : currentShip(f);
		const index = Math.max(
			0,
			defs.findIndex((d) => d.key === key)
		);
		const skipped = skippedSteps(f);
		const steps: LegacyStep[] = defs.map((d, i) => {
			const base = {
				key: d.key,
				label: d.label,
				short: d.short,
				column: d.align ?? d.key,
				evidence: [...d.evidence]
			};
			const skip = skipped[d.key];
			if (skip && i !== index) return { ...base, state: 'skipped', note: skip };
			return {
				...base,
				state: i < index ? 'done' : i === index ? 'current' : 'upcoming',
				note:
					d.key === 'pr' && norm(f.mode) === 'no-mistakes'
						? 'The pipeline opens the pull request before CI runs, so CI checks show here.'
						: null
			};
		});
		return { track: f.track, steps, current: index, basis };
	}
};
