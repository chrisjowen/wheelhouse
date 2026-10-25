import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { normalizeBlocks } from '$lib/plugins/blocks';
import type { Block, SlotEntry } from '$lib/plugins/types';
import Blocks from './Blocks.svelte';
import SlotContent from './SlotContent.svelte';
import Throws from './Throws.test-fixture.svelte';

const html = (blocks: unknown[]) => {
	const n = normalizeBlocks(blocks);
	if (!n.ok) throw new Error(n.reason);
	return render(Blocks, { props: { blocks: n.blocks } }).body;
};

const entry = (o: Partial<SlotEntry>): SlotEntry => ({
	key: 'p/c',
	slot: 'task.section',
	pluginId: 'p',
	contributionId: 'c',
	title: 'T',
	order: 500,
	step: null,
	projectId: null,
	render: { blocks: true },
	content: { available: true, value: [], source: 'a test source', observedAt: null },
	...o
});

describe('block renderers', () => {
	it('render every built-in block type', () => {
		const out = html([
			{ block: 'text.v1', text: 'Plain words' },
			{ block: 'kv.v1', items: [{ key: 'Clone', value: '/src/x' }] },
			{
				block: 'links.v1',
				links: [{ label: 'Repository', href: 'https://github.com/o/r', note: 'main' }]
			},
			{
				block: 'table.v1',
				columns: ['Task', 'PR'],
				rows: [['Fix', { text: '#3', href: 'https://github.com/o/r/pull/3' }]]
			},
			{ block: 'image.v1', src: '/shot.png', alt: 'A screenshot' },
			{ block: 'status.v1', tone: 'fail', label: 'Deploy failed', detail: 'exit 1' },
			{
				block: 'graph.v1',
				nodes: [
					{ id: 'a', label: 'Orders' },
					{ id: 'b', label: 'Pay' }
				],
				edges: [{ from: 'a', to: 'b' }]
			}
		]);
		for (const type of [
			'text.v1',
			'kv.v1',
			'links.v1',
			'table.v1',
			'image.v1',
			'status.v1',
			'graph.v1'
		]) {
			expect(out).toContain(`data-block="${type}"`);
		}
		expect(out).toContain('href="https://github.com/o/r"');
		expect(out).toContain('target="_blank"');
		expect(out).toContain('href="https://github.com/o/r/pull/3"');
		expect(out).toContain('src="/shot.png"');
		expect(out).toContain('Deploy failed');
		expect(out).toContain('2 nodes, 1 link');
		expect(out).toContain('a → b');
	});

	it('shows plugin text as text, never as HTML', () => {
		const out = html([{ block: 'text.v1', text: '<img src=x onerror=alert(1)>' }]);
		expect(out).not.toContain('<img');
		expect(out).toContain('&lt;img');
	});

	it('never renders an unsafe link, even if one slips past validation', () => {
		const blocks = [
			{ block: 'links.v1', links: [{ label: 'Click', href: 'javascript:alert(1)' }] }
		] as Block[];
		const out = render(Blocks, { props: { blocks } }).body;
		expect(out).toContain('Click');
		expect(out).not.toContain('javascript:');
	});

	it('renders a block it does not know as a plain fallback', () => {
		const out = html([{ block: 'chart.v7', series: [1, 2] }]);
		expect(out).toContain('data-block="unknown"');
		expect(out).toContain('cannot show a “chart.v7” block');
		expect(out).toContain('series');
	});
});

describe('slot content', () => {
	it('renders blocks with their source', () => {
		const out = render(SlotContent, {
			props: {
				entry: entry({
					content: {
						available: true,
						value: [{ block: 'text.v1', text: 'Hello' }],
						source: 'the clone',
						observedAt: null
					}
				})
			}
		}).body;
		expect(out).toContain('Hello');
		expect(out).toContain('From the clone.');
	});

	it('says why an entry is not available', () => {
		const out = render(SlotContent, {
			props: {
				entry: entry({
					content: { available: false, reason: 'The x plugin did not answer within 50 ms.' }
				})
			}
		}).body;
		expect(out).toContain('Not available. The x plugin did not answer within 50 ms.');
	});

	it('mounts a plugin panel only in the browser, so a throwing panel cannot break server rendering', () => {
		const out = render(SlotContent, {
			props: {
				entry: entry({
					render: { component: 'p/boom' },
					content: { available: true, value: 1, source: 's', observedAt: null }
				}),
				panels: { 'p/boom': Throws }
			}
		}).body;
		expect(out).toContain('Loading…');
	});

	it('says so when a panel is not part of this build', () => {
		const out = render(SlotContent, {
			props: { entry: entry({ render: { component: 'p/missing' } }) }
		}).body;
		expect(out).toContain('does not include the “p/missing” panel');
	});

	it('fills a full-height page: blocks scroll in their own area, the source sits along the bottom', () => {
		const out = render(SlotContent, {
			props: {
				entry: entry({
					content: {
						available: true,
						value: [{ block: 'text.v1', text: 'Hello' }],
						source: 'the clone',
						observedAt: null
					}
				}),
				fill: true
			}
		}).body;
		expect(out).toMatch(/class="min-h-0 flex-1 overflow-y-auto[^"]*"[^>]*>[\s\S]*Hello/);
		expect(out).toMatch(/class="[^"]*shrink-0 border-t[^"]*"[^>]*>\s*From the clone\./);
	});
});
