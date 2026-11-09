import { describe, expect, it } from 'vitest';
import { parseFleetSnapshot } from './contracts';
import { deriveTasks } from './model';
import { deriveSecondMates, mateTaskSummaries, SECOND_MATE_GAPS } from './secondmates';
import {
	backlogRow,
	mateRecord,
	secondMates,
	snapshotFixture,
	taskRow
} from '../../../../tests/helpers/fake-firstmate';

const snap = (o: Record<string, unknown>) => parseFleetSnapshot(JSON.stringify(snapshotFixture(o)));
const ctx = { registry: [], thumbs: new Map(), ledger: new Map(), nowSeconds: 1_800_000_000 };

/** A second mate's own row in the parent's tasks[]. */
const mateRow = (id: string, endpointExists = true) =>
	taskRow({
		id,
		kind: 'secondmate',
		endpointExists,
		project: '/fm',
		backlog: { kind: 'secondmate' }
	});

const busyHome = mateRecord({
	id: 'tokyo',
	remote: true,
	host: 'tokyo-box',
	state: 'captain_decision',
	active: [
		{
			id: 'tk-api',
			kind: 'ship',
			state: 'working',
			repo: 'lumen',
			name: 'Add the share API',
			source: 'run-step',
			doing: 'review running'
		}
	],
	decisions: [
		{
			id: 'tk-plan',
			key: 'tk-plan',
			verb: 'captain-hold',
			summary: 'Pick a plan',
			reason: 'Which storage? Recommendation: use Postgres.',
			question: 'Pick a plan: Which storage? Recommendation: use Postgres.',
			source: 'backlog'
		},
		{
			id: 'tk-api',
			key: 'nm-1-review',
			verb: 'needs-decision',
			summary: 'ask-user findings=f1 file=/home/fm/tokyo/data/tk-api/nm-1-findings.txt',
			reason: null,
			source: 'status'
		}
	],
	holds: [
		{ id: 'tk-docs', title: 'Write the docs', reason: 'parked at a gate', source: 'child-state' }
	],
	queued: [
		{
			id: 'tk-plan',
			title: 'Pick a plan',
			question: 'Pick a plan: Which storage?',
			hold_kind: 'captain',
			hold_reason: 'Which storage?',
			captain_actionable: true,
			repo: 'lumen',
			since: '2026-10-09'
		},
		{
			id: 'tk-next',
			title: 'Next thing',
			blocked_by: 'tk-api',
			captain_actionable: false,
			repo: 'atlas',
			since: '2026-10-10'
		}
	],
	landed: [
		{
			id: 'tk-old',
			title: 'Old work',
			kind: 'ship',
			pr_url: 'https://github.com/o/lumen/pull/7',
			completion: { verb: 'merged', date: '2026-10-08' }
		}
	],
	endpoints: [
		{ id: 'tk-api', state: 'working', source: 'run-step', endpoint: { exists: true } },
		{ id: 'tk-docs', state: 'parked', source: 'pane', endpoint: { exists: true } },
		{ id: 'tk-fin', state: 'done', source: 'status', endpoint: { exists: true } }
	],
	counts: { queued: 5 }
});

describe('secondmate_current in the snapshot', () => {
	it('is read leniently: a malformed record is dropped, never the snapshot', () => {
		const s = snap({
			secondmate_current: secondMates(
				[busyHome, { home: '/no/id' }, 'junk' as unknown as Record<string, unknown>],
				2
			)
		});
		expect(s.secondMates?.records.map((r) => r.id)).toEqual(['tokyo']);
		expect(s.secondMates?.truncated).toBe(2);
		const r = s.secondMates!.records[0];
		expect(r).toMatchObject({
			remote: true,
			host: 'tokyo-box',
			state: 'captain_decision',
			provenance: 'structured-home',
			summarySource: 'remote-ledger'
		});
		expect(r.active[0]).toMatchObject({ id: 'tk-api', repo: 'lumen', doing: 'review running' });
		expect(r.landed[0].prUrl).toBe('https://github.com/o/lumen/pull/7');
		expect(r.endpoints.map((e) => e.state)).toEqual(['working', 'parked', 'done']);
	});

	it('is null on a Firstmate without the section', () => {
		expect(snap({}).secondMates).toBeNull();
	});
});

