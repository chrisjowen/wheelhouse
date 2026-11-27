import { describe, expect, it } from 'vitest';
import {
	fleetFreshness,
	noticeSummary,
	notices,
	sampleNoticeInput,
	type NoticeInput
} from './notices';

const NOW = Date.parse('2026-11-13T12:00:00Z');

function input(over: {
	connectionLost?: boolean;
	configured?: boolean;
	compatible?: boolean;
	problems?: string[];
	onWatch?: boolean | null;
	reason?: string | null;
	stale?: boolean;
	collectedAt?: string | null;
	snapshotIntervalMs?: number;
}): NoticeInput {
	return {
		connectionLost: over.connectionLost ?? false,
		health: {
			configured: over.configured ?? true,
			firstmate: {
				dir: null,
				home: null,
				version: null,
				compatible: over.compatible ?? true,
				problems: over.problems ?? [],
				scripts: []
			},
			supervisor: {
				available: true,
				onWatch: over.onWatch === undefined ? true : over.onWatch,
				reason: over.reason ?? null,
				observedAt: null,
				posture: null
			},
			collector: {
				snapshotIntervalMs: over.snapshotIntervalMs ?? 5000,
				maxSnapshotIntervalMs: 30_000
			}
		},
		fleet: {
			stale: over.stale ?? false,
			collectedAt: over.collectedAt === undefined ? '2026-11-13T11:00:00Z' : over.collectedAt
		},
		now: NOW
	};
}

const INTERNALS = /\.sh\b|\b\d+\s*ms\b|timed out|fm-/;

describe('the notice strip', () => {
	it('is empty when everything is well', () => {
		expect(notices(input({}))).toEqual([]);
		expect(noticeSummary([])).toBe('');
	});

	it('says the three phone banners in plain words, worst first, with a count', () => {
		const list = notices(
			input({
				connectionLost: true,
				onWatch: null,
				reason: 'fm-inbox.sh timed out after 10000 ms',
				stale: true
			})
		);
		expect(list.map((n) => n.key)).toEqual(['connection', 'stale', 'watch']);
		expect(noticeSummary(list)).toBe('Connection trouble · 3 issues');
		expect(list.find((n) => n.key === 'watch')!.text).toBe(
			'Firstmate isn’t answering right now. Task states are still read from its records.'
		);
		expect(list.find((n) => n.key === 'stale')!.text).toBe(
			'Fleet view last updated 1 h ago. Wheelhouse keeps trying.'
		);
		for (const n of list) {
			expect(n.title).not.toMatch(INTERNALS);
			expect(n.text).not.toMatch(INTERNALS);
		}
	});

	it('names a single condition without a count', () => {
		expect(noticeSummary(notices(input({ stale: true })))).toBe('Updates may be late');
		expect(noticeSummary(notices(input({ onWatch: false })))).toBe('Firstmate is off watch');
	});

	it('keeps a readable reason and drops a technical one', () => {
		const plain = notices(
			input({ onWatch: false, reason: 'No Firstmate session is running in this home.' })
		);
		expect(plain[0].text).toBe(
			'Firstmate is off watch. No Firstmate session is running in this home. Task states are still read from its records.'
		);
		const unclear = notices(
			input({ onWatch: null, reason: 'Firstmate’s readiness is unclear (wake_consumer=stale).' })
		);
		expect(unclear[0].text).toBe(
			'Firstmate isn’t answering right now. Firstmate’s readiness is unclear. Task states are still read from its records.'
		);
	});

	it('says when the fleet has never been read', () => {
		const [n] = notices(input({ stale: true, collectedAt: null }));
		expect(n.text).toBe('Wheelhouse hasn’t been able to read the fleet yet. It keeps trying.');
	});

	it('covers a missing or mismatched Firstmate without naming its scripts', () => {
		const setup = notices(
			input({ configured: false, problems: ['WHEELHOUSE_FIRSTMATE_DIR is not set'] })
		);
		expect(setup.map((n) => n.key)).toEqual(['setup']);
		expect(setup[0].text).toBe('Wheelhouse isn’t connected to a Firstmate home.');
		const compat = notices(input({ compatible: false, problems: ['fm-inbox.sh is missing'] }));
		expect(noticeSummary(compat)).toBe('Firstmate may not be compatible');
		expect(compat[0].text).not.toMatch(INTERNALS);
	});

	it('says how old the fleet view is while reading it is slow, outside the strip', () => {
		const at = (ago: number) => new Date(NOW - ago * 1000).toISOString();
		const slow = input({ snapshotIntervalMs: 30_000, collectedAt: at(42) });
		expect(notices(slow)).toEqual([]);
		const f = fleetFreshness(slow);
		expect(f).toEqual({
			label: 'Fleet as of 42 s ago',
			text: 'Reading the fleet from Firstmate is slow right now, so Wheelhouse reads it every 30 s. What you see is from 42 s ago.'
		});
		expect(f?.text).not.toMatch(INTERNALS);
		// Below the cap, or already called stale, it says nothing of its own.
		expect(fleetFreshness(input({ snapshotIntervalMs: 20_000, collectedAt: at(42) }))).toBeNull();
		const stale = input({ snapshotIntervalMs: 30_000, stale: true });
		expect(fleetFreshness(stale)).toBeNull();
		expect(notices(stale).map((x) => x.key)).toEqual(['stale']);
	});

	it('builds made-up conditions for trying the strip', () => {
		const list = notices(sampleNoticeInput('lost,watch,stale', NOW));
		expect(noticeSummary(list)).toBe('Connection trouble · 3 issues');
		expect(notices(sampleNoticeInput('server', NOW)).map((n) => n.key)).toEqual(['connection']);
		expect(notices(sampleNoticeInput('', NOW))).toEqual([]);
		expect(notices(sampleNoticeInput('slow', NOW))).toEqual([]);
		expect(fleetFreshness(sampleNoticeInput('slow', NOW))?.label).toBe('Fleet as of 40 s ago');
	});
});
