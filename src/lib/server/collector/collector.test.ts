import { describe, expect, it, vi } from 'vitest';
import { Collector, type CollectorEvent } from './collector';
import type { AdapterResult, FirstmateAdapter } from '../firstmate/adapter';
import {
	parseFleetSnapshot,
	parsePrimaryReady,
	type FleetSnapshot,
	type PrimaryReady
} from '../firstmate/contracts';
import type { Compatibility } from '../firstmate/install';
import type { EvidenceReader } from '../firstmate/evidence';
import type { LedgerReader } from '../firstmate/ledger';
import type { Messenger } from '../store/messenger';
import type { MessagesView } from '../../types';
import { READY_ON_WATCH, snapshotFixture, taskRow } from '../../../../tests/helpers/fake-firstmate';

const compat: Compatibility = {
	compatible: true,
	checkedAt: '2026-10-11T00:00:00Z',
	firstmateVersion: 'abc123',
	scripts: [],
	problems: []
};

function fakeAdapter(clock: { t: number }, snapshotMs = 1000) {
	let snap: AdapterResult<FleetSnapshot> = {
		ok: true,
		value: parseFleetSnapshot(JSON.stringify(snapshotFixture({ tasks: [taskRow({ id: 'a' })] }))),
		observedAt: 'x',
		durationMs: snapshotMs
	};
	let ready: AdapterResult<PrimaryReady> = {
		ok: true,
		value: parsePrimaryReady(JSON.stringify(READY_ON_WATCH)),
		observedAt: 'x',
		durationMs: 1
	};
	const adapter: FirstmateAdapter & { snapshots: number } = {
		snapshots: 0,
		snapshot: async () => {
			adapter.snapshots++;
			clock.t += snapshotMs;
			return snap;
		},
		ready: async () => ready,
		peek: async () => ({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'p', message: 'n/a' }
		}),
		note: async () => ({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-inbox.sh', message: 'n/a' }
		}),
		receipts: async () => ({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-inbox.sh', message: 'n/a' }
		})
	};
	return {
		adapter,
		failSnapshot(message: string) {
			snap = {
				ok: false,
				observedAt: 'x',
				error: { kind: 'timeout', script: 'fm-fleet-snapshot.sh', message }
			};
		},
		setReady(v: Partial<Record<string, unknown>>) {
			ready = {
				ok: true,
				value: parsePrimaryReady(JSON.stringify({ ...READY_ON_WATCH, ...v })),
				observedAt: 'x',
				durationMs: 1
			};
		}
	};
}

function make(snapshotMs = 1000, ledger: LedgerReader | null = null, realClock = false) {
	const clock = { t: 1_000_000 };
	const fake = fakeAdapter(clock, snapshotMs);
	const collector = new Collector({
		adapter: fake.adapter,
		compatibility: compat,
		install: { firstmateDir: '/fm', homeDir: '/fm' },
		version: 'test',
		ledger,
		now: realClock ? () => Date.now() : () => clock.t
	});
	return { clock, fake, collector };
}

