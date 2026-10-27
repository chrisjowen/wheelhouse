import { BUILTIN } from '../passages/builtin';
import { evaluate } from '../passages/engine';
import { fromBase, type ResolvedPassage } from '../passages/resolve';
import type { Passage, Track } from '../../types';

/**
 * Passage stage derivation, behind one interface. Passages are data: the
 * built-in ship and scout passages are written in the passage file format
 * (passages/builtin.ts), and a project may extend them with a
 * `.wheelhouse.yaml` on its default branch, layered under the captain's
 * Wheelhouse config (passages/service.ts). The rules that turn facts and
 * check results into a passage live in passages/engine.ts.
 *
 * The built-in model is mode-aware:
 * - ship work: Queued → Building → Checks → Pull request → Your review → Landed;
 *   direct-PR skips the local Checks step, local-only skips the Pull request
 *   step, and yolo-on skips Your review (Firstmate merges it itself);
 * - scout work: Queued → Scout → Report → Your call → Done.
 * Firstmate records no deployments, so steps such as Deployed or Released
 * exist only where a passage file declares them, with the checks that observe
 * them.
 *
 * In no-mistakes mode the pipeline opens the pull request before CI runs, so
 * CI checks belong to the Pull request step; the Checks step is local
 * validation.
 */

/** The facts a stage model may use, all read from Firstmate records. */
export interface StageFacts {
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
	/**
	 * Changes were requested on the pull request after it was reported ready,
	 * and the worker has not reported it ready again (changes.ts).
	 */
	changesRequested?: boolean;
	/** A merge or landing was recorded (backlog or fleet ledger). */
	merged: boolean;
	reportPresent: boolean;
	captainHold: boolean;
	/** The task id (declared checks are per task). */
	taskId?: string;
	/** When the task landed (epoch ms): the ledger's merge time, else its backlog completion day. */
	landedAt?: number | null;
	/** A preview URL the worker reported (`preview <url>` status line). */
	preview?: { url: string; at: string } | null;
}

export interface StageModel {
	passage(facts: StageFacts): Passage;
}

/** Built-in step keys. Step keys are open strings; these are the ones the built-ins emit. */
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
 * order). Each step lists its blocks as data (the built-in passages and any
 * passage file), so a project can attach different evidence, including its
 * declared checks as `check:<id>`, without editing page markup.
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

const BUILTIN_RESOLVED: Record<Track, ResolvedPassage> = {
	ship: fromBase(BUILTIN.ship),
	scout: fromBase(BUILTIN.scout)
};

/**
 * The built-in passages (passages/builtin.ts) with no declared checks: what
 * every project gets when neither it nor the captain declares a passage.
 */
export const defaultStageModel: StageModel = {
	passage: (f) => evaluate(BUILTIN_RESOLVED[f.track], f)
};

/**
 * Choose a project's stage model. This default knows only the built-ins; the
 * runtime passes the passage service's `stagesFor` (passages/service.ts),
 * which layers a project's `.wheelhouse.yaml` and the captain's config on top.
 */
export function stagesFor(projectId: string): StageModel {
	void projectId;
	return defaultStageModel;
}