describe('second mates', () => {
	it('are never tasks: their own rows and backlog rows stay out of the task list', () => {
		const s = snap({
			tasks: [taskRow({ id: 'a' }), mateRow('tokyo')],
			backlog: { present: true, records: [backlogRow('old-mate', 'done', { kind: 'secondmate' })] },
			secondmate_current: secondMates([busyHome])
		});
		expect(deriveTasks(s, ctx).tasks.map((t) => t.id)).toEqual(['a']);
		expect(deriveSecondMates(s).secondMates.map((m) => m.id)).toEqual(['tokyo']);
	});

	it('show their projects, work in flight with live status, queue, landed work and PRs', () => {
		const [m] = deriveSecondMates(
			snap({ secondmate_current: secondMates([busyHome]) })
		).secondMates;
		expect(m).toMatchObject({
			where: 'remote',
			host: 'tokyo-box',
			stateLabel: 'Needs your decision',
			tone: 'captain',
			projects: ['atlas', 'lumen'],
			decisions: 2,
			captainDecisions: 1
		});
		expect(m.inFlight.map((t) => [t.id, t.status, t.statusLabel])).toEqual([
			['tk-plan', 'needs-decision', 'Needs your decision'],
			['tk-api', 'with-firstmate', 'Waiting on its second mate'],
			['tk-docs', 'waiting', 'Waiting'],
			['tk-fin', 'done', 'Finished; with its second mate']
		]);
		expect(m.inFlight.find((t) => t.id === 'tk-api')).toMatchObject({
			title: 'Add the share API',
			projectId: 'lumen'
		});
		expect(m.queued.map((t) => [t.id, t.status, t.doing])).toEqual([
			['tk-next', 'queued', 'Waiting on tk-api.']
		]);
		expect(m.landed[0]).toMatchObject({
			id: 'tk-old',
			status: 'landed',
			doing: 'Merged on 2026-10-08.'
		});
		expect(m.prs).toEqual([
			{
				taskId: 'tk-old',
				title: 'Old work',
				url: 'https://github.com/o/lumen/pull/7',
				number: 7,
				landed: true
			}
		]);
		expect(m.omitted).toEqual(['3 more queued']);
	});

	it('count a hold Firstmate keeps on a second mate itself as waiting on the captain', () => {
		const quiet = mateRecord({ id: 'osaka', state: 'no_active_work' });
		const held = { kind: 'secondmate', captain_actionable: true, hold_reason: 'Retire it?' };
		const fromRow = deriveSecondMates(
			snap({
				tasks: [taskRow({ id: 'osaka', kind: 'secondmate', backlog: held })],
				secondmate_current: secondMates([quiet])
			})
		).secondMates[0];
		expect(fromRow).toMatchObject({ tone: 'captain', captainDecisions: 1 });
		const fromBacklog = deriveSecondMates(
			snap({
				backlog: { present: true, records: [backlogRow('osaka', 'in_flight', held)] },
				secondmate_current: secondMates([quiet])
			})
		).secondMates[0];
		expect(fromBacklog).toMatchObject({ tone: 'captain', captainDecisions: 1 });
		const free = deriveSecondMates(snap({ secondmate_current: secondMates([quiet]) }))
			.secondMates[0];
		expect(free).toMatchObject({ tone: 'quiet', captainDecisions: 0 });
	});

	it('say plainly what Firstmate does not report: host load and previews', () => {
		const [m] = deriveSecondMates(
			snap({ secondmate_current: secondMates([busyHome]) })
		).secondMates;
		expect(m.health.host).toEqual({ cpu: null, memory: null, disk: null });
		expect(m.health.hostNote).toBe(SECOND_MATE_GAPS.host);
		expect(m.previews).toEqual([]);
		expect(m.previewNote).toBe(SECOND_MATE_GAPS.previews);
	});

	it('read online, not refreshed (a cached copy), offline (a local terminal gone) or not readable', () => {
		const mates = deriveSecondMates(
			snap({
				tasks: [mateRow('here'), mateRow('gone', false)],
				secondmate_current: secondMates([
					mateRecord({ id: 'far', remote: true }),
					mateRecord({ id: 'stale', remote: true, source: 'remote-ledger-cache', ageSeconds: 720 }),
					mateRecord({
						id: 'lost',
						remote: true,
						source: null,
						reason: 'structured home ledger collection timed out'
					}),
					mateRecord({ id: 'here' }),
					mateRecord({ id: 'gone' }),
					mateRecord({ id: 'broken', source: null, reason: 'invalid home' })
				])
			})
		).secondMates;
		const by = Object.fromEntries(mates.map((m) => [m.id, m]));
		expect(by.far.health).toMatchObject({ online: 'online', cached: false });
		// A copy this read could not refresh is not a host that is down.
		expect(by.stale.health).toMatchObject({ online: 'unknown', cached: true });
		expect(by.stale.health.text).toMatch(/^Not refreshed: .*12 min ago/);
		expect(by.stale.tone).not.toBe('trouble');
		expect(by.lost.health).toMatchObject({
			online: 'unknown',
			reason: 'structured home ledger collection timed out'
		});
		expect(by.lost.tone).toBe('trouble');
		expect(by.here.health.online).toBe('online');
		expect(by.here.peek).toEqual({ available: true, reason: null });
		expect(by.gone.health.online).toBe('offline');
		expect(by.gone.peek.available).toBe(false);
		expect(by.broken.health).toMatchObject({ online: 'unknown', reason: 'invalid home' });
		expect(by.far.peek.available).toBe(true);
	});

	it('come from their rows alone on a Firstmate without secondmate_current', () => {
		const { secondMates: mates } = deriveSecondMates(snap({ tasks: [mateRow('old')] }));
		expect(mates.map((m) => [m.id, m.health.online, m.stateLabel])).toEqual([
			['old', 'unknown', 'State unknown']
		]);
		expect(mates[0].lastReport?.text).toBe('did a thing');
	});
});

