import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AlertDraft } from '../../bell';
import type { MachineSample, ServiceSample } from '../../soundings';
import type { RunResult } from '../firstmate/exec';
import { SoundingsService, type SoundingsDeps } from './service';
import { sample, vitals } from './testing';

const START = Date.parse('2026-11-17T12:00:00.000Z');
const MIN = 60_000;

const claw = (runs: number): ServiceSample => ({
	label: 'com.example.claw',
	runs,
	lastExit: 78,
	pid: null,
	state: 'spawn scheduled',
	periodic: false,
	program: '/opt/example/bin/claw-agent'
});

/** A Soundings with a clock, a probe that answers with `scans` in turn, and a report writer. */
function setup(o: { scans: MachineSample[]; enabled?: boolean; report?: unknown; dir?: string }) {
	const dir = o.dir ?? mkdtempSync(path.join(tmpdir(), 'soundings-'));
	let now = START;
	let next = 0;
	const rang: AlertDraft[] = [];
	const prompts: string[] = [];
	const probeRuns: { file: string; args: string[]; input?: string }[] = [];
	const deps: SoundingsDeps = {
		stateDir: path.join(dir, 'state'),
		configDir: path.join(dir, 'config'),
		enabled: async () => o.enabled ?? true,
		vitals: () => vitals(),
		vitalsHistory: () => [],
		setFootprint: () => {},
		ring: (d) => rang.push(d),
		run: async (file, args, opts): Promise<RunResult> => {
			probeRuns.push({ file, args, input: opts.input });
			const s = o.scans[Math.min(next++, o.scans.length - 1)];
			return {
				ok: true,
				stdout: JSON.stringify({ ...s, at: new Date(now).toISOString() }),
				stderr: '',
				durationMs: 5
			};
		},
		probeFile: '/opt/wheelhouse/dist/soundings-probe.js',
		scanHere: async () => {
			throw new Error('not here');
		},
		runHelper: async (input) => {
			prompts.push(input);
			return {
				ok: true,
				stdout: JSON.stringify({
					structured_output: o.report ?? {
						status: 'attention',
						headline: 'A background service is crash-looping.',
						summary: 'com.example.claw restarts every few seconds.',
						items: [{ title: 'Crash loop', cause: 'A bad config key.', fix: 'Fix the key.' }]
					}
				})
			};
		},
		helperDeps: { env: {}, run: vi.fn(), fetch, find: () => null },
		env: {},
		now: () => now,
		log: () => {}
	};
	const service = new SoundingsService(deps);
	return {
		service,
		dir,
		rang,
		prompts,
		probeRuns,
		advance: (minutes: number) => (now += minutes * MIN)
	};
}

