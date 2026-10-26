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
});
