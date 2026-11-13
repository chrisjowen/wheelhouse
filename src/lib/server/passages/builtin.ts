import { parsePassage, type PassageFile } from './schema';
import type { StageFacts } from '../firstmate/stages';
import type { Track } from '../../types';

/**
 * Wheelhouse's built-in passages, written in the passage file format. Every
 * project uses these when it declares nothing, and a project's
 * `.wheelhouse.yaml` (or the captain's config) extends one of them.
 *
 * - ship: Queued → Building → Checks → Pull request → Your review → Landed;
 *   direct-PR skips the local Checks step, local-only skips the Pull request
 *   step, and yolo-on skips Your review (Firstmate merges it itself). Changes
 *   requested after the PR was ready start a new run (model.ts), which goes
 *   through Building, Checks and Pull request again.
 * - scout: Queued → Scout → Report → Your call → Done, lined up with the ship
 *   columns on the shared chart.
 * - A project that publishes an npm package also gets Released → On npm after
 *   Landed on the ship passage (`baseFor` below).
 *
 * The current step is the furthest step whose `reached_when` holds (a high
 * water mark), so a cleaned-up task whose only remaining fact is its merge
 * still lands on Landed. In no-mistakes mode the pipeline opens the pull
 * request before CI runs, so CI checks belong to the Pull request step and
 * the Checks step is local validation.
 */

export const SHIP_YAML = `
version: 1
id: ship
stages:
  - id: queued
    label: Queued
    reached_when: backlog.queued
    evidence: [queue]
  - id: building
    label: Building
    short: Build
    reached_when: { any: [task.live, { not: backlog.queued }] }
    evidence: [progress, files]
  - id: checks
    label: Checks
    skip_when: { mode: direct-PR }
    skip_note: Direct-PR work runs no local validation.
    reached_when: { all: [task.live, nm.run] }
    evidence: [validation]
  - id: pr
    label: Pull request
    short: PR
    skip_when: { mode: local-only }
    skip_note: Local-only work lands without a pull request.
    reached_when: { all: [task.live, pr.recorded] }
    evidence: [pr]
    note:
      when: { mode: no-mistakes }
      text: The pipeline opens the pull request before CI runs, so CI checks show here.
  - id: review
    label: Your review
    short: Review
    skip_when: { yolo: "on" }
    skip_note: Yolo is on, so Firstmate merges this itself.
    reached_when:
      all:
        - task.live
        - { not: { yolo: "on" } }
        - any:
            - { all: [pr.recorded, pr.ready] }
            - { all: [{ mode: local-only }, crew.done, { not: pr.recorded }] }
    evidence: [decision, screenshots, preview]
  - id: landed
    label: Landed
    reached_when: { any: [merged, backlog.done] }
    evidence: [landed]
`;

export const SCOUT_YAML = `
version: 1
id: scout
stages:
  - id: queued
    label: Queued
    reached_when: backlog.queued
    evidence: [queue]
  - id: investigating
    label: Scout
    column: building
    reached_when: { any: [task.live, { not: backlog.queued }] }
    evidence: [progress, files]
  - id: report
    label: Report
    column: pr
    reached_when: { all: [task.live, crew.done, report.present] }
    evidence: [report]
  - id: decision
    label: Your call
    column: review
    reached_when: hold.captain
    evidence: [decision, screenshots, preview]
  - id: done
    label: Done
    column: landed
    reached_when: backlog.done
    evidence: [landed]
`;

function load(text: string): PassageFile {
	const r = parsePassage(text, { kind: 'base' });
	if (!r.ok) throw new Error(`built-in passage is invalid: ${r.errors.join('; ')}`);
	return r.value;
}

export const BUILTIN: Record<Track, PassageFile> = {
	ship: load(SHIP_YAML),
	scout: load(SCOUT_YAML)
};

/**
 * The ship passage's release steps, for a project whose default branch has a
 * package.json that npm publishes (a name, and not `"private": true`):
 * Released when a GitHub release (tag v*) contains the merge commit, then On
 * npm when that release's version is published on npm. Both use the same
 * typed checks a passage file can declare, so they are cached, given up on
 * and recorded across restarts like any other step reached through checks.
 * They are Wheelhouse's own fixed queries, so they need no enabling.
 */