describe('Soundings', () => {
	it('does nothing while the feature is off', async () => {
		const t = setup({ scans: [sample()], enabled: false });
		await t.service.tick();
		expect(t.probeRuns).toEqual([]);
		expect(await t.service.receive([{ kind: 'console', message: 'x' }])).toBe(0);
		expect((await t.service.view()).enabled).toBe(false);
	});

	it('scans with the built probe under nice, telling it Wheelhouse’s pid', async () => {
		const t = setup({ scans: [sample()] });
		await t.service.tick();
		expect(t.probeRuns).toHaveLength(1);
		expect(t.probeRuns[0].file).toBe('nice');
		expect(t.probeRuns[0].args).toEqual([
			'-n',
			'10',
			process.execPath,
			'/opt/wheelhouse/dist/soundings-probe.js'
		]);
		expect(JSON.parse(t.probeRuns[0].input!)).toEqual({ wheelhousePid: process.pid, logDirs: [] });
		// The next minute only judges again; a scan comes when one is due.
		t.advance(1);
		await t.service.tick();
		expect(t.probeRuns).toHaveLength(1);
		t.advance(4);
		await t.service.tick();
		expect(t.probeRuns).toHaveLength(2);
	});

	it('finds a crash loop on the second scan, rings once, then writes a report about it', async () => {
		const t = setup({
			scans: [
				sample({ services: [claw(1000)] }),
				sample({ services: [claw(1250)] }),
				sample({ services: [claw(1500)] })
			]
		});
		await t.service.tick();
		expect((await t.service.view()).findings).toEqual([]);
		// The first scan is the baseline; its report is due straight away.
		expect(t.prompts).toHaveLength(1);
		t.advance(5);
		await t.service.tick();
		const view = await t.service.view();
		expect(view.findings.map((f) => f.id)).toEqual(['crash-loop:com.example.claw']);
		// The first scan's hourly report rang first; the finding rings once.
		const found = () => t.rang.filter((a) => a.title === 'Soundings');
		expect(found()).toHaveLength(1);
		expect(found()[0]).toMatchObject({
			id: `health:crash-loop:com.example.claw:${new Date(START + 5 * MIN).toISOString()}`,
			kind: 'health',
			captain: true
		});
		expect(found()[0].actions.map((a) => a.kind)).toEqual(['open', 'note']);
		// Too soon after the last report: the new finding waits for the gap.
		expect(t.prompts).toHaveLength(1);
		t.advance(5);
		await t.service.tick();
		expect(found()).toHaveLength(1);
		expect(t.prompts).toHaveLength(2);
		expect(t.prompts[1]).toContain('com.example.claw keeps crashing');
		const after = await t.service.view();
		expect(after.reports[0]).toMatchObject({
			trigger: 'finding',
			model: 'haiku',
			headline: 'A background service is crash-looping.'
		});
	});

	it('clears a finding when its problem goes, and remembers it', async () => {
		const t = setup({
			scans: [
				sample({ services: [claw(1000)] }),
				sample({ services: [claw(1500)] }),
				sample({ services: [claw(1500)] })
			]
		});
		await t.service.tick();
		t.advance(5);
		await t.service.tick();
		t.advance(5);
		await t.service.tick();
		const view = await t.service.view();
		expect(view.findings).toEqual([]);
		expect(view.cleared.map((f) => f.id)).toEqual(['crash-loop:com.example.claw']);
		expect(view.cleared[0].closedAt).toBe(new Date(START + 10 * MIN).toISOString());
	});

	it('keeps a muted finding quiet', async () => {
		const t = setup({
			scans: [sample({ services: [claw(1000)] }), sample({ services: [claw(2000)] })]
		});
		await t.service.mute('crash-loop:com.example.claw', true);
		await t.service.tick();
		t.advance(5);
		await t.service.tick();
		expect(t.rang.filter((a) => a.title === 'Soundings')).toEqual([]);
		expect((await t.service.view()).muted).toEqual(['crash-loop:com.example.claw']);
	});

	it('rings for an hourly report that wants a look, once for what it says', async () => {
		const t = setup({ scans: [sample()] });
		await t.service.tick();
		// The first report is the hourly one.
		expect(t.rang.map((a) => a.title)).toEqual(['Soundings report']);
		t.advance(60);
		await t.service.tick();
		expect(t.prompts).toHaveLength(2);
		expect(t.rang).toHaveLength(1);
	});

	it('keeps its findings, scans and reports across a restart', async () => {
		const t = setup({
			scans: [sample({ services: [claw(1000)] }), sample({ services: [claw(1500)] })]
		});
		await t.service.tick();
		t.advance(5);
		await t.service.tick();
		const again = setup({ scans: [sample()], dir: t.dir });
		const view = await again.service.view();
		expect(view.findings.map((f) => f.id)).toEqual(['crash-loop:com.example.claw']);
		expect(view.machine?.services[0].runs).toBe(1500);
		expect(view.reports).toHaveLength(1);
		const state = JSON.parse(
			readFileSync(path.join(t.dir, 'state', 'soundings', 'state.json'), 'utf8')
		);
		expect(state.history).toHaveLength(1);
	});

	it('takes in page trouble masked, cut short and within its limits', async () => {
		const t = setup({ scans: [sample()] });
		await t.service.tick();
		expect(
			await t.service.receive([
				{ kind: 'network', message: 'GET /x?token=abc123 → 500', page: '/harbour?x=1', count: 3 },
				{ kind: 'nonsense', message: 'x' },
				{ kind: 'console', message: 'y'.repeat(900) }
			])
		).toBe(2);
		const { signals } = await t.service.view();
		expect(signals.map((s) => [s.kind, s.page, s.count])).toEqual([
			['console', '/', 1],
			['network', '/harbour', 3]
		]);
		expect(signals[1].message).toBe('GET /x?token=••• → 500');
		expect(signals[0].message).toHaveLength(300);
		let taken = 0;
		for (let i = 0; i < 20; i++)
			taken += await t.service.receive(
				Array.from({ length: 30 }, () => ({ kind: 'console', message: 'again' }))
			);
		expect(taken).toBe(198);
	});

	it('saves settings, keeping only what is sensible', async () => {
		const t = setup({ scans: [sample()] });
		const s = await t.service.saveSettings({
			scanMinutes: 2,
			restartsPerHour: -5,
			model: 'sonnet',
			logDirs: ['~/svc/logs', '', 3]
		});
		expect(s.scanMinutes).toBe(2);
		expect(s.restartsPerHour).toBe(30);
		expect(s.model).toBe('sonnet');
		expect(s.logDirs).toEqual(['~/svc/logs']);
		expect((await t.service.view()).settings.scanMinutes).toBe(2);
	});

	it('says why a report could not be written', async () => {
		const t = setup({ scans: [sample()] });
		(t.service as unknown as { d: SoundingsDeps }).d.runHelper = async () => ({
			ok: false,
			status: 503,
			error:
				'Claude Code (`claude`) is not installed or not on PATH, so the preview helper cannot answer.'
		});
		await t.service.tick();
		expect((await t.service.view()).problem).toBe(
			'The report could not be written: Claude Code (`claude`) is not installed or not on PATH, so the report cannot answer.'
		);
	});
});
