import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PINS_KEY, pins } from '$lib/client/pins.svelte';
import { ALIASES_KEY, aliases } from '$lib/client/aliases.svelte';
import { PICKER_LIMIT, statsByProject } from '$lib/picker';
import type { Project } from '$lib/types';
import { taskSummary } from '../../../../tests/helpers/task-summary';
import ProjectList from './ProjectList.svelte';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const you = { kind: 'review' as const, owner: 'captain' as const, text: '', url: null };
const NAMES = ['Tidewatch', 'Lumen', 'Harbour map', 'Ship log', 'Wheelhouse'];

// A big fleet: 40 projects, a few of them busy.
const projects: Project[] = Array.from({ length: 40 }, (_, i) => ({
	id: `p${String(i).padStart(2, '0')}`,
	name: NAMES[i] ?? `Project ${String(i).padStart(2, '0')}`,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
}));
const tasks = [
	taskSummary('a', 'needs-review', { projectId: 'p30', attention: you }),
	taskSummary('b', 'needs-decision', { projectId: 'p30', attention: { ...you, kind: 'decision' } }),
	taskSummary('c', 'working', { projectId: 'p12', since: '2026-10-27T11:00:00Z' })
];
const stats = statsByProject(projects, tasks, NOW);
const needCount = (id: string) =>
	tasks.filter((t) => (id === 'all' || t.projectId === id) && t.attention?.owner === 'captain')
		.length;
const options = () =>
	[...document.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.project);
function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}
const key = (el: Element, k: string) => {
	el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
	flushSync();
};

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	pins.ids = [];
});

describe('the header’s project picker', () => {
	const open = (current = 'all') => {
		const onpick = vi.fn();
		const app = mount(ProjectList, {
			target: document.body,
			props: { projects, stats, current, needCount, onpick }
		});
		flushSync();
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		return { app, onpick, input };
	};
	const active = () =>
		document.querySelector<HTMLElement>('[aria-selected="true"]')?.dataset.project;

	it('lists All projects, the most active and then the rest, starting on the current one', () => {
		const { app, input } = open('p12');
		expect(options()).toHaveLength(41);
		expect(options().slice(0, 3)).toEqual(['all', 'p30', 'p12']);
		expect(document.body.textContent).toContain('Most active');
		expect(document.body.textContent).toContain('Other projects');
		expect(document.body.textContent).toContain('2 need you');
		expect(active()).toBe('p12');
		expect(input.getAttribute('aria-activedescendant')).toBe(
			document.querySelector('[aria-selected="true"]')!.id
		);
		unmount(app);
	});

	it('filters as you type; arrows move and Enter picks', () => {
		const { app, onpick, input } = open();
		type(input, 'project 1');
		expect(options()).toHaveLength(10);
		expect(active()).toBe('p10');
		key(input, 'ArrowDown');
		key(input, 'ArrowDown');
		expect(active()).toBe('p12');
		key(input, 'ArrowUp');
		key(input, 'Enter');
		expect(onpick).toHaveBeenCalledWith('p11');
		type(input, 'zzz');
		expect(options()).toEqual([]);
		expect(document.body.textContent).toContain('No project matches “zzz”.');
		unmount(app);
	});

	it('pins a project to the top, remembered in this browser', () => {
		const { app } = open();
		document.querySelector<HTMLButtonElement>('[aria-label="Pin Wheelhouse"]')!.click();
		flushSync();
		expect(options().slice(0, 2)).toEqual(['all', 'p04']);
		expect(document.body.textContent).toContain('Pinned');
		expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(['p04']);
		document.querySelector<HTMLButtonElement>('[aria-label="Unpin Wheelhouse"]')!.click();
		flushSync();
		expect(pins.ids).toEqual([]);
		unmount(app);
	});

	it('keeps the current project among the top ones, after the most active', () => {
		const { app } = open('p25');
		expect(options().slice(0, 2 + PICKER_LIMIT)).toContain('p25');
		unmount(app);
	});
});

describe('long project names', () => {
	// Siblings that share a prefix, and an ordinary name; all busy enough to show.
	const fleet: Project[] = [
		'ai-innovations-chat-agent',
		'ai-innovations-workflow',
		'ai-innovations-evals',
		'lumen'
	].map((name) => ({ ...projects[0], id: name, name }));
	const fleetStats = statsByProject(fleet, [], NOW);
	const none = () => 0;

	beforeEach(() => aliases.set('ai-innovations-workflow', ''));

	it('renames a project, kept in this browser, shown by its new name and found by search', () => {
		const onpick = vi.fn();
		const app = mount(ProjectList, {
			target: document.body,
			props: { projects: fleet, stats: fleetStats, current: 'all', needCount: none, onpick }
		});
		flushSync();
		document
			.querySelector<HTMLButtonElement>('[aria-label="Rename ai-innovations-workflow"]')!
			.click();
		flushSync();
		const field = document.querySelector<HTMLInputElement>(
			'input[aria-label="Friendly name for ai-innovations-workflow"]'
		)!;
		expect(field.value).toBe('workflow');
		type(field, 'Flow builder');
		key(field, 'Enter');
		expect(onpick).not.toHaveBeenCalled();
		const row = document.querySelector('[data-project="ai-innovations-workflow"]')!;
		expect(row.textContent).toContain('Flow builder');
		expect(row.querySelector('.project-tile')!.textContent).toBe('FB');
		expect(JSON.parse(localStorage.getItem(ALIASES_KEY)!)).toEqual({
			'ai-innovations-workflow': 'Flow builder'
		});
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		type(input, 'flow b');
		expect(options()).toEqual(['ai-innovations-workflow']);
		type(input, '');
		document
			.querySelector<HTMLButtonElement>('[aria-label="Rename ai-innovations-workflow"]')!
			.click();
		flushSync();
		const again = document.querySelector<HTMLInputElement>(
			'input[aria-label="Friendly name for ai-innovations-workflow"]'
		)!;
		type(again, '');
		key(again, 'Enter');
		expect(aliases.names).toEqual({});
		unmount(app);
	});

	it('Escape leaves a rename without changing the name', () => {
		const app = mount(ProjectList, {
			target: document.body,
			props: {
				projects: fleet,
				stats: fleetStats,
				current: 'all',
				needCount: none,
				onpick: vi.fn()
			}
		});
		flushSync();
		document.querySelector<HTMLButtonElement>('[aria-label="Rename lumen"]')!.click();
		flushSync();
		const field = document.querySelector<HTMLInputElement>(
			'input[aria-label="Friendly name for lumen"]'
		)!;
		type(field, 'Something else');
		key(field, 'Escape');
		expect(document.querySelector('input[aria-label="Friendly name for lumen"]')).toBeNull();
		expect(aliases.names).toEqual({});
		unmount(app);
	});

	it('the header picker shows the prefix as a heading, and the arrows follow the rows', () => {
		const onpick = vi.fn();
		const app = mount(ProjectList, {
			target: document.body,
			props: { projects: fleet, stats: fleetStats, current: 'all', needCount: none, onpick }
		});
		flushSync();
		const shown = options();
		expect(shown.slice(1, 4).every((id) => id!.startsWith('ai-innovations-'))).toBe(true);
		expect(document.body.textContent).toContain('ai-innovations');
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		key(input, 'ArrowDown');
		key(input, 'Enter');
		expect(onpick).toHaveBeenCalledWith(shown[1]);
		unmount(app);
	});
});
