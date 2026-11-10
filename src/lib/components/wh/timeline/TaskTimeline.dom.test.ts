import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskSummary } from '../../../../../tests/helpers/task-summary';
import type { PassageStep, TaskDetail } from '$lib/types';
import type { TalkEntry } from '$lib/buildlog';
import TaskTimeline from './TaskTimeline.svelte';
import ChecksSection from './ChecksSection.svelte';

const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 12, m)).toISOString();
const step = (key: string, label: string, state: PassageStep['state']): PassageStep => ({
	key,
	label,
	short: label,
	state,
	note: null,
	column: key,
	evidence: key === 'building' ? ['files'] : key === 'checks' ? ['validation'] : [],
	failed: false
});
const NONE = { available: false as const, reason: 'Not read.' };
const seen = <T>(value: T) => ({ available: true as const, value, source: 's', observedAt: null });

const task = taskSummary('search', 'working', {
	statusLabel: 'In checks',
	passage: {
		track: 'ship',
		steps: [
			step('queued', 'Queued', 'done'),
			step('building', 'Building', 'done'),
			step('checks', 'Checks', 'current'),
			step('pr', 'Pull request', 'upcoming'),
			step('landed', 'Landed', 'upcoming')
		],
		current: 2,
		basis: '',
		custom: false,
		live: null,
		link: null,
		checks: []
	}
});

const steer: TalkEntry = {
	id: 'inbox-001',
	at: at(10),
	kind: 'steer',
	from: 'firstmate',
	to: 'worker',
	title: 'Keep the old route working.',
	body: null,
	questions: [],
	reply: null,
	outcome: { state: 'read', label: 'The worker has read it' }
};

const detail = {
	task,
	evidence: {
		files: NONE,
		pr: NONE,
		report: NONE,
		screenshots: NONE,
		preview: NONE,
		decisions: [],
		validation: NONE
	},
	brief: seen({
		path: 'data/search/brief.md',
		intent: 'let people search the docs',
		spec: '- Index the docs.',
		rest: '# Rules\nNever push to main.',
		bytes: 2048,
		truncated: false,
		mate: null,
		remote: false
	}),
	timeline: seen([
		{ at: at(0), kind: 'dispatched', state: null, text: 'Dispatched' },
		{ at: at(5), kind: 'status', state: 'working', text: 'setup done, reading the index' }
	]),
	gaps: [],
	time: null,
	decided: [],
	build: {
		conversation: seen([steer]),
		checks: seen({
			startedAt: at(20),
			outcome: 'failed',
			runs: 1,
			testingNote: null,
			steps: [
				{
					key: 'test',
					label: 'Tests',
					state: 'failed',
					summary: '1 failed',
					durationMs: 61_000,
					notes: [],
					tests: {
						passed: 9,
						failed: 1,
						skipped: null,
						failures: [{ name: 'search.test.ts › finds a page', output: 'expected 1 to be 2' }],
						scenarios: [],
						basis: 'the test step’s log'
					},
					docs: null
				}
			]
		}),
		docs: NONE
	},
	validations: [{ id: 'r1', startedAt: at(20), outcome: 'failed', text: 'Tests failed' }]
} as unknown as TaskDetail;

let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const evidence = createRawSnippet((s: () => PassageStep) => ({
	render: () => `<p data-evidence="${s().key}"></p>`
}));

function render(strand: 'all' | 'talk' = 'all') {
	app = mount(TaskTimeline, {
		target: document.body,
		props: {
			task,
			detail,
			shots: [],
			strand,
			evidence,
			onshot: () => {},
			onpreview: () => {}
		}
	});
	flushSync();
}
const stages = () =>
	[...document.querySelectorAll<HTMLElement>('[data-stage]')].map((e) => e.dataset.stage);

describe('the task timeline', () => {
	it('starts with the instructions, then the stages reached, then what is still to come', () => {
		render();
		expect(stages()).toEqual(['brief', 'queued', 'building', 'checks', 'upcoming']);
		const brief = document.querySelector('[data-brief]')!;
		expect(brief.querySelector('blockquote')?.textContent).toContain('let people search the docs');
		expect(brief.textContent).toContain('Index the docs.');
		// The rest of the brief starts folded; its file opens in the reader.
		expect(brief.textContent).not.toContain('Never push to main.');
		expect(brief.querySelector('a')?.getAttribute('href')).toBe(
			`/files?path=${encodeURIComponent('data/search/brief.md')}`
		);
		expect(document.querySelector('[data-stage="upcoming"]')?.textContent).toContain(
			'Pull request · Landed'
		);
	});

	it('puts each entry under its stage, with that stage’s evidence after them', () => {
		render();
		const building = document.querySelector('[data-stage="building"]')!;
		expect(building.textContent).toContain('Firstmate started the worker');
		expect(building.textContent).toContain('Set up and started work');
		expect(building.querySelector('[data-talk="steer"]')?.textContent).toContain(
			'Keep the old route working.'
		);
		expect(building.querySelector('[data-evidence="building"]')).not.toBeNull();
		expect(document.querySelector('[data-stage="checks"]')!.textContent).toContain(
			'Validation run started'
		);
	});

	it('shows one strand of the story when filtered, and folds a stage to a line', () => {
		render('talk');
		const building = document.querySelector('[data-stage="building"]')!;
		expect(building.querySelector('[data-talk="steer"]')).not.toBeNull();
		expect(building.querySelector('[data-entry="status"]')).toBeNull();
		expect(building.querySelector('[data-evidence]')).toBeNull();
		building.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
		flushSync();
		expect(building.querySelector('[data-talk]')).toBeNull();
		expect(building.getAttribute('data-open')).toBe('false');
	});
});

describe('revealing part of the timeline', () => {
	it('unfolds the stage holding the checks and shows everything when filtered', async () => {
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
		render('talk');
		const checks = () => document.querySelector('[data-stage="checks"]')!;
		checks().querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
		flushSync();
		expect(checks().getAttribute('data-open')).toBe('false');
		await (app as unknown as { reveal: (w: 'checks' | 'now') => Promise<void> }).reveal('checks');
		flushSync();
		expect(checks().getAttribute('data-open')).toBe('true');
		expect(document.querySelector('[aria-pressed="true"]')?.textContent).toBe('Everything');
		expect(checks().querySelector('[data-evidence="checks"]')).not.toBeNull();
		scrolled.mockRestore();
	});
});

describe('the checks section', () => {
	it('lists each step with what it found, a failed one open', () => {
		app = mount(ChecksSection, {
			target: document.body,
			props: { task, checks: detail.build.checks, validation: null }
		});
		flushSync();
		const s = document.querySelector('[data-checks]')!;
		expect(s.textContent).toContain('Checks failed');
		const tests = s.querySelector('[data-check-step="test"]')!;
		expect(tests.textContent).toContain('1m 1s');
		expect(tests.textContent).toContain('Finds a page');
		expect(tests.textContent).toContain('9 passed');
	});
});
