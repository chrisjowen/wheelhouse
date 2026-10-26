import { describe, expect, it } from 'vitest';
import { parseFleetSnapshot } from './contracts';
import { LedgerReader } from './ledger';
import { ciChecksFromLog } from './evidence';
import {
	addressingReview,
	deriveTasks,
	parseProjectsRegistry,
	prNumber,
	type DeriveContext,
	type ReviewSignals
} from './model';
import { harbour } from '../../harbour';
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
		expect(t.summary).toBe('All done (10 min ago)');
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

	it('finished work whose PR has merged has landed, not waiting for review', () => {
		const pr = 'https://github.com/o/r/pull/214';
		const ledger = new LedgerReader('/nonexistent');
		ledger.ingest(
			JSON.stringify({ v: 1, ts: 200, event: 'task.merged', task: 'a', via: 'pr', pr })
		);
		const merged = one({ id: 'a', state: 'done', pr }, ctx({ ledger: ledger.state().tasks }));
		expect(merged.status).toBe('landed');
		expect(merged.attention).toBeNull();
		expect(merged.passage.steps[merged.passage.current].key).toBe('landed');

		const done = one({
			id: 'b',
			state: 'done',
			pr,
			backlog: { state: 'done', completion: { verb: 'merged', date: '2026-10-10' } }
		});
		expect(done.status).toBe('landed');
		expect(done.attention).toBeNull();
		expect(done.completedOn).toBe('2026-10-10');
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

describe('a green PR awaiting the captain’s merge', () => {
	const pr = 'https://github.com/o/r/pull/2';
	const RUN = '01M4N30B7JVFV5989ZS2QEVZ7Q';
	const review = (o: Partial<ReviewSignals> = {}) =>
		new Map<string, ReviewSignals>([
			['a', { screenshots: 3, ciChecks: 'unknown', prDraft: false, prState: null, ...o }]
		]);
	const history = (...lines: [string, string][]) => {
		const ledger = new LedgerReader('/nonexistent');
		lines.forEach(([state, text], i) =>
			ledger.ingest(
				JSON.stringify({
					v: 1,
					ts: 100 + i,
					event: 'task.status',
					task: 'a',
					state,
					key: null,
					text
				})
			)
		);
		return ledger.state().tasks;
	};
	const monitor = { state: 'working', source: 'run-step', detail: `ci running · run: ${RUN}` };
	const expectReview = (t: ReturnType<typeof one>) => {
		expect(t.status).toBe('needs-review');
		expect(t.statusLabel).toBe('Needs your review');
		expect(t.attention).toMatchObject({ kind: 'review', owner: 'captain', url: pr });
		expect(t.passage.steps[t.passage.current].key).toBe('review');
		expect(harbour([t], 0).needsYou).toEqual([t]);
	};

	it('a PR the captain reviewed after it was reported ready is being addressed, not awaited', () => {
		const t = one(
			{ id: 'a', pr, ...monitor },
			ctx({ review: review({ ciChecks: 'green', addressing: true }) })
		);
		expect(t.status).toBe('working');
		expect(t.statusLabel).toBe('Addressing your review');
		expect(t.addressingReview).toBe(true);
		expect(t.attention).toBeNull();
		expect(harbour([t], 0).needsYou).toEqual([]);
		expect(harbour([t], 0).underWay).toEqual([t]);
		expect(t.passage.steps[t.passage.current].key).not.toBe('review');
	});

	it('a CI monitor run whose log reads green needs your review', () => {
		const t = one({ id: 'a', pr, ...monitor }, ctx({ review: review({ ciChecks: 'green' }) }));
		expectReview(t);
		expect(t.screenshots).toBe(3);
	});

	it('a monitor run crew state reads as "validating (running)" needs review once its CI log is green', () => {
		// Firstmate does not recognise the no_ci marker, so the CI monitor phase reads as validating.
		const validating = {
			state: 'working',
			source: 'run-step',
			detail: `validating (running) · run: ${RUN}`
		};
		expectReview(
			one({ id: 'a', pr, ...validating }, ctx({ review: review({ ciChecks: 'green' }) }))
		);
		// Without a green CI log, a run at another step is still validating, whatever history says.
		const t = one(
			{ id: 'a', pr, ...validating },
			ctx({ review: review(), ledger: history(['done', ` PR ${pr} checks green`]) })
		);
		expect(t.status).toBe('working');
	});

	it('the no_ci case: the monitor log treats a repo without CI as green', () => {
		expect(
			ciChecksFromLog(
				'repository declares no CI (no_ci: true) - treating as all checks passed - still monitoring until merged or closed\n\nbase branch advanced (a..b), re-arming CI monitor timeout\n'
			)
		).toBe('green');
		expectReview(one({ id: 'a', pr, ...monitor }, ctx({ review: review({ ciChecks: 'green' }) })));
	});

	it('a monitor run with a "PR … checks green" report needs review without a readable log', () => {
		const t = one(
			{ id: 'a', pr, ...monitor },
			ctx({ review: review(), ledger: history(['done', ` PR ${pr} checks green`]) })
		);
		expectReview(t);
	});

	it('done "checks green" followed by a paused wait for the merge needs your review', () => {
		const t = one(
			{ id: 'a', pr, state: 'paused', source: 'status-log', detail: 'waiting for merge' },
			ctx({
				ledger: history(
					['done', ` PR ${pr} checks green`],
					['note', ' preview http://127.0.0.1:4311/'],
					['paused', ` waiting for the captain's merge of PR ${pr}`]
				)
			})
		);
		expectReview(t);
		expect(t.preview?.url).toBe('http://127.0.0.1:4311/');
	});

	it('stays working while CI is red or running, or the worker went back to work', () => {
		const red = one(
			{ id: 'a', pr, ...monitor },
			ctx({ review: review({ ciChecks: 'not-ready' }) })
		);
		expect(red.status).toBe('working');
		expect(red.passage.steps[red.passage.current].key).toBe('pr');
		const revalidating = one(
			{ id: 'a', pr, state: 'working', source: 'run-step', detail: 'validating (fixing)' },
			ctx({ ledger: history(['done', ` PR ${pr} checks green`]) })
		);
		expect(revalidating.status).toBe('working');
		const reworking = one(
			{ id: 'a', pr, state: 'paused', source: 'status-log' },
			ctx({
				ledger: history(
					['done', ` PR ${pr} checks green`],
					['working', ' fixing review comments'],
					['paused', ' waiting on drive call']
				)
			})
		);
		expect(reworking.status).toBe('waiting');
		expect(one({ id: 'a', pr, ...monitor }).status).toBe('working');
	});

	it('a draft PR does not need your review', () => {
		const t = one({ id: 'a', pr, state: 'done' }, ctx({ review: review({ prDraft: true }) }));
		expect(t.status).toBe('done');
		expect(t.passage.steps[t.passage.current].key).toBe('pr');
		const monitored = one(
			{ id: 'a', pr, ...monitor },
			ctx({ review: review({ prDraft: true, ciChecks: 'green' }) })
		);
		expect(monitored.status).toBe('working');
	});

	it('a closed or merged PR does not need your review; an open one does', () => {
		for (const prState of ['CLOSED', 'merged']) {
			expect(one({ id: 'a', pr, state: 'done' }, ctx({ review: review({ prState }) })).status).toBe(
				'done'
			);
			expect(
				one({ id: 'a', pr, ...monitor }, ctx({ review: review({ prState, ciChecks: 'green' }) }))
					.status
			).toBe('working');
		}
		expectReview(one({ id: 'a', pr, state: 'done' }, ctx({ review: review({ prState: 'OPEN' }) })));
		expectReview(
			one(
				{ id: 'a', pr, ...monitor },
				ctx({ review: review({ prState: 'open', ciChecks: 'green' }) })
			)
		);
	});

	it('yolo on: Firstmate merges a green PR itself', () => {
		const t = one(
			{ id: 'a', pr, yolo: 'on', ...monitor },
			ctx({ review: review({ ciChecks: 'green' }) })
		);
		expect(t.status).toBe('working');
		expect(t.attention).toBeNull();
		expect(t.passage.steps[t.passage.current].key).toBe('pr');
		expect(harbour([t], 0).needsYou).toEqual([]);
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

	it('treats an empty completion verb as done', () => {
		const { tasks } = derive(
			[],
			[backlogRow('x', 'done', { completion: { verb: '', date: '2026-10-10' } })]
		);
		expect(tasks[0].summary).toBe('Done on 2026-10-10.');
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

describe('what the card says', () => {
	const RUN = '01M4NJ6EHNE0QZP9W6AWCZE7ET';
	const ASK = `ask-user findings=task-section-pin-after-step,example-plugin-enabled-by-default file=/Users/me/Dev/spikes /firstmate/data/wh-plugins/nm-${RUN}-findings.txt`;

	it('a short title without the project prefix, keeping the full title', () => {
		const t = one({ id: 'a', backlog: { title: 'wheelhouse: task-focused Bridge' } });
		expect(t.title).toBe('wheelhouse: task-focused Bridge');
		expect(t.shortTitle).toBe('Task-focused Bridge');
	});

	it('the worker’s window name from its endpoint target', () => {
		expect(one({ id: 'wh-plugins' }).worker?.name).toBe('fm-wh-plugins');
	});

	it('a decision raised to Firstmate in plain words, never the raw line', () => {
		const t = one({
			id: 'a',
			decisions: [{ key: `nm-${RUN}-review`, verb: 'needs-decision', summary: ASK }],
			lastEvent: { state: 'needs-decision', note: ASK, age_seconds: 60 }
		});
		expect(t.status).toBe('with-firstmate');
		expect(t.attention?.text).toBe('Review raised 2 questions; Firstmate is deciding');
		expect(t.summary).toBe('Review raised 2 questions; Firstmate is deciding');
		expect(t.summaryRaw).toBe(ASK);
		expect(t.activity).toEqual({
			text: 'Review raised 2 questions; Firstmate is deciding',
			at: new Date((1_791_700_000 - 60) * 1000).toISOString(),
			source: 'status'
		});
	});

	it('Now: the latest status line in plain words, with its time', () => {
		const t = one({
			id: 'a',
			lastEvent: {
				state: 'working',
				note: 'setup done on fm/a; implementing sessions feature',
				age_seconds: 600
			}
		});
		expect(t.busy).toBe(true);
		expect(t.summary).toBe('Implementing sessions feature (10 min ago)');
		expect(t.activity).toMatchObject({ text: 'Implementing sessions feature', source: 'status' });
	});

	it('Now: the validation step while a run works, else what crew state reads from it', () => {
		const pipeline = {
			step: 'test',
			label: 'Tests',
			startedAt: '2026-10-11T05:00:00Z',
			round: null,
			steps: [],
			outcome: 'running' as const,
			gate: null,
			answered: false,
			roundStartedAt: null,
			ci: null,
			observedAt: null
		};
		const running = one(
			{ id: 'a', source: 'run-step', detail: `validating (running) · run: ${RUN}` },
			ctx({ live: new Map([['a', { pipeline, filesChanged: 4 }]]) })
		);
		expect(running.activity).toEqual({
			text: 'Validating: tests step',
			at: '2026-10-11T05:00:00Z',
			source: 'pipeline'
		});
		expect(running.pipeline).toEqual(pipeline);
		expect(running.filesChanged).toBe(4);
		const parked = one({
			id: 'b',
			state: 'parked',
			source: 'run-step',
			detail: `parked at review: 3 finding(s) · run: ${RUN}`
		});
		expect(parked.busy).toBe(false);
		expect(parked.summary).toBe('Review found 3 issues; waiting on a decision');
		expect(parked.activity).toMatchObject({
			text: 'Review found 3 issues; waiting on a decision',
			source: 'state'
		});
	});

	it('not busy when the crew-state read is stale', () => {
		expect(one({ id: 'a', freshness: 'stale' }).busy).toBe(false);
	});

	it('Now: lost contact says so, without the raw detail', () => {
		const t = one({ id: 'a', endpointExists: false });
		expect(t.activity?.text).toMatch(/terminal is gone/);
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
		expect(projects.find((p) => p.id === 'wheelhouse')?.posture).toBe('prod');
		expect(projects.find((p) => p.id === 'docket')?.registered).toBe(false);
	});

	it('lists every registered project, with or without tasks', () => {
		const { projects } = derive(
			[],
			[backlogRow('b', 'queued', { repo: 'docket' })],
			ctx({
				registry: parseProjectsRegistry(
					'- docket - Team memory\n- casebook [no-mistakes-prod-only +yolo] - Cases (added 2026-10-25)\n'
				)
			})
		);
		expect(projects.map((p) => p.id)).toEqual(['casebook', 'docket']);
		const casebook = projects.find((p) => p.id === 'casebook')!;
		expect(casebook).toMatchObject({
			description: 'Cases',
			posture: 'no-mistakes-prod-only +yolo',
			registered: true
		});
		expect(projects.find((p) => p.id === 'docket')?.posture).toBeNull();
	});
});

it('prNumber reads GitHub PR URLs', () => {
	expect(prNumber('https://github.com/a/b/pull/36')).toBe(36);
	expect(prNumber('https://example.com/x')).toBeNull();
});

describe('addressingReview', () => {
	const READY = 1000;
	const head = (sha: string, at: number | null) => ({ sha, at });
	const changes = (at: number, commitId = 'h1') => ({ state: 'CHANGES_REQUESTED', at, commitId });

	it('is false without a ready report or without feedback', () => {
		expect(
			addressingReview(null, { head: head('h1', 900), reviews: [changes(1100)], comments: [] })
		).toBe(false);
		expect(addressingReview(READY, null)).toBe(false);
		expect(addressingReview(READY, { head: head('h1', 900), reviews: [], comments: [] })).toBe(
			false
		);
	});

	it('is true after a changes-requested or commented review, or a review comment, following the ready report', () => {
		expect(
			addressingReview(READY, { head: head('h1', 900), reviews: [changes(1100)], comments: [] })
		).toBe(true);
		expect(
			addressingReview(READY, {
				head: head('h1', 900),
				reviews: [{ state: 'COMMENTED', at: 1100, commitId: 'h1' }],
				comments: []
			})
		).toBe(true);
		expect(
			addressingReview(READY, {
				head: head('h1', 900),
				reviews: [],
				comments: [{ at: 1200, commitId: 'h1' }]
			})
		).toBe(true);
	});

	it('is true when new commits landed after the ready report', () => {
		expect(addressingReview(READY, { head: head('h2', 1050), reviews: [], comments: [] })).toBe(
			true
		);
	});

	it('ignores approvals and dismissed reviews', () => {
		const f = {
			head: head('h1', 900),
			reviews: [
				{ state: 'APPROVED', at: 1100, commitId: 'h1' },
				{ state: 'DISMISSED', at: 1200, commitId: 'h1' }
			],
			comments: []
		};
		expect(addressingReview(READY, f)).toBe(false);
	});

	it('clears only with a newer ready report for a newer head', () => {
		// The review was on h1; the worker pushed h2 and reported ready again at 1300.
		expect(
			addressingReview(1300, {
				head: head('h2', 1250),
				reviews: [changes(1100, 'h1')],
				comments: []
			})
		).toBe(false);
		// A newer ready report without a new head does not clear it.
		expect(
			addressingReview(1300, {
				head: head('h1', 900),
				reviews: [changes(1100, 'h1')],
				comments: []
			})
		).toBe(true);
		// Nor does a new head without a newer ready report.
		expect(
			addressingReview(READY, {
				head: head('h2', 1250),
				reviews: [changes(1100, 'h1')],
				comments: []
			})
		).toBe(true);
	});
});
