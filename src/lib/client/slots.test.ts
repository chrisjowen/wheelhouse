import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlotView } from '$lib/plugins/types';
import { slots } from './slots.svelte';

const view = (title: string): SlotView => ({
	schema: 'wheelhouse-slots.v1',
	entries: [
		{
			key: `p/${title}`,
			slot: 'task.section',
			pluginId: 'p',
			contributionId: title,
			title,
			order: 500,
			step: null,
			projectId: null,
			render: { blocks: true },
			badge: null,
			content: { available: true, value: [], source: 's', observedAt: null }
		}
	]
});

afterEach(() => vi.unstubAllGlobals());

describe('slots', () => {
	it('shows a refetch until the page loads newer slots of its own', async () => {
		const key = 'task=t-1';
		const fetched = view('fetched');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => fetched }))
		);
		const t0 = Date.now();
		slots.refresh(key, t0 - 60_000);
		await vi.waitFor(() =>
			expect(slots.entries(key, { [key]: view('old load') }, t0 - 60_000)[0].title).toBe('fetched')
		);

		expect(slots.entries(key, { [key]: view('new load') }, Date.now() + 1)[0].title).toBe(
			'new load'
		);
	});

	it('keeps the last page-provided view for a page that did not load the key', () => {
		const key = 'fleet';
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const loadedAt = Date.now();
		expect(slots.entries(key, { [key]: view('home load') }, loadedAt)[0].title).toBe('home load');
		slots.refresh(key, loadedAt);

		expect(slots.entries(key, undefined, 0)[0].title).toBe('home load');
		slots.refresh(key, 0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refetches nothing while the tab is hidden, and what it held back once shown', async () => {
		const key = 'task=t-hidden';
		const listeners: (() => void)[] = [];
		const doc = {
			hidden: true,
			addEventListener: (_: string, l: () => void) => listeners.push(l)
		};
		vi.stubGlobal('document', doc);
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => view('shown') }));
		vi.stubGlobal('fetch', fetchMock);
		slots.refresh(key, Date.now() - 60_000);
		slots.refresh(key, Date.now() - 60_000);
		expect(fetchMock).not.toHaveBeenCalled();
		doc.hidden = false;
		for (const l of listeners) l();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(slots.entries(key, undefined, 0)[0]?.title).toBe('shown'));
	});
});
