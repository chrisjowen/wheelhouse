import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN } from './builtin';
import { evaluate, holds, type CheckState } from './engine';
import { resolvePassage, type ResolvedPassage } from './resolve';
import { parsePassage } from './schema';
import type { StageFacts } from '../firstmate/stages';
import type { Passage } from '../../types';

function load(name: string, origin: 'project' | 'captain' = 'project'): ResolvedPassage {
	const text = readFileSync(path.join(import.meta.dirname, 'testdata', name), 'utf8');
	const r = parsePassage(text, { kind: 'overlay', captain: origin === 'captain' });
	if (!r.ok) throw new Error(r.errors.join('; '));
	const { passage, errors } = resolvePassage(BUILTIN.ship, [{ origin, file: r.value }]);
	if (errors.size) throw new Error([...errors.values()].flat().join('; '));
	return passage;
}

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

/** Only `merged`: a task whose worker, run and PR records were cleaned up. */
const cleanedUp = (o: Partial<StageFacts> = {}) =>
	facts({
		backlogState: 'done',
		live: false,
		crewState: null,
		crewSource: null,
		merged: true,
		...o
	});

const observed = (outcome: string, extra: Partial<CheckState> = {}): CheckState => ({
	state: 'observed',
	outcomes: [outcome],
	summary: `${outcome}.`,
	url: null,
	observedAt: '2026-10-11T10:00:00Z',
	...extra
});

const checks =
	(m: Record<string, CheckState>) =>
	(id: string): CheckState | undefined =>
		m[id];

/** The design's lab rendering: steps with the current one in brackets. */
function track(p: Passage): string {
	return p.steps
		.filter((s) => s.state !== 'skipped')
		.map((s) => (s.state === 'current' ? `[${s.label}${s.failed ? ' FAILED' : ''}]` : s.label))
		.join(' > ');
}

