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
import type { LedgerReader } from '../firstmate/ledger';
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
});
