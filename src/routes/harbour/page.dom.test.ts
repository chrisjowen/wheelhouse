import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FleetView, Project } from '$lib/types';
import { fleetOf, taskSummary } from '../../../tests/helpers/task-summary';

const project = (id: string, o: Partial<Project> = {}): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null,
	...o
});

const page = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	url: new URL('http://127.0.0.1:4310/harbour')
}));
vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { default: Page } = await import('./+page.svelte');

let app: ReturnType<typeof mount> | null = null;
function draw(fleet: FleetView, query = '') {
	page.url = new URL(`http://127.0.0.1:4310/harbour${query}`);
	page.data = { fleet };
	app = mount(Page, { target: document.body, props: { data: {} } as never });
	flushSync();
}
const text = (el: Element | null = document.body) => el?.textContent?.replace(/\s+/g, ' ') ?? '';
const lane = (id: string) => document.querySelector(`[data-lane="${id}"]`);

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	localStorage.clear();
});

const fleet = (): FleetView => ({
	...fleetOf([
		taskSummary('Gateway', 'working', { projectId: 'lumen' }),
		taskSummary('Shape', 'needs-decision', {
			projectId: 'docket',
			attention: { kind: 'decision', owner: 'captain', text: 'Pick a shape.', url: null }
		}),
		taskSummary('Later', 'queued', { projectId: 'lumen' })
	]),
	projects: [
		project('lumen', { description: 'The shop front' }),
		project('docket'),
		project('casebook')
	]
});

describe('the Harbour board', () => {
	it('gives each busy project a lane, what needs you first, with its tasks in their columns', () => {
		draw(fleet());
		const lanes = [...document.querySelectorAll('[data-lane]')].map((l) =>
			l.getAttribute('data-lane')
		);
		expect(lanes).toEqual(['docket', 'lumen']);
		expect(
			lane('lumen')?.querySelector('[data-cell="building"] [data-task="Gateway"]')
		).not.toBeNull();
		expect(lane('lumen')?.querySelector('[data-cell="queued"] [data-task="Later"]')).not.toBeNull();
		expect(lane('docket')?.querySelector('[data-cell="you"] [data-task="Shape"]')).not.toBeNull();
		expect(text(document.querySelector('[data-headline]'))).toContain('1 thing waits on you');
	});

	it('folds projects with nothing open into quiet waters', () => {
		draw(fleet());
		expect(lane('casebook')).toBeNull();
		expect(document.querySelector('[data-quiet-project="casebook"]')).not.toBeNull();
		expect(text()).toContain('Quiet waters · 1 project with nothing open');
	});

	it('collapses a lane to its counts, and remembers it in this browser', () => {
		draw(fleet());
		const toggle = lane('lumen')!.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
		toggle.click();
		flushSync();
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(lane('lumen')?.querySelector('[data-task]')).toBeNull();
		expect(lane('lumen')?.querySelector('[data-folded]')).not.toBeNull();
		expect(JSON.parse(localStorage.getItem('wheelhouse-harbour-folded')!)).toEqual(['lumen']);

		unmount(app!);
		document.body.innerHTML = '';
		draw(fleet());
		expect(lane('lumen')?.querySelector('[data-task]')).toBeNull();
		expect(lane('docket')?.querySelector('[data-task]')).not.toBeNull();
	});

	it('narrows the lanes from ?show=, and says so when none match', () => {
		draw(fleet(), '?show=needs-you');
		expect(
			[...document.querySelectorAll('[data-lane]')].map((l) => l.getAttribute('data-lane'))
		).toEqual(['docket']);
		unmount(app!);
		document.body.innerHTML = '';
		draw({ ...fleet(), tasks: fleet().tasks.filter((t) => t.id !== 'Later') }, '?show=queued');
		expect(text()).toContain('No project matches queued right now.');
	});

	it('slides a project out from its lane, with a link to its page', () => {
		draw(fleet());
		lane('lumen')!.querySelector<HTMLAnchorElement>('a[data-project="lumen"]')!.click();
		flushSync();
		const panel = document.querySelector('[data-project-slideout="lumen"]');
		expect(panel).not.toBeNull();
		expect(text(panel)).toContain('The shop front');
		expect(panel?.querySelector('a[data-open-project]')?.getAttribute('href')).toBe(
			'/projects/lumen'
		);
		expect(text(panel)).toContain('Gateway');
	});
});
