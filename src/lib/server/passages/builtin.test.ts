import { describe, expect, it } from 'vitest';
import { baseFor, BUILTIN, ownsRelease, SCOUT_YAML, SHIP_YAML, shipWithNpm } from './builtin';
import { evaluate, type CheckState } from './engine';
import { parsePassage, validatePassage } from './schema';
import { checkReferences, fromBase, resolvePassage } from './resolve';
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

describe('built-in release steps for npm projects', () => {
	const ship = fromBase(shipWithNpm('@acme/tool'));
	const merged: StageFacts = {
		track: 'ship',
		backlogState: 'done',
		live: false,
		crewState: null,
		crewSource: null,
		mode: null,
		yolo: null,
		prUrl: 'https://github.com/acme/tool/pull/3',
		prReady: false,
		merged: true,
		reportPresent: false,
		captainHold: false
	};
	const seen = (outcomes: string[], summary: string, url: string | null = null): CheckState => ({
		state: 'observed',
		outcomes,
		summary,
		url,
		observedAt: '2026-11-13T12:00:00Z'
	});
	const run = (checks: Record<string, CheckState>) =>
		evaluate(
			ship,
			merged,
			(id) => checks[id],
			(id) => ship.checks.get(id)?.spec.label ?? id
		);
	const place = (p: ReturnType<typeof run>) => p.steps[p.current].key;

	it('are a valid base passage whose references all resolve, after Landed', () => {
		expect(
			validatePassage(JSON.parse(JSON.stringify(shipWithNpm('@acme/tool'))), { kind: 'base' })
		).toMatchObject({ ok: true });
		expect(checkReferences(ship)).toEqual([]);
		expect(ship.steps.map((s) => s.id).slice(-3)).toEqual(['landed', 'released', 'on-npm']);
		expect(ship.checks.get('npm')?.spec).toMatchObject({
			type: 'npm.published',
			package: '@acme/tool',
			version_from: 'release'
		});
		expect(ship.steps.slice(-2).map((s) => s.giveUpAfter?.text)).toEqual(['14d', '14d']);
	});

	it('reach On npm when a release contains the merge and its version is on npm', () => {
		const p = run({
			release: seen(
				['included'],
				'aaaaaaa shipped in v1.3.0.',
				'https://github.com/acme/tool/releases/tag/v1.3.0'
			),
			npm: seen(
				['published'],
				'@acme/tool@1.3.0 is on npm (latest is 1.4.0).',
				'https://www.npmjs.com/package/@acme/tool/v/1.3.0'
			)
		});
		expect(place(p)).toBe('on-npm');
		expect(p.basis).toBe('On npm: @acme/tool@1.3.0 is on npm (latest is 1.4.0)');
		expect(p.link).toEqual({
			label: 'Open npm package',
			url: 'https://www.npmjs.com/package/@acme/tool/v/1.3.0'
		});
		expect(p.custom).toBe(false);
	});

	it('stay at Landed while the published version predates the merge', () => {
		const p = run({
			release: seen(['not_yet'], 'aaaaaaa is not in a release yet (latest: v1.2.0).'),
			npm: {
				state: 'waiting',
				outcomes: [],
				summary: 'Waits for GitHub release to find a release.',
				url: null,
				observedAt: null
			}
		});
		expect(place(p)).toBe('landed');
		expect(p.steps.slice(-2).map((s) => s.state)).toEqual(['upcoming', 'upcoming']);
		expect(p.basis).toBe('Merge recorded');
	});

	it('stay at Released, saying why, while npm cannot be read', () => {
		const p = run({
			release: seen(['included'], 'aaaaaaa shipped in v1.3.0.'),
			npm: {
				state: 'unknown',
				outcomes: [],
				summary: 'The npm registry answered 503.',
				url: null,
				observedAt: '2026-11-13T12:00:00Z'
			}
		});
		expect(place(p)).toBe('released');
		expect(p.steps.at(-1)).toMatchObject({
			key: 'on-npm',
			state: 'upcoming',
			note: "Can't tell: The npm registry answered 503."
		});
	});

	it('are left out for projects with no npm package, for scout, and when a file models its own release', () => {
		expect(baseFor('ship', null, [])).toBe(BUILTIN.ship);
		expect(baseFor('scout', '@acme/tool', [])).toBe(BUILTIN.scout);
		expect(baseFor('ship', '@acme/tool', []).stages.at(-1)?.id).toBe('on-npm');
		const file = (text: string) => {
			const r = parsePassage(text, { kind: 'overlay' });
			if (!r.ok) throw new Error(r.errors.join('; '));
			return r.value;
		};
		const own = file(
			'version: 1\nchecks:\n  rel: { type: github.release, contains: merge.commit }\nstages:\n  - { id: shipped, label: Shipped, after: landed, reached_when: rel.included }\n'
		);
		const clash = file(
			'version: 1\nstages:\n  - { id: released, label: Out, after: landed, reached_when: merged }\n'
		);
		const restyle = file('version: 1\nstages:\n  - { id: released, label: Tagged }\n');
		expect([own, clash, restyle].map(ownsRelease)).toEqual([true, true, false]);
		expect(baseFor('ship', '@acme/tool', [own])).toBe(BUILTIN.ship);
		// Restyling a release step keeps it, renamed.
		const r = resolvePassage(baseFor('ship', '@acme/tool', [restyle]), [
			{ origin: 'project', file: restyle }
		]);
		expect(r.errors.size).toBe(0);
		expect(r.passage.steps.find((s) => s.id === 'released')?.label).toBe('Tagged');
	});
});