export const RELEASE_CHECKS = ['release', 'npm'] as const;
export const RELEASE_STEPS = ['released', 'on-npm'] as const;
const RELEASE_GIVE_UP = '14d';

export function shipWithNpm(pkg: string): PassageFile {
	const ship = BUILTIN.ship;
	return {
		...ship,
		checks: {
			...ship.checks,
			release: {
				type: 'github.release',
				label: 'GitHub release',
				contains: 'merge.commit',
				tag_pattern: 'v*'
			},
			npm: {
				type: 'npm.published',
				label: 'npm package',
				package: pkg,
				version_from: 'release'
			}
		},
		stages: [
			...ship.stages,
			{
				id: 'released',
				label: 'Released',
				reached_when: 'release.included',
				evidence: ['check:release'],
				primary_link: 'release.url',
				give_up_after: RELEASE_GIVE_UP
			},
			{
				id: 'on-npm',
				label: 'On npm',
				reached_when: 'npm.published',
				evidence: ['check:npm'],
				primary_link: 'npm.url',
				give_up_after: RELEASE_GIVE_UP
			}
		]
	};
}

/**
 * Whether a passage file models its own release, so the built-in release
 * steps are left out rather than doubled or clashing: it declares a GitHub
 * release or npm check, reuses one of their check ids, or adds a step with one
 * of their step ids (restyling them, without conditions or a place, is fine).
 */
export function ownsRelease(file: PassageFile): boolean {
	return (
		Object.entries(file.checks).some(
			([id, c]) =>
				c.type === 'github.release' ||
				c.type === 'npm.published' ||
				(RELEASE_CHECKS as readonly string[]).includes(id)
		) ||
		file.stages.some(
			(s) =>
				(RELEASE_STEPS as readonly string[]).includes(s.id) &&
				(s.reached_when !== undefined ||
					s.skip_when !== undefined ||
					s.failed_when !== undefined ||
					s.after !== undefined ||
					s.column !== undefined)
		)
	);
}

/**
 * The base passage a project's files layer over: the built-in, plus the
 * release steps on the ship passage when the project publishes an npm package
 * and none of its files models its own release.
 */
export function baseFor(
	track: Track,
	npmPackage: string | null,
	files: readonly PassageFile[]
): PassageFile {
	if (track !== 'ship' || !npmPackage || files.some(ownsRelease)) return BUILTIN[track];
	return shipWithNpm(npmPackage);
}

const isOn = (s: string | null) => (s ?? '').toLowerCase().replace(/[_\s]/g, '-') === 'on';

/** What placed a task on a built-in step, in plain words (the "Placed from" line). */
export function builtinBasis(track: Track, step: string, f: StageFacts): string {
	const crew = f.crewState
		? `crew state ${f.crewState}${f.crewSource ? ` (${f.crewSource})` : ''}`
		: null;
	if (track === 'scout') {
		switch (step) {
			case 'done':
				return 'Backlog marks it done';
			case 'decision':
				return 'Held for your decision';
			case 'queued':
				return 'Backlog: queued';
			case 'report':
				return 'Worker finished and wrote its report';
			default:
				return f.live
					? `Worker crew state ${f.crewState ?? 'unknown'}${f.reportPresent ? '; report in progress' : ''}`
					: 'Backlog: in flight, no worker record';
		}
	}
	const ready = f.crewState === 'done' ? crew : `checks green, awaiting merge; ${crew}`;
	switch (step) {
		case 'landed':
			return f.merged ? 'Merge recorded' : 'Backlog marks it done';
		case 'queued':
			return 'Backlog: queued';
		case 'checks':
			return `Validation run; ${crew}`;
		case 'pr':
			return f.prReady && isOn(f.yolo)
				? `Pull request recorded; ${ready}; Firstmate merges it`
				: `Pull request recorded; ${crew}`;
		case 'review':
			return f.prUrl && f.prReady
				? `Pull request recorded; ${ready}`
				: `Local-only work finished; ${crew}`;
		default:
			if (!f.live) return 'Backlog: in flight, no worker record';
			return crew ? `Worker ${crew}` : 'Worker record present';
	}
}
