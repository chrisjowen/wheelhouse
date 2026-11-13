import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewContext, SlotEntry } from '$lib/plugins/types';

/** Plugins' buttons on a live preview, and the review surface's taking the lead. */

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);
const { default: PreviewActions } = await import('./PreviewActions.svelte');

class Action extends HTMLElement {
	preview: PreviewContext | undefined;
}
customElements.define('share-action', class extends Action {});
customElements.define('hr-action', class extends Action {});

const entry = (pluginId: string, element: string): SlotEntry => ({
	key: `${pluginId}/action`,
	slot: 'preview.action',
	pluginId,
	contributionId: 'action',
	title: pluginId,
	order: 0,
	step: null,
	projectId: null,
	render: { element },
	badge: null,
	content: { available: true, value: {}, source: 'a test', observedAt: null }
});
const PREVIEW: PreviewContext = {
	url: 'http://127.0.0.1:5173/',
	taskId: 't-1',
	title: 'Share links',
	projectId: 'lumen',
	board: false
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

async function show(reviewSurface: { id: string; name: string } | null) {
	state.page.data = {
		slots: {
			fleet: {
				schema: 'wheelhouse-slots.v1',
				entries: [entry('shared-review', 'share-action'), entry('hr', 'hr-action')]
			}
		},
		slotsAt: Date.now(),
		reviewSurface
	};
	app = mount(PreviewActions, { target: document.body, props: { preview: PREVIEW } });
	await vi.waitFor(() =>
		expect(document.querySelectorAll('[data-slot] > div > *')).toHaveLength(2)
	);
	flushSync();
	await tick();
}
const slots = () => [...document.querySelectorAll<HTMLElement>('[data-slot="preview.action"]')];
const element = (s: HTMLElement) => s.querySelector('div')!.firstElementChild as Action;

describe('preview actions', () => {
	it('draws every plugin’s button in order, none primary, while the built-in is the review surface', async () => {
		await show(null);
		expect(slots().map((s) => element(s).localName)).toEqual(['share-action', 'hr-action']);
		expect(slots().some((s) => s.hasAttribute('data-primary'))).toBe(false);
		expect(slots().map((s) => element(s).preview?.primary)).toEqual([undefined, undefined]);
	});

	it('puts the review surface’s button first, as the primary one', async () => {
		await show({ id: 'hr', name: 'Human Review' });
		const [first, second] = slots();
		expect(element(first).localName).toBe('hr-action');
		expect(first.hasAttribute('data-primary')).toBe(true);
		expect(element(first).preview).toEqual({ ...PREVIEW, primary: true });
		expect(second.hasAttribute('data-primary')).toBe(false);
		expect(element(second).preview).toEqual(PREVIEW);
	});
});