describe('the stage rules over a project passage (design lab cases)', () => {
	const web = load('web-app.wheelhouse.yaml');

	it('places tasks on the web-app passage with the high-water rule', () => {
		expect(track(evaluate(web, facts()))).toBe(
			'Queued > [Building] > Checks > Pull request > Your review > Landed > Deployed'
		);
		expect(
			track(
				evaluate(
					web,
					facts({ prUrl: 'https://github.com/o/r/pull/1', crewState: 'done', prReady: true })
				)
			)
		).toBe('Queued > Building > Checks > Pull request > [Your review] > Landed > Deployed');
		expect(track(evaluate(web, cleanedUp(), checks({ production: observed('in_progress') })))).toBe(
			'Queued > Building > Checks > Pull request > Your review > [Landed] > Deployed'
		);
		expect(
			track(
				evaluate(
					web,
					cleanedUp(),
					checks({ production: observed('success'), 'live-commit': observed('ok') })
				)
			)
		).toBe('Queued > Building > Checks > Pull request > Your review > Landed > [Deployed]');
		expect(track(evaluate(web, cleanedUp(), checks({ production: observed('failure') })))).toBe(
			'Queued > Building > Checks > Pull request > Your review > Landed > [Deployed FAILED]'
		);
		expect(
			track(
				evaluate(
					web,
					cleanedUp({ live: true, mode: 'direct-PR', yolo: 'on' }),
					checks({ production: observed('success'), 'live-commit': observed('ok') })
				)
			)
		).toBe('Queued > Building > Pull request > Landed > [Deployed]');
	});

	it('needs every part of an all: condition', () => {
		const p = evaluate(web, cleanedUp(), checks({ production: observed('success') }));
		expect(p.steps[p.current].key).toBe('landed');
		expect(p.live).toBe(false);
	});

	it('explains a declared step from its checks, and a failure from its condition', () => {
		const ok = evaluate(
			web,
			cleanedUp(),
			checks({
				production: observed('success', { summary: 'Production deployment succeeded.' }),
				'live-commit': observed('ok', { summary: 'docs.example.dev reports the commit.' })
			})
		);
		expect(ok.basis).toBe(
			'Deployed: Production deployment succeeded; docs.example.dev reports the commit'
		);
		const failed = evaluate(
			web,
			cleanedUp(),
			checks({ production: observed('failure', { summary: 'Failed.' }) })
		);
		expect(failed.basis).toBe('Deployed failed: Failed');
		expect(failed.steps.find((s) => s.key === 'landed')!.state).toBe('done');
	});

	it('counts live only at or past the declared live step, and not on a failure', () => {
		expect(evaluate(BUILTIN_SHIP(), cleanedUp()).live).toBeNull();
		const live = evaluate(
			web,
			cleanedUp(),
			checks({ production: observed('success'), 'live-commit': observed('ok') })
		);
		expect(live.live).toBe(true);
		expect(evaluate(web, cleanedUp(), checks({ production: observed('failure') })).live).toBe(
			false
		);
	});

	it('makes the current step’s declared link the primary link', () => {
		const review = evaluate(
			web,
			facts({ prUrl: 'https://github.com/o/r/pull/1', crewState: 'done', prReady: true }),
			checks({ preview: observed('success', { url: 'https://preview.example.dev' }) }),
			(id) => (id === 'preview' ? 'preview' : id)
		);
		expect(review.link).toEqual({ label: 'Open preview', url: 'https://preview.example.dev' });
		const deployed = evaluate(
			web,
			cleanedUp(),
			checks({
				production: observed('success', { url: 'https://docs.example.dev' }),
				'live-commit': observed('ok')
			}),
			(id) => (id === 'production' ? 'Production deployment' : id)
		);
		expect(deployed.link).toEqual({
			label: 'Open Production deployment',
			url: 'https://docs.example.dev'
		});
	});

	it('never treats an unknown check as not reached; it says it cannot tell', () => {
		const p = evaluate(
			web,
			cleanedUp(),
			checks({
				production: {
					state: 'unknown',
					outcomes: [],
					summary: 'GitHub did not answer in time.',
					url: null,
					observedAt: null
				}
			})
		);
		expect(p.steps[p.current].key).toBe('landed');
		expect(p.steps.find((s) => s.key === 'deployed')!.note).toBe(
			"Can't tell: GitHub did not answer in time."
		);
	});

	it('does not let `not` hold over a check that has observed nothing', () => {
		const unknown: CheckState = {
			state: 'unknown',
			outcomes: [],
			summary: 'GitHub did not answer in time.',
			url: null,
			observedAt: null
		};
		const off: CheckState = { ...unknown, state: 'off', summary: 'Off.' };
		const notOk = { not: 'live-commit.ok' };
		expect(holds(notOk, cleanedUp(), checks({ 'live-commit': unknown }))).toBe(false);
		expect(holds(notOk, cleanedUp(), checks({ 'live-commit': off }))).toBe(false);
		expect(holds(notOk, cleanedUp(), checks({ 'live-commit': observed('mismatch') }))).toBe(true);
		expect(holds(notOk, cleanedUp(), checks({ 'live-commit': observed('ok') }))).toBe(false);
		expect(holds({ not: 'merged' }, cleanedUp(), checks({}))).toBe(false);
	});

	it('keeps a step on the outcomes it last observed while its check cannot tell', () => {
		const p = evaluate(
			web,
			cleanedUp(),
			checks({
				production: {
					state: 'unknown',
					outcomes: ['failure'],
					summary: 'GitHub answered 502.',
					url: null,
					observedAt: '2026-10-11T10:00:00Z'
				}
			})
		);
		expect(p.steps[p.current]).toMatchObject({ key: 'deployed', failed: true });
		expect(p.steps[p.current].note).toBe("Can't tell: GitHub answered 502.");
		expect(p.basis).toBe('Deployed failed: production.failure');
	});

	it('says plainly when it stopped checking', () => {
		const p = evaluate(
			web,
			cleanedUp(),
			checks({
				production: { ...observed('absent'), state: 'gave-up' },
				'live-commit': { ...observed('mismatch'), state: 'gave-up' }
			})
		);
		expect(p.steps.find((s) => s.key === 'deployed')!.note).toBe(
			'Not reached within 24h; Wheelhouse stopped checking.'
		);
	});

	it('lists the declared checks and their results', () => {
		const p = evaluate(
			web,
			cleanedUp(),
			checks({ production: observed('success', { url: 'javascript:alert(1)' }) })
		);
		expect(p.custom).toBe(true);
		expect(p.checks.map((c) => [c.id, c.state, c.outcome])).toEqual([
			['preview', 'waiting', null],
			['production', 'observed', 'success'],
			['live-commit', 'waiting', null]
		]);
		expect(p.checks[1].url).toBeNull();
	});
});

describe('a captain-owned passage for Firstmate itself', () => {
	it('adds Aboard after Landed', () => {
		const fm = load('firstmate.captain.yaml', 'captain');
		expect(track(evaluate(fm, cleanedUp()))).toBe(
			'Queued > Building > Checks > Pull request > Your review > [Landed] > Aboard'
		);
		expect(track(evaluate(fm, cleanedUp(), checks({ aboard: observed('yes') })))).toBe(
			'Queued > Building > Checks > Pull request > Your review > Landed > [Aboard]'
		);
	});
});

describe('a library released by tag and published to npm', () => {
	it('walks Landed → Released → On npm', () => {
		const lib = load('cli-library.wheelhouse.yaml');
		const at = (m: Record<string, CheckState>) => {
			const p = evaluate(lib, cleanedUp(), checks(m));
			return p.steps[p.current].key;
		};
		expect(at({})).toBe('landed');
		expect(at({ release: observed('included') })).toBe('released');
		expect(
			at({
				release: observed('included'),
				npm: { ...observed('published'), outcomes: ['published'] }
			})
		).toBe('released');
		expect(
			at({
				release: observed('included'),
				npm: { ...observed('published'), outcomes: ['published', 'latest'] }
			})
		).toBe('published');
	});
});

function BUILTIN_SHIP() {
	return resolvePassage(BUILTIN.ship, []).passage;
}
