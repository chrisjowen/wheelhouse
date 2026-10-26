import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import RadarBoard from './RadarBoard.svelte';
import type { PassageStep, Project, TaskStatus, TaskSummary } from '$lib/types';

const SHIP = ['queued', 'building', 'checks', 'pr', 'review', 'landed'].map((key): PassageStep => ({
	key,
	label: key[0].toUpperCase() + key.slice(1),
	short: key,
	state: 'upcoming',
	note: null,
	column: key,
	evidence: [],
	failed: false
}));

const NOW = Date.parse('2026-10-27T12:00:00Z');

function task(id: string, status: TaskStatus, at: string, o: Partial<TaskSummary> = {}) {
	return {
		id,
		title: `Tidewatch: ${id}`,
		shortTitle: id,
		projectId: 'tidewatch',
		kind: 'ship',
		track: 'ship',
		status,
		statusLabel: status,
		summary: null,
		summaryIsHistory: false,
		summaryRaw: null,
		activity: null,
		busy: false,
		pipeline: null,
		filesChanged: null,
		worker: null,
		branch: null,
		passage: {
			track: 'ship',
			steps: SHIP,
			current: SHIP.findIndex((s) => s.key === at),
			basis: '',
			custom: false,
			live: null,
			link: null,
			checks: []
		},
		attention: null,
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
	} satisfies TaskSummary;
}

const projects: Project[] = [
	{
		id: 'tidewatch',
		name: 'Tidewatch',
		description: null,
		posture: null,
		registered: true,
		path: null,
		passage: null
	}
];

const tasks = [
	task('surge-alerts', 'working', 'building', {
		busy: true,
		since: '2026-10-27',
		activity: {
			text: 'Writing the alert rules',
			at: new Date(NOW - 12 * 60_000).toISOString(),
			source: 'status'
		}
	}),
	task('gauges', 'blocked', 'checks'),
	task('units', 'needs-review', 'review', {
		attention: {
			kind: 'review',
			owner: 'captain',
			text: 'Pull request #12 is ready for your review.',
			url: null
		}
	}),
	task('cache', 'landed', 'landed', { mergedAt: new Date(NOW - 5 * 60_000).toISOString() })
];

beforeEach(() => {
	document.body.innerHTML = '';
});

const lane = (name: string) => document.querySelector<HTMLElement>(`li[aria-label^="${name},"]`)!;

describe('the fleet radar', () => {
	it('draws a dot per task in its lane, saying what each is waiting on', () => {
		const app = mount(RadarBoard, { target: document.body, props: { tasks, projects, now: NOW } });
		flushSync();
		expect(lane('Building').getAttribute('aria-label')).toBe('Building, 1');
		expect(lane('Testing').querySelector('[data-blip="gauges"]')).not.toBeNull();
		expect(lane('Pull request').querySelector('[data-blip="units"]')).not.toBeNull();
		expect(lane('Landed').querySelector('[data-blip="cache"]')).not.toBeNull();
		expect(document.querySelector('[data-blip="surge-alerts"]')!.getAttribute('aria-label')).toBe(
			'surge-alerts: Building, busy, 12 h in the lane'
		);
		expect(document.querySelector('[data-blip="units"]')!.getAttribute('aria-label')).toContain(
			'waiting on you'
		);
		expect(document.body.textContent).toContain('1 busy, 1 waiting on you, 1 stuck, 1 landed');
		unmount(app);
	});

	it('opens a card for the dot in focus, linking to the task, and Escape closes it', () => {
		const app = mount(RadarBoard, { target: document.body, props: { tasks, projects, now: NOW } });
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-blip="surge-alerts"]')!.focus();
		flushSync();
		const card = document.querySelector<HTMLElement>('[data-radar-card]')!;
		expect(card.textContent).toContain('Tidewatch');
		expect(card.textContent).toContain('Building');
		expect(card.textContent).toContain('In lane');
		expect(card.textContent).toContain('12 h');
		expect(card.textContent).toContain('Writing the alert rules');
		expect(card.querySelector('a')!.getAttribute('href')).toBe('/tasks/surge-alerts');

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(document.querySelector('[data-radar-card]')).toBeNull();
		unmount(app);
	});

	it('pins a tapped dot until it is tapped again', () => {
		const app = mount(RadarBoard, { target: document.body, props: { tasks, projects, now: NOW } });
		flushSync();
		const dot = document.querySelector<HTMLButtonElement>('[data-blip="units"]')!;
		dot.click();
		flushSync();
		expect(document.querySelector('[data-radar-card]')!.textContent).toContain(
			'Pull request #12 is ready for your review.'
		);
		dot.click();
		flushSync();
		expect(document.querySelector('[data-radar-card]')).toBeNull();
		unmount(app);
	});
});
