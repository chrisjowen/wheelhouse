import { describe, expect, it } from 'vitest';
import {
	applyReviewEvent,
	changeNote,
	readingOrder,
	spent,
	threadOf,
	usageLine,
	type Guide,
	type ReviewFile,
	type ReviewHunk,
	type ReviewRun,
	type ReviewView
} from './prreview';

const hunk = (
	id: string,
	path: string,
	boilerplate: ReviewHunk['boilerplate'] = null
): ReviewHunk => ({
	id,
	path,
	header: '@@ -1 +1 @@',
	lines: ['-a', '+b'],
	newStart: 1,
	additions: 1,
	deletions: 1,
	boilerplate,
	unseen: false
});
const files: ReviewFile[] = [
	{
		path: 'a.ts',
		oldPath: null,
		status: 'M',
		additions: 2,
		deletions: 2,
		boilerplate: null,
		hunks: [hunk('h1', 'a.ts'), hunk('h2', 'a.ts')]
	},
	{
		path: 'b.ts',
		oldPath: null,
		status: 'M',
		additions: 1,
		deletions: 1,
		boilerplate: null,
		hunks: [hunk('h3', 'b.ts')]
	},
	{
		path: 'yarn.lock',
		oldPath: null,
		status: 'M',
		additions: 1,
		deletions: 1,
		boilerplate: 'lockfile',
		hunks: [hunk('h4', 'yarn.lock', 'lockfile')]
	}
];
const item = (h: string, importance: 'key' | 'notable' | 'routine') => ({
	hunk: h,
	importance,
	kind: 'other' as const,
	title: h,
	what: '',
	why: null,
	basis: 'none' as const,
	sources: []
});
const guide: Guide = {
	runId: 'g',
	head: 'abc',
	at: '',
	summary: '',
	items: [item('h2', 'notable'), item('h3', 'key'), item('h1', 'routine'), item('h4', 'key')],
	unseen: [],
	records: [],
	usage: null,
	model: 'sonnet',
	effort: 'low'
};
const run = (id: string, o: Partial<ReviewRun> = {}): ReviewRun => ({
	id,
	kind: 'ask',
	hunk: null,
	question: 'q',
	status: 'running',
	text: '',
	error: null,
	startedAt: '',
	finishedAt: null,
	model: 'sonnet',
	effort: 'low',
	usage: null,
	...o
});

describe('readingOrder', () => {
	it('puts key, then notable hunks first, then the rest in file order, boilerplate last', () => {
		const o = readingOrder(files, guide);
		expect(o.start.map((h) => h.id)).toEqual(['h3', 'h2']);
		expect(o.rest.map((h) => h.id)).toEqual(['h1']);
		expect(o.boilerplate.map((h) => h.id)).toEqual(['h4']);
	});

	it('without a guide, shows everything in file order', () => {
		const o = readingOrder(files, null);
		expect(o.start).toEqual([]);
		expect(o.rest.map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
	});
});

describe('applyReviewEvent', () => {
	const view: ReviewView = {
		schema: 'wheelhouse-pr-review.v1',
		available: true,
		taskId: 't',
		pr: null,
		head: 'abc',
		base: 'main',
		source: '',
		files,
		truncated: false,
		guide: null,
		staleGuide: { head: 'old', at: '' },
		runs: [],
		config: {
			model: 'sonnet',
			effort: 'low',
			models: ['sonnet'],
			efforts: ['low'],
			unavailable: null
		}
	};

	it('adds runs, streams their text and finishes them', () => {
		let v = applyReviewEvent(view, { taskId: 't', head: 'abc', type: 'run', run: run('r1') });
		v = applyReviewEvent(v, { taskId: 't', head: 'abc', type: 'text', runId: 'r1', text: 'Hel' });
		expect(v.available && v.runs[0].text).toBe('Hel');
		// The start request's answer, landing late, does not wipe the streamed text.
		v = applyReviewEvent(v, { taskId: 't', head: 'abc', type: 'run', run: run('r1') });
		expect(v.available && v.runs[0].text).toBe('Hel');
		v = applyReviewEvent(v, {
			taskId: 't',
			head: 'abc',
			type: 'run',
			run: run('r1', { status: 'done', text: 'Hello' })
		});
		// …nor puts a finished run back to running.
		v = applyReviewEvent(v, { taskId: 't', head: 'abc', type: 'run', run: run('r1') });
		expect(v.available && v.runs[0]).toMatchObject({ status: 'done', text: 'Hello' });
	});

	it('takes a new guide and ignores other tasks and heads', () => {
		const v = applyReviewEvent(view, { taskId: 't', head: 'abc', type: 'guide', guide });
		expect(v.available && v.guide?.runId).toBe('g');
		expect(v.available && v.staleGuide).toBeNull();
		expect(applyReviewEvent(view, { taskId: 'x', head: 'abc', type: 'guide', guide })).toBe(view);
		expect(applyReviewEvent(view, { taskId: 't', head: 'zzz', type: 'guide', guide })).toBe(view);
	});
});

describe('notes', () => {
	it('show cost, tokens, model and time in one line', () => {
		expect(
			usageLine(
				{
					costUsd: 0.0123,
					inputTokens: 9000,
					cachedTokens: 3400,
					outputTokens: 640,
					durationMs: 14_200,
					model: 'claude-sonnet-5'
				},
				'low'
			)
		).toBe('$0.012 at list price · 12k tokens in, 640 out · claude-sonnet-5, low effort · 14 s');
		expect(
			usageLine(
				{
					costUsd: 0.004,
					inputTokens: 900,
					cachedTokens: 0,
					outputTokens: 10,
					durationMs: 300,
					model: 'haiku'
				},
				'low'
			)
		).toBe('under 1¢ at list price · 900 tokens in, 10 out · haiku, low effort · 1 s');
	});

	it('add up what the agent spent', () => {
		const u = {
			costUsd: 0.01,
			inputTokens: 1,
			cachedTokens: 0,
			outputTokens: 1,
			durationMs: 1,
			model: 'm'
		};
		expect(spent([run('a', { usage: u }), run('b', { usage: u }), run('c')])).toEqual({
			usd: 0.02,
			runs: 2
		});
	});

	it('word a change request for Firstmate', () => {
		expect(
			changeNote(
				{ url: 'https://github.com/x/y/pull/3' },
				{ path: 'a.ts', newStart: 12 },
				' Rename it. '
			)
		).toBe(
			'Change requested from the PR review (https://github.com/x/y/pull/3) at a.ts, line 12:\nRename it.'
		);
		expect(changeNote(null, null, 'Split it up.')).toBe(
			'Change requested from the PR review:\nSplit it up.'
		);
	});

	it('thread a hunk’s questions and reviews, not the guide', () => {
		const runs = [
			run('g', { kind: 'guide' }),
			run('a', { hunk: 'h1' }),
			run('b', { kind: 'review' })
		];
		expect(threadOf(runs, 'h1').map((r) => r.id)).toEqual(['a']);
		expect(threadOf(runs, null).map((r) => r.id)).toEqual(['b']);
	});
});
