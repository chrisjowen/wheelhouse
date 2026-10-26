import { describe, expect, it } from 'vitest';
import { alertsFor, digest, QUIET_AFTER_MS, stillHolds } from './bell';
import type { ShipAlert } from './types';
import { fleetOf, prGreen, question, taskSummary } from '../../tests/helpers/task-summary';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const one = (...args: Parameters<typeof alertsFor>) => {
	const list = alertsFor(...args);
	expect(list).toHaveLength(1);
	return list[0];
};

describe('alertsFor', () => {
	it('rings for a green PR, with Merge as a captain note and links to the PR and task', () => {
		const a = one(prGreen('share-links'), NOW);
		expect(a).toMatchObject({
			id: 'pr-green:share-links:https://github.com/example/lumen/pull/42',
			kind: 'pr-green',
			captain: true,
			text: 'Pull request #42 is green and ready to merge.'
		});
		const [merge, pr, task] = a.actions;
		expect(merge).toMatchObject({ kind: 'note', label: 'Merge' });
		if (merge.kind !== 'note') throw new Error('expected a note');
		expect(merge.text).toContain('https://github.com/example/lumen/pull/42');
		// A stable request id that the messages API accepts, so the merge is asked once.
		expect(merge.requestId).toMatch(/^wh-bell-merge-[0-9a-f]{16}$/);
		expect(alertsFor(prGreen('share-links'), NOW + 1000)[0].actions[0]).toEqual(merge);
		expect(pr).toEqual({
			kind: 'open',
			label: 'Open PR',
			href: 'https://github.com/example/lumen/pull/42',
			external: true
		});
		expect(task).toMatchObject({ href: '/tasks/share-links', external: false });
	});

	it('rings for a question waiting on the captain, and again for a new question', () => {
		const a = one(question('upload'), NOW);
		expect(a).toMatchObject({ kind: 'question', captain: true });
		expect(a.text).toBe('Ship the share links behind a flag, or to everyone?');
		expect(a.actions.map((x) => x.label)).toEqual(['Open decision', 'Answer in chat']);
		expect(a.actions[1]).toMatchObject({ href: '/?chat=upload' });
		expect(one(question('upload', 'Another question?'), NOW).id).not.toBe(a.id);
	});

	it('does not ring for a decision Firstmate is handling', () => {
		const t = taskSummary('w', 'with-firstmate', {
			attention: { kind: 'decision', owner: 'firstmate', text: 'which?', url: null }
		});
		expect(alertsFor(t, NOW)).toEqual([]);
	});

	it('rings for blocked, failed and lost workers, once per status and reason', () => {
		const blocked = one(
			taskSummary('a', 'blocked', { statusLabel: 'Blocked', summary: 'Needs a token' }),
			NOW
		);
		expect(blocked).toMatchObject({
			kind: 'stuck',
			captain: false,
			text: 'Blocked: Needs a token'
		});
		const failed = one(taskSummary('a', 'failed', { statusLabel: 'Failed', summary: 'x' }), NOW);
		const lost = one(taskSummary('a', 'lost', { statusLabel: 'Lost contact' }), NOW);
		expect(new Set([blocked.id, failed.id, lost.id]).size).toBe(3);
		const again = one(
			taskSummary('a', 'blocked', { statusLabel: 'Blocked', summary: 'Needs a token' }),
			NOW + 60_000
		);
		expect(again.id).toBe(blocked.id);
	});

	it('rings when a working task has gone quiet, but not while it is busy or validating', () => {
		const at = new Date(NOW - QUIET_AFTER_MS - 60_000).toISOString();
		const quiet = taskSummary('q', 'working', { activity: { text: 'x', at, source: 'status' } });
		expect(one(quiet, NOW)).toMatchObject({ kind: 'stuck', id: `stuck:q:quiet:${at}` });
		expect(one(quiet, NOW).text).toBe('Gone quiet: no word for 21 minutes while working.');
		expect(alertsFor({ ...quiet, busy: true }, NOW)).toEqual([]);
		const recent = new Date(NOW - 60_000).toISOString();
		expect(
			alertsFor({ ...quiet, activity: { text: 'x', at: recent, source: 'status' } }, NOW)
		).toEqual([]);
		const validating = {
			...quiet,
			pipeline: { outcome: 'running' } as NonNullable<typeof quiet.pipeline>
		};
		expect(alertsFor(validating, NOW)).toEqual([]);
	});

	it('rings when a merge lands', () => {
		const t = taskSummary('m', 'landed', {
			pr: { url: 'https://github.com/example/lumen/pull/7', number: 7 }
		});
		const a = one(t, NOW);
		expect(a).toMatchObject({
			id: 'landed:m',
			kind: 'landed',
			text: 'Pull request #7 was merged.'
		});
		expect(a.actions.map((x) => x.label)).toEqual(['Open task', 'View PR']);
	});

	it('stays quiet for ordinary work', () => {
		for (const s of ['working', 'waiting', 'queued', 'done', 'unknown'] as const) {
			expect(alertsFor(taskSummary('x', s), NOW)).toEqual([]);
		}
	});

	it('cuts a long question', () => {
		const a = one(question('long', 'word '.repeat(100)), NOW);
		expect(a.text.length).toBeLessThanOrEqual(220);
		expect(a.text.endsWith('…')).toBe(true);
	});
});

describe('stillHolds', () => {
	const alert = (t: ReturnType<typeof prGreen>): ShipAlert => ({
		...alertsFor(t, NOW)[0],
		at: '2026-10-27T10:00:00Z'
	});

	it('holds a captain alert while its moment lasts, and drops it once it has passed', () => {
		const a = alert(prGreen('p'));
		expect(stillHolds(a, fleetOf([prGreen('p')]))).toBe(true);
		expect(stillHolds(a, fleetOf([taskSummary('p', 'landed')]))).toBe(false);
		expect(stillHolds(a, fleetOf([]))).toBe(false);
		const q = alert(question('q'));
		expect(stillHolds(q, fleetOf([question('q', 'A different question')]))).toBe(false);
	});

	it('leaves a session question to the server’s word', () => {
		const q: ShipAlert = { ...alert(question('q')), taskId: null, projectId: null };
		expect(stillHolds(q, fleetOf([]))).toBe(true);
	});

	it('drops nothing before the fleet is read, and always holds news', () => {
		const a = alert(prGreen('p'));
		expect(stillHolds(a, null)).toBe(true);
		expect(stillHolds(a, { ...fleetOf([]), collectedAt: null })).toBe(true);
		const news = alert(taskSummary('m', 'landed'));
		expect(stillHolds(news, fleetOf([]))).toBe(true);
	});
});

describe('digest', () => {
	it('is stable and short', () => {
		expect(digest('abc')).toBe(digest('abc'));
		expect(digest('abc')).not.toBe(digest('abd'));
		expect(digest('')).toMatch(/^[0-9a-f]{16}$/);
	});
});
