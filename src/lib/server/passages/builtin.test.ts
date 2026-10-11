import { describe, expect, it } from 'vitest';
import { BUILTIN, SCOUT_YAML, SHIP_YAML } from './builtin';
import { parsePassage } from './schema';
import { checkReferences, fromBase } from './resolve';
import { defaultStageModel, type StageFacts } from '../firstmate/stages';
import { legacyStageModel } from './testdata/legacy-stages';

/** Every combination of the facts the stage rules read. */
function* allFacts(): Generator<StageFacts> {
	for (const track of ['ship', 'scout'] as const)
		for (const backlogState of [null, 'queued', 'in_flight', 'done'])
			for (const live of [false, true])
				for (const crewState of [null, 'working', 'done', 'paused', 'blocked'])
					for (const crewSource of [null, 'pane', 'run-step'])
						for (const mode of [null, 'no-mistakes', 'direct-PR', 'local_only'])
							for (const yolo of [null, 'off', 'on'])
								for (const prUrl of [null, 'https://github.com/o/r/pull/1'])
									for (const prReady of [false, true])
										for (const merged of [false, true])
											for (const reportPresent of [false, true])
												for (const captainHold of [false, true])
													yield {
														track,
														backlogState,
														live,
														crewState,
														crewSource,
														mode,
														yolo,
														prUrl,
														prReady,
														merged,
														reportPresent,
														captainHold
													};
}

describe('built-in passages', () => {
	it('are valid passage files whose references all resolve', () => {
		for (const text of [SHIP_YAML, SCOUT_YAML]) {
			const r = parsePassage(text, { kind: 'base' });
			expect(r.ok ? [] : r.errors).toEqual([]);
		}
		expect(checkReferences(fromBase(BUILTIN.ship))).toEqual([]);
		expect(checkReferences(fromBase(BUILTIN.scout))).toEqual([]);
	});

	it('place every task exactly as the hand-written model did, for every combination of facts', () => {
		let n = 0;
		const mismatches: string[] = [];
		for (const f of allFacts()) {
			n++;
			const now = defaultStageModel.passage(f);
			const then = legacyStageModel.passage(f);
			const got = {
				track: now.track,
				current: now.current,
				basis: now.basis,
				steps: now.steps.map(({ key, label, short, state, note, column, evidence }) => ({
					key,
					label,
					short,
					state,
					note,
					column,
					evidence
				}))
			};
			const want = {
				track: then.track,
				current: then.current,
				basis: then.basis,
				steps: then.steps.map(({ key, label, short, state, note, column, evidence }) => ({
					key,
					label,
					short,
					state,
					note,
					column,
					evidence
				}))
			};
			if (JSON.stringify(got) !== JSON.stringify(want) && mismatches.length < 5) {
				mismatches.push(
					`${JSON.stringify(f)}\n got ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`
				);
			}
		}
		expect(n).toBeGreaterThan(50_000);
		expect(mismatches).toEqual([]);
	});

	it('add nothing a project did not declare', () => {
		const p = defaultStageModel.passage({
			track: 'ship',
			backlogState: 'done',
			live: false,
			crewState: null,
			crewSource: null,
			mode: null,
			yolo: null,
			prUrl: null,
			prReady: false,
			merged: true,
			reportPresent: false,
			captainHold: false
		});
		expect(p).toMatchObject({ custom: false, live: null, link: null, checks: [] });
		expect(p.steps.every((s) => !s.failed)).toBe(true);
	});
});