describe('a second mate’s tasks beside the crew’s', () => {
	const [m] = deriveSecondMates(snap({ secondmate_current: secondMates([busyHome]) })).secondMates;
	const facts = (id: string) =>
		id === 'tk-api@tokyo'
			? {
					pr: 'https://github.com/o/lumen/pull/9',
					preview: { url: 'http://127.0.0.1:5173/', reportedAt: '2026-10-11T05:00:00Z' }
				}
			: null;
	const tasks = mateTaskSummaries(m, { facts, nowSeconds: 1_800_000_000 });
	const by = Object.fromEntries(tasks.map((t) => [t.id, t]));

	it('are ordinary tasks named <task>@<mate>, marked where they run', () => {
		expect(Object.keys(by)).toEqual([
			'tk-plan@tokyo',
			'tk-api@tokyo',
			'tk-docs@tokyo',
			'tk-fin@tokyo',
			'tk-next@tokyo',
			'tk-old@tokyo'
		]);
		for (const t of tasks) {
			expect(t.secondMate).toEqual({ id: 'tokyo', host: 'tokyo-box', where: 'remote' });
		}
	});

	it('carry their PR and preview from their status log once it is read, and their console', () => {
		expect(by['tk-api@tokyo']).toMatchObject({
			projectId: 'lumen',
			pr: { url: 'https://github.com/o/lumen/pull/9', number: 9 },
			preview: { url: 'http://127.0.0.1:5173/', reportedAt: '2026-10-11T05:00:00Z' },
			outputAvailable: true
		});
		expect(by['tk-old@tokyo']).toMatchObject({
			status: 'landed',
			pr: { url: 'https://github.com/o/lumen/pull/7', number: 7 },
			outputAvailable: false
		});
	});

	it('say whose move it is: a hold is the captain’s, a worker’s question its second mate’s', () => {
		expect(by['tk-plan@tokyo'].attention).toMatchObject({ kind: 'decision', owner: 'captain' });
		expect(by['tk-api@tokyo']).toMatchObject({
			status: 'with-firstmate',
			attention: { owner: 'firstmate' }
		});
		expect(by['tk-next@tokyo'].attention).toBeNull();
	});
});
