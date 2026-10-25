import { describe, expect, it } from 'vitest';
import { awaitingReview, NO_PR, NO_PREVIEW, NO_SCREENSHOTS, reviewView } from './review';
import type { TaskSummary } from './types';

const NO_DECLARED = { custom: false, live: null, link: null, checks: [] };

const task = (o: Partial<TaskSummary> = {}): TaskSummary => ({
	id: 'a',
	title: 'a',
	shortTitle: 'a',
	projectId: 'p',
	kind: 'ship',
	track: 'ship',
	status: 'needs-review',
	statusLabel: 'Needs your review',
	summary: null,
	summaryIsHistory: false,
	summaryRaw: null,
	activity: null,
	busy: false,
	pipeline: null,
	filesChanged: null,
	worker: null,
	branch: null,
	passage: { track: 'ship', steps: [], current: 0, basis: '', ...NO_DECLARED },
	attention: { kind: 'review', owner: 'captain', text: 'Ready.', url: null },
	current: null,
	pr: null,
	since: null,
	completedOn: null,
	mergedAt: null,
	preview: null,
	blockedBy: [],
	hasReport: false,
	outputAvailable: false,
	outputNote: null,
	thumb: { kind: 'none' },
	screenshots: 0,
	shots: [],
	...o
});

describe('review panel', () => {
	it('says plainly when there are no screenshots, preview or PR', () => {
		const v = reviewView(task(), []);
		expect(v.shots).toEqual([]);
		expect(v.shotsText).toBe(NO_SCREENSHOTS);
		expect(v.shotsText).toBe('No screenshots saved');
		expect(v.preview).toBeNull();
		expect(v.previewText).toBe(NO_PREVIEW);
		expect(v.previewText).toBe('No live preview reported');
		expect(v.pr).toBeNull();
		expect(v.prText).toBe(NO_PR);
	});

	it('lists screenshots, the preview link and the PR link', () => {
		const shots = [
			{ name: 'screenshots/harbour.png', url: '/api/tasks/a/artifacts/screenshots/harbour.png' },
			{ name: 'screenshots/task.png', url: '/api/tasks/a/artifacts/screenshots/task.png' }
		];
		const v = reviewView(
			task({
				pr: { url: 'https://github.com/o/r/pull/3', number: 3 },
				preview: { url: 'http://127.0.0.1:4312/', reportedAt: '2026-10-11T00:00:00Z' }
			}),
			shots
		);
		expect(v.shots).toEqual(shots);
		expect(v.shotsText).toBe('2 screenshots');
		expect(v.preview).toEqual({ url: 'http://127.0.0.1:4312/' });
		expect(v.pr).toEqual({ url: 'https://github.com/o/r/pull/3', label: 'PR #3' });
	});

	it('uses the summary count on the Harbour card', () => {
		expect(reviewView(task({ screenshots: 1 })).shotsText).toBe('1 screenshot');
		expect(reviewView(task({ screenshots: 0 })).shotsText).toBe(NO_SCREENSHOTS);
	});

	it('is shown only while the work waits on the captain’s review', () => {
		expect(awaitingReview(task())).toBe(true);
		expect(awaitingReview(task({ attention: null, status: 'working' }))).toBe(false);
		expect(
			awaitingReview(
				task({ attention: { kind: 'decision', owner: 'captain', text: 'x', url: null } })
			)
		).toBe(false);
	});
});
