import { describe, expect, it } from 'vitest';
import { defaultStageModel, stagesFor, type StageFacts } from './stages';

const facts = (o: Partial<StageFacts> = {}): StageFacts => ({
	track: 'ship',
	backlogState: 'in_flight',
	live: true,
	crewState: 'working',
	crewSource: 'pane',
	mode: 'no-mistakes',
	yolo: 'off',
	prUrl: null,
	prReady: false,
	merged: false,
	reportPresent: false,
	captainHold: false,
	...o
});
const current = (f: StageFacts) => {
	const p = defaultStageModel.passage(f);
	return p.steps[p.current].key;
};
const states = (f: StageFacts) =>
	Object.fromEntries(defaultStageModel.passage(f).steps.map((s) => [s.key, s.state]));

describe('ship passage', () => {
	it('has no Deployed step', () => {
		expect(defaultStageModel.passage(facts()).steps.map((s) => s.key)).toEqual([
			'queued',
			'building',
			'checks',
			'pr',
			'review',
			'landed'
		]);
	});

	it('walks Queued → Building → Checks → PR → Your review → Landed', () => {
		expect(current(facts({ live: false, backlogState: 'queued' }))).toBe('queued');
		expect(current(facts())).toBe('building');
		expect(current(facts({ crewSource: 'run-step' }))).toBe('checks');
		expect(current(facts({ prUrl: 'https://x/pull/1', crewSource: 'run-step' }))).toBe('pr');
		expect(current(facts({ prUrl: 'https://x/pull/1', crewState: 'done', prReady: true }))).toBe(
			'review'
		);
		expect(current(facts({ merged: true }))).toBe('landed');
		expect(current(facts({ live: false, backlogState: 'done' }))).toBe('landed');
	});

	it('does not treat the last status event as state: only crew state moves it', () => {
		// A worker whose log last said "done" but whose crew state is working stays Building.
		expect(current(facts({ crewState: 'working' }))).toBe('building');
	});

	it('marks earlier steps done and later ones upcoming', () => {
		expect(states(facts({ crewSource: 'run-step' }))).toMatchObject({
			queued: 'done',
			building: 'done',
			checks: 'current',
			pr: 'upcoming'
		});
	});

	it('skips local Checks in direct-PR mode', () => {
		expect(states(facts({ mode: 'direct-PR' })).checks).toBe('skipped');
	});

	it('skips Your review when yolo is on, leaving the finished PR on the PR step', () => {
		const f = facts({ yolo: 'on', prUrl: 'https://x/pull/2', crewState: 'done', prReady: true });
		expect(states(f).review).toBe('skipped');
		expect(current(f)).toBe('pr');
	});

	it('puts a CI-ready PR still watched by the CI monitor on Your review', () => {
		const f = facts({
			prUrl: 'https://x/pull/3',
			crewState: 'working',
			crewSource: 'run-step',
			prReady: true
		});
		expect(current(f)).toBe('review');
		expect(states(f).pr).toBe('done');
		expect(defaultStageModel.passage(f).basis).toMatch(/checks green, awaiting merge/);
	});

	it('keeps a PR that is not CI-ready on the PR step', () => {
		expect(current(facts({ prUrl: 'https://x/pull/4', crewState: 'done', prReady: false }))).toBe(
			'pr'
		);
	});

	it('skips the PR step for local-only work', () => {
		const f = facts({ mode: 'local-only' });
		expect(states(f).pr).toBe('skipped');
		expect(current(facts({ mode: 'local-only', crewState: 'done' }))).toBe('review');
	});

	it('notes that no-mistakes opens the PR before CI', () => {
		const pr = defaultStageModel.passage(facts()).steps.find((s) => s.key === 'pr')!;
		expect(pr.note).toMatch(/before CI/);
		expect(pr.evidence).toEqual(['pr']);
	});

	it('explains what placed the task', () => {
		expect(defaultStageModel.passage(facts({ crewSource: 'run-step' })).basis).toMatch(/run-step/);
	});
});

describe('scout passage', () => {
	const scout = (o: Partial<StageFacts> = {}) => facts({ track: 'scout', mode: null, ...o });

	it('uses Queued → Scout → Report → Your call → Done, aligned with ship columns', () => {
		const steps = defaultStageModel.passage(scout()).steps;
		expect(steps.map((s) => s.label)).toEqual(['Queued', 'Scout', 'Report', 'Your call', 'Done']);
		expect(steps.map((s) => s.column)).toEqual(['queued', 'building', 'pr', 'review', 'landed']);
	});

	it('places scouts by crew state, report and holds', () => {
		expect(current(scout())).toBe('investigating');
		expect(current(scout({ crewState: 'done', reportPresent: true }))).toBe('report');
		expect(current(scout({ captainHold: true }))).toBe('decision');
		expect(current(scout({ live: false, backlogState: 'done' }))).toBe('done');
	});
});

describe('stagesFor', () => {
	it('returns the default model for every project for now', () => {
		expect(stagesFor('anything')).toBe(defaultStageModel);
	});
});