describe('Collector', () => {
	it('builds the fleet view and health from one round and pushes both to subscribers', async () => {
		const { collector } = make();
		const events: CollectorEvent[] = [];
		collector.subscribe((e) => events.push(e));
		await collector.tick();
		expect(events.map((e) => e.type)).toEqual(['fleet', 'health']);
		const fleet = collector.getFleet();
		expect(fleet.stale).toBe(false);
		expect(fleet.tasks.map((t) => t.id)).toEqual(['a']);
		const health = collector.health();
		expect(health.supervisor).toMatchObject({ available: true, onWatch: true });
		expect(health.firstmate.compatible).toBe(true);
	});

	it('keeps the last good view but marks it stale when reads fail', async () => {
		const { collector, fake, clock } = make();
		await collector.tick();
		fake.failSnapshot('timed out after 30000 ms');
		clock.t += 60_000;
		await collector.tick();
		const fleet = collector.getFleet();
		expect(fleet.tasks).toHaveLength(1);
		expect(fleet.stale).toBe(true);
		expect(fleet.staleReason).toMatch(/last 1 check.*timed out/);
		expect(collector.health().collector.consecutiveFailures).toBe(1);
	});

	it('says so honestly when Firstmate has never been read', async () => {
		const { collector, fake } = make();
		fake.failSnapshot('fm-fleet-snapshot.sh is missing');
		await collector.tick();
		expect(collector.getFleet()).toMatchObject({ stale: true, tasks: [] });
		expect(collector.getFleet().staleReason).toMatch(/not been able to read Firstmate yet/);
	});

	it('marks a view stale once it ages past the threshold', async () => {
		const { collector, clock } = make();
		await collector.tick();
		clock.t += collector.staleAfterMs() + 1;
		expect(collector.getFleet().stale).toBe(true);
	});

	it('runs the full snapshot on an adaptive cadence', async () => {
		const { collector, fake, clock } = make(4000);
		await collector.tick();
		expect(collector.snapshotIntervalMs()).toBe(8000);
		clock.t += 3000; // 7 s since the snapshot started: readiness only
		await collector.tick();
		expect(fake.adapter.snapshots).toBe(1);
		clock.t += 2000;
		await collector.tick();
		expect(fake.adapter.snapshots).toBe(2);
	});

	it('refreshes sooner when the ledger shows activity', async () => {
		const ledger = {
			poll: vi.fn(async () => 0),
			state: () => ({ available: true, reason: null, tasks: new Map() }),
			task: () => null
		} as unknown as LedgerReader;
		const { collector, fake, clock } = make(4000, ledger);
		await collector.tick();
		clock.t += 1500; // 5.5 s since the snapshot started, below the 8 s cadence
		vi.mocked(ledger.poll).mockResolvedValueOnce(2);
		await collector.tick();
		expect(fake.adapter.snapshots).toBe(2);
	});

	it('reports Firstmate off watch with a reason', async () => {
		const { collector, fake } = make();
		fake.setReady({ lock: { state: 'free', pid: null, live_harness: false }, can_receive: false });
		await collector.tick();
		expect(collector.health().supervisor).toMatchObject({
			onWatch: false,
			reason: expect.stringMatching(/No Firstmate session/)
		});
	});

	it('shares one round between concurrent callers', async () => {
		const { collector, fake } = make();
		await Promise.all([collector.tick(), collector.tick(), collector.tick()]);
		expect(fake.adapter.snapshots).toBe(1);
	});

	it('does not let a broken subscriber stop the round', async () => {
		const { collector } = make();
		collector.subscribe(() => {
			throw new Error('boom');
		});
		await expect(collector.tick()).resolves.toBeUndefined();
	});

	it('keeps polling and reports the error when a round throws', async () => {
		vi.useFakeTimers();
		try {
			const { collector, fake } = make(0, null, true);
			const ready = fake.adapter.ready;
			let calls = 0;
			fake.adapter.ready = async () => {
				if (calls++ === 0) throw new Error('bad data');
				return ready();
			};
			collector.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(collector.health().collector.lastError).toBe('bad data');
			await vi.advanceTimersByTimeAsync(6_000);
			collector.stop();
			expect(calls).toBeGreaterThanOrEqual(2);
			expect(collector.health().supervisor.onWatch).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('polls on a timer until stopped', async () => {
		vi.useFakeTimers();
		try {
			const { collector, fake } = make(0, null, true);
			collector.start();
			await vi.advanceTimersByTimeAsync(16_000);
			collector.stop();
			const n = fake.adapter.snapshots;
			expect(n).toBeGreaterThanOrEqual(3);
			await vi.advanceTimersByTimeAsync(20_000);
			expect(fake.adapter.snapshots).toBe(n);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reconciles messages each round, forwards their changes and reports messaging in health', async () => {
		const listeners: ((v: MessagesView) => void)[] = [];
		let rounds = 0;
		const messenger = {
			available: true,
			reason: null,
			storeFile: '/state/wheelhouse/homes/x/messages.json',
			subscribe: (fn: (v: MessagesView) => void) => {
				listeners.push(fn);
				return () => {};
			},
			reconcile: async () => {
				rounds++;
			}
		} as unknown as Messenger;
		const collector = new Collector({
			adapter: fakeAdapter({ t: 0 }).adapter,
			compatibility: compat,
			install: { firstmateDir: '/fm', homeDir: '/fm' },
			version: 'test',
			messenger
		});
		const events: CollectorEvent[] = [];
		collector.subscribe((e) => events.push(e));
		await collector.tick();
		expect(rounds).toBe(1);
		const view = { schema: 'wheelhouse-messages.v1', messages: [] } as unknown as MessagesView;
		listeners.forEach((fn) => fn(view));
		expect(events.at(-1)).toEqual({ type: 'messages', data: view });
		expect(collector.health().messaging).toEqual({
			available: true,
			reason: null,
			store: '/state/wheelhouse/homes/x/messages.json'
		});
	});

	it('does not hold the fleet and health refresh for a hung reconcile', async () => {
		const messenger = {
			available: true,
			reason: null,
			storeFile: '/state/wheelhouse/homes/x/messages.json',
			subscribe: () => () => {},
			reconcile: () => new Promise<void>(() => {})
		} as unknown as Messenger;
		const collector = new Collector({
			adapter: fakeAdapter({ t: 0 }).adapter,
			compatibility: compat,
			install: { firstmateDir: '/fm', homeDir: '/fm' },
			version: 'test',
			messenger
		});
		const events: CollectorEvent[] = [];
		collector.subscribe((e) => events.push(e));
		await collector.tick();
		expect(events.map((e) => e.type)).toEqual(['fleet', 'health']);
	});

	it('says why messaging is off when there is no messenger', () => {
		const collector = new Collector({
			adapter: fakeAdapter({ t: 0 }).adapter,
			compatibility: compat,
			install: { firstmateDir: '/fm', homeDir: '/fm' },
			version: 'test',
			messagingUnavailable: 'state dir is inside the home'
		});
		expect(collector.health().messaging).toEqual({
			available: false,
			reason: 'state dir is inside the home',
			store: null
		});
	});
	it('reads the PR only for tasks that could be awaiting the merge', async () => {
		const RUN = '01M4N30B7JVFV5989ZS2QEVZ7Q';
		const RED = '01M4N30B7JVFV5989ZS2QEVZ7R';
		const VAL = '01M4N30B7JVFV5989ZS2QEVZ7S';
		const pr = (id: string) => `https://github.com/o/r/pull/${id}`;
		const rows = [
			taskRow({ id: 'done', pr: pr('1'), state: 'done', source: 'status-log', detail: 'done' }),
			taskRow({ id: 'green', pr: pr('2'), source: 'run-step', detail: `ci running · run: ${RUN}` }),
			taskRow({ id: 'paused', pr: pr('3'), state: 'paused', source: 'status-log', detail: 'wait' }),
			taskRow({ id: 'red', pr: pr('4'), source: 'run-step', detail: `ci running · run: ${RED}` }),
			taskRow({ id: 'fixing', pr: pr('5'), source: 'run-step', detail: 'fixing · run: x' }),
			taskRow({
				id: 'validating',
				pr: pr('6'),
				source: 'run-step',
				detail: `validating (running) run: ${VAL}`
			}),
			taskRow({ id: 'nopr', state: 'done', source: 'status-log', detail: 'done' })
		];
		const prReads: string[] = [];
		const evidence = {
			setDataDir: () => {},
			thumb: async () => ({ kind: 'none' }),
			screenshots: async () => [],
			ciChecks: async (runId: string | null) =>
				runId === RED ? 'not-ready' : runId === VAL ? 'unknown' : 'green',
			pipeline: async () => null,
			diff: async () => ({ available: false, reason: 'test' }),
			pr: async (id: string, url: string) => {
				prReads.push(id);
				return {
					available: true,
					source: 'test',
					observedAt: null,
					value: {
						url,
						number: 1,
						state: id === 'paused' ? 'closed' : 'open',
						draft: false,
						reviewDecision: null,
						checks: []
					}
				};
			}
		} as unknown as EvidenceReader;
		const clock = { t: 1_000_000 };
		const fake = fakeAdapter(clock);
		fake.adapter.snapshot = async () => ({
			ok: true,
			value: parseFleetSnapshot(JSON.stringify(snapshotFixture({ tasks: rows }))),
			observedAt: 'x',
			durationMs: 1
		});
		const collector = new Collector({
			adapter: fake.adapter,
			compatibility: compat,
			install: { firstmateDir: '/fm', homeDir: '/fm' },
			version: 'test',
			evidence,
			now: () => clock.t
		});
		await collector.tick();
		expect(prReads.sort()).toEqual(['done', 'green', 'paused']);
		const status = new Map(collector.getFleet().tasks.map((t) => [t.id, t.status]));
		expect(status.get('done')).toBe('needs-review');
		expect(status.get('green')).toBe('needs-review');
		expect(status.get('paused')).not.toBe('needs-review');
		expect(status.get('red')).toBe('working');
		expect(status.get('validating')).not.toBe('needs-review');
	});

	it('reads the validation step only for working runs, and counts changed files', async () => {
		const RUN = '01M4N30B7JVFV5989ZS2QEVZ7Q';
		const rows = [
			taskRow({
				id: 'validating',
				source: 'run-step',
				detail: `validating (running) · run: ${RUN}`,
				worktree: '/wt/validating'
			}),
			taskRow({
				id: 'parked',
				state: 'parked',
				source: 'run-step',
				detail: `parked at review: 2 finding(s) · run: ${RUN}`
			}),
			taskRow({ id: 'busy', worktree: '/wt/busy' })
		];
		const pipelineReads: (string | null)[] = [];
		const evidence = {
			setDataDir: () => {},
			thumb: async () => ({ kind: 'none' }),
			screenshots: async () => [],
			ciChecks: async () => 'unknown',
			pr: async () => ({ available: false, reason: 'test' }),
			pipeline: async (runId: string | null) => {
				pipelineReads.push(runId);
				return runId
					? { step: 'review', label: 'Review', startedAt: '2026-10-11T05:00:00Z', round: 2 }
					: null;
			},
			diff: async (wt: string) => ({
				available: true,
				source: 'test',
				observedAt: null,
				value: {
					base: 'main',
					mergeBase: 'abc',
					branch: null,
					files: wt === '/wt/busy' ? [1, 2, 3] : [1],
					total: wt === '/wt/busy' ? 301 : 1,
					truncated: wt === '/wt/busy'
				}
			})
		} as unknown as EvidenceReader;
		const clock = { t: 1_000_000 };
		const fake = fakeAdapter(clock);
		fake.adapter.snapshot = async () => ({
			ok: true,
			value: parseFleetSnapshot(JSON.stringify(snapshotFixture({ tasks: rows }))),
			observedAt: 'x',
			durationMs: 1
		});
		const collector = new Collector({
			adapter: fake.adapter,
			compatibility: compat,
			install: { firstmateDir: '/fm', homeDir: '/fm' },
			version: 'test',
			evidence,
			now: () => clock.t
		});
		await collector.tick();
		expect(pipelineReads.filter(Boolean)).toEqual([RUN]);
		const tasks = new Map(collector.getFleet().tasks.map((t) => [t.id, t]));
		expect(tasks.get('validating')!.pipeline?.round).toBe(2);
		expect(tasks.get('validating')!.activity).toEqual({
			text: 'Validating: fixing review findings (round 2)',
			at: '2026-10-11T05:00:00Z',
			source: 'pipeline'
		});
		expect(tasks.get('validating')!.filesChanged).toBe(1);
		expect(tasks.get('parked')!.pipeline).toBeNull();
		expect(tasks.get('parked')!.activity?.text).toBe(
			'Review found 2 issues; waiting on a decision'
		);
		expect(tasks.get('busy')!.filesChanged).toBe(301);
		expect(tasks.get('busy')!.busy).toBe(true);
	});
});
