import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FleetView, Project } from '$lib/types';
import { fleetOf, taskSummary } from '../../../tests/helpers/task-summary';

const project = (id: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

const page = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	url: new URL('http://127.0.0.1:4310/harbour')
}));
vi.mock('$app/state', () => ({ page }));

const { default: Page } = await import('./+page.svelte');

let app: ReturnType<typeof mount> | null = null;
function draw(show: string, fleet: FleetView) {
	page.url = new URL(`http://127.0.0.1:4310/harbour?show=${show}`);
	page.data = { fleet };
	app = mount(Page, { target: document.body, props: { data: { commits: {} } } as never });
	flushSync();
}
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('the Harbour’s filters', () => {
	const fleet = (): FleetView => ({
		...fleetOf([taskSummary('Gateway', 'working', { since: new Date().toISOString() })]),
		projects: [project('lumen')]
	});

	it('says so when no project is quiet, as it does for the other filters', () => {
		draw('quiet', fleet());
		expect(text()).toContain('No project is quiet right now.');
		unmount(app!);
		document.body.innerHTML = '';
		draw('held-up', fleet());
		expect(text()).toContain('No project is held up right now.');
	});

	it('shows a new project under Under way', () => {
		draw('under-way', fleet());
		expect(document.querySelector('[data-project="lumen"]')).not.toBeNull();
		expect(document.querySelector('[data-project="lumen"]')?.textContent).toContain('New');
	});
});
