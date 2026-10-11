import { describe, expect, it } from 'vitest';
import { parseFleetSnapshot } from './contracts';
import { LedgerReader } from './ledger';
import { deriveTasks, parseProjectsRegistry, prNumber, type DeriveContext } from './model';
import {
	backlogRow,
	snapshotFixture,
	taskRow,
	type RowOptions
} from '../../../../tests/helpers/fake-firstmate';

const ctx = (o: Partial<DeriveContext> = {}): DeriveContext => ({
	registry: [],
	thumbs: new Map(),
	ledger: new Map(),
	nowSeconds: 1_791_700_000,
	...o
});
const derive = (
	rows: Record<string, unknown>[],
	records: Record<string, unknown>[] = [],
	c = ctx()
) =>
	deriveTasks(
		parseFleetSnapshot(
			JSON.stringify(snapshotFixture({ tasks: rows, backlog: { present: true, records } }))
		),
		c
	);
const one = (o: RowOptions, c = ctx()) => derive([taskRow(o)], [], c).tasks[0];

describe('task status', () => {
	it('working task: plain status, last event shown as history only', () => {
		const t = one({
			id: 'a',
			state: 'working',
			lastEvent: { state: 'done', note: 'all done', age_seconds: 600 }
		});
		expect(t.status).toBe('working');
		expect(t.summary).toBe('all done (10 min ago)');
		expect(t.summaryIsHistory).toBe(true);
	});

	it('captain hold needs your decision', () => {
		const t = one({ id: 'a', backlog: { captain_actionable: true, hold_reason: 'Pick A or B' } });
		expect(t.status).toBe('needs-decision');
		expect(t.attention).toEqual({
			kind: 'decision',
			owner: 'captain',
			text: 'Pick A or B',
			url: null
		});
	});

	it('finished ship work with a PR and yolo off needs your review', () => {
		const t = one({ id: 'a', state: 'done', pr: 'https://github.com/o/r/pull/214' });
		expect(t.status).toBe('needs-review');
		expect(t.attention?.owner).toBe('captain');
		expect(t.attention?.url).toBe('https://github.com/o/r/pull/214');
		expect(t.pr?.number).toBe(214);
	});

	it('yolo-on finished work does not need the captain', () => {
		const t = one({ id: 'a', state: 'done', yolo: 'on', pr: 'https://github.com/o/r/pull/9' });
		expect(t.status).toBe('done');
		expect(t.attention).toBeNull();
	});

	it('an open worker decision is waiting on Firstmate, not on the captain', () => {
		const t = one({
			id: 'a',
			state: 'parked',
			decisions: [{ key: 'k', verb: 'needs-decision', summary: 'which way?' }]
		});
		expect(t.status).toBe('with-firstmate');
		expect(t.statusLabel).toBe('Waiting on Firstmate');
		expect(t.attention?.owner).toBe('firstmate');
	});

	it('a gone endpoint is lost contact', () => {
		const t = one({ id: 'a', endpointExists: false });
		expect(t.status).toBe('lost');
		expect(t.outputAvailable).toBe(false);
		expect(t.outputNote).toMatch(/no longer exists/);
	});

	it('blocked and failed are trouble states', () => {
		expect(one({ id: 'a', state: 'blocked', detail: 'needs creds' }).statusLabel).toBe('Blocked');
		expect(one({ id: 'a', state: 'failed' }).status).toBe('failed');
	});

	it('flags a non-fresh crew-state observation', () => {
		expect(one({ id: 'a', freshness: 'cached' }).current?.fresh).toBe(false);
	});
});

describe('backlog-only tasks', () => {
	it('derives queued and landed tasks from the backlog', () => {
		const { tasks } = derive(
			[],
			[
				backlogRow('q', 'queued', { unresolved_blocker_ids: ['x'] }),
				backlogRow('d', 'done', { pr_url: 'https://g/pull/3' })
			]
		);
		expect(tasks.find((t) => t.id === 'q')).toMatchObject({
			status: 'queued',
			summary: 'Waiting on x.'
		});
		const d = tasks.find((t) => t.id === 'd')!;
		expect(d.status).toBe('landed');
		expect(d.completedOn).toBe('2026-10-10');
		expect(d.passage.steps[d.passage.current].key).toBe('landed');
	});

	it('does not duplicate a live task that also has a backlog row', () => {
		const { tasks } = derive([taskRow({ id: 'a' })], [backlogRow('a', 'in_flight')]);
		expect(tasks.filter((t) => t.id === 'a')).toHaveLength(1);
	});
});

describe('ledger facts', () => {
	it('adds worker model, exact merge time and reported previews', () => {
		const ledger = new LedgerReader('/nonexistent');
		ledger.ingest(
			JSON.stringify({
				v: 1,
				ts: 100,
				event: 'task.dispatched',
				task: 'd',
				kind: 'ship',
				project: 'wheelhouse',
				harness: 'codex',
				model: 'gpt-5'
			})
		);
		ledger.ingest(
			JSON.stringify({
				v: 1,
				ts: 150,
				event: 'task.status',
				task: 'd',
				state: 'note',
				key: null,
				text: ' preview http://127.0.0.1:5173/'
			})
		);
		ledger.ingest(
			JSON.stringify({
				v: 1,
				ts: 200,
				event: 'task.merged',
				task: 'd',
				via: 'pr',
				pr: 'https://g/pull/3'
			})
		);
		const { tasks } = derive([], [backlogRow('d', 'done')], ctx({ ledger: ledger.state().tasks }));
		expect(tasks[0].worker).toMatchObject({ harness: 'codex', model: 'gpt-5', modelKnown: true });
		expect(tasks[0].mergedAt).toBe(new Date(200_000).toISOString());
		expect(tasks[0].preview?.url).toBe('http://127.0.0.1:5173/');
	});
});

describe('projects', () => {
	it('groups by repo and reads descriptions from the registry', () => {
		const { projects } = derive(
			[taskRow({ id: 'a' })],
			[backlogRow('b', 'queued', { repo: 'docket' })],
			ctx({
				registry: parseProjectsRegistry('- wheelhouse [prod] - Local web UI (added 2026-10-10)\n')
			})
		);
		expect(projects.map((p) => p.id)).toEqual(['docket', 'wheelhouse']);
		expect(projects.find((p) => p.id === 'wheelhouse')?.description).toBe('Local web UI');
	});
});

it('prNumber reads GitHub PR URLs', () => {
	expect(prNumber('https://github.com/a/b/pull/36')).toBe(36);
	expect(prNumber('https://example.com/x')).toBeNull();
});
