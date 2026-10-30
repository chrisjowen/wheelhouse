import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { SlotEntry } from '$lib/plugins/types';
import type { Project } from '$lib/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';
import ProjectBanner from './ProjectBanner.svelte';

/** The top of a project's pages: its state, its most important line and its tabs. */

const NOW = Date.parse('2026-10-30T12:00:00Z');
const lumen: Project = {
	id: 'lumen',
	name: 'lumen',
	description: 'Photo sharing for friends and family.',
	posture: 'direct-PR',
	registered: true,
	path: null,
	passage: { custom: true, problems: 1, needsConsent: false }
};
const tab = (contributionId: string, title: string) =>
	({
		key: `docket/${contributionId}@lumen`,
		slot: 'project.tab',
		pluginId: 'docket',
		contributionId,
		title,
		order: 0,
		step: null,
		projectId: 'lumen',
		render: { kind: 'blocks' },
		badge: null,
		content: { available: true, value: [] }
	}) as unknown as SlotEntry;

let app: ReturnType<typeof mount> | null = null;
function draw(current: string, compact = false) {
	app = mount(ProjectBanner, {
		target: document.body,
		props: {
			id: 'lumen',
			project: lumen,
			tasks: [taskSummary('Dark mode', 'working', { since: '2026-10-30T10:00:00Z' })],
			tabs: [tab('chart', 'Chart')],
			repo: 'https://github.com/example/lumen',
			current,
			now: NOW,
			compact
		}
	});
	flushSync();
}
const tabs = () =>
	[...document.querySelectorAll<HTMLAnchorElement>('nav a.nav-tab')].map((a) => ({
		text: a.textContent?.trim(),
		href: a.getAttribute('href'),
		current: a.getAttribute('aria-current')
	}));

beforeEach(() => (document.body.innerHTML = ''));
afterEach(() => {
	if (app) unmount(app);
	app = null;
});

describe('a project’s banner', () => {
	it('names the project, its state and its most important line, and how it ships', () => {
		draw('work');
		const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(document.querySelector('h1')?.textContent?.trim()).toBe('lumen');
		expect(text).toContain('Held up');
		expect(text).toContain('Its passage file has problems.');
		expect(text).toContain('1 under way · 0 landed this week · last activity 2 h ago');
		expect(text).toContain('Straight to PR · you merge');
	});

	it('links every page of the project, the current one marked', () => {
		draw('docket/chart@lumen');
		expect(tabs()).toEqual([
			{ text: 'Work', href: '/projects/lumen', current: null },
			{ text: 'Chart', href: '/projects/lumen/docket/chart', current: 'page' },
			{ text: 'Passage', href: '/projects/lumen/passage', current: null },
			{ text: 'Repository', href: 'https://github.com/example/lumen', current: null }
		]);
		expect(document.querySelector('[data-slot="project.tab"]')?.textContent).toBe('Chart');
	});

	it('keeps to one line over a plugin tab that fills the window', () => {
		draw('docket/chart@lumen', true);
		expect(document.querySelector('h1')).toBeNull();
		expect(tabs().map((t) => t.text)).toEqual(['Work', 'Chart', 'Passage', 'Repository']);
	});
});
