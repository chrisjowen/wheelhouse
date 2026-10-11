import { describe, expect, it } from 'vitest';
import { LIMITS, matchBridgeCards, normalizeBlocks, normalizeCards, safeHref } from './blocks';
import type { SlotEntry } from './types';

describe('safeHref', () => {
	it('allows http(s) and same-origin paths only', () => {
		expect(safeHref('https://github.com/o/r')).toBe('https://github.com/o/r');
		expect(safeHref('http://127.0.0.1:4310/')).toBe('http://127.0.0.1:4310/');
		expect(safeHref('/tasks/a')).toBe('/tasks/a');
		for (const bad of [
			'javascript:alert(1)',
			'data:text/html,x',
			'//evil.test/',
			'/\\evil.test',
			'file:///etc/passwd',
			'relative/path',
			42,
			null
		]) {
			expect(safeHref(bad)).toBeNull();
		}
	});
});

describe('normalizeBlocks', () => {
	it('keeps known blocks, dropping unknown fields', () => {
		const r = normalizeBlocks([
			{ block: 'text.v1', text: 'hi', muted: true, html: '<b>x</b>' },
			{ block: 'kv.v1', items: [{ key: 'A', value: 'b', href: 'https://x.test' }, { key: 'bad' }] },
			{
				block: 'table.v1',
				columns: ['A', 'B'],
				rows: [['1', { text: 'two', href: 'https://x.test/2' }, 'extra'], [3]]
			},
			{ block: 'image.v1', src: '/api/tasks/a/artifacts/x.png', alt: 'x' },
			{ block: 'status.v1', tone: 'nope', label: 'Hmm' },
			{
				block: 'graph.v1',
				nodes: [{ id: 'a' }, { id: 'b', label: 'B', kind: 'service' }],
				edges: [
					{ from: 'a', to: 'b' },
					{ from: 'a', to: 'ghost' }
				]
			}
		]);
		expect(r).toEqual({
			ok: true,
			blocks: [
				{ block: 'text.v1', text: 'hi', muted: true },
				{ block: 'kv.v1', items: [{ key: 'A', value: 'b', href: 'https://x.test' }] },
				{
					block: 'table.v1',
					columns: ['A', 'B'],
					rows: [['1', { text: 'two', href: 'https://x.test/2' }], ['3']]
				},
				{ block: 'image.v1', src: '/api/tasks/a/artifacts/x.png', alt: 'x' },
				{ block: 'status.v1', tone: 'unknown', label: 'Hmm' },
				{
					block: 'graph.v1',
					nodes: [
						{ id: 'a', label: 'a' },
						{ id: 'b', label: 'B', kind: 'service' }
					],
					edges: [{ from: 'a', to: 'b' }]
				}
			]
		});
	});

	it('turns unknown or broken blocks into a plain fallback', () => {
		const r = normalizeBlocks([
			{ block: 'chart.v2', x: 1 },
			'text',
			{ block: 'text.v1' },
			{ block: 'image.v1', src: 'javascript:x' }
		]);
		expect(r.ok && r.blocks.map((b) => [b.block, b.block === 'unknown' ? b.type : null])).toEqual([
			['unknown', 'chart.v2'],
			['unknown', 'string'],
			['unknown', 'text.v1'],
			['unknown', 'image.v1']
		]);
	});

	it('caps lists and strings', () => {
		const r = normalizeBlocks(
			Array.from({ length: 40 }, () => ({ block: 'text.v1', text: 'x'.repeat(10_000) }))
		);
		expect(r.ok && r.blocks.length).toBe(LIMITS.blocks);
		expect(r.ok && (r.blocks[0] as { text: string }).text.length).toBe(LIMITS.text);
	});

	it('refuses a value that is not a list', () => {
		expect(normalizeBlocks({ block: 'text.v1', text: 'x' })).toMatchObject({ ok: false });
	});
});

describe('Bridge cards', () => {
	const entry = (value: unknown): SlotEntry => ({
		key: 'p/c',
		slot: 'bridge.card',
		pluginId: 'p',
		contributionId: 'c',
		title: 'Project',
		order: 500,
		step: null,
		projectId: null,
		render: { blocks: true },
		content: { available: true, value, source: 's', observedAt: null }
	});

	it('keeps only cards with an absolute http(s) mention', () => {
		const r = normalizeCards([
			{
				key: 'a',
				title: 'A',
				mentions: ['https://github.com/o/a', '/local', 'javascript:x'],
				blocks: []
			},
			{ key: 'b', title: 'B', mentions: ['/local'], blocks: [] },
			{ key: 'c', title: 'C' }
		]);
		expect(r).toEqual({
			ok: true,
			cards: [{ key: 'a', title: 'A', mentions: ['https://github.com/o/a'], blocks: [] }]
		});
	});

	it('match a reply only on an exact URL', () => {
		const cards = normalizeCards([
			{ key: 'a', title: 'A', mentions: ['https://github.com/o/a'], blocks: [] }
		]);
		const e = [entry(cards.ok ? cards.cards : [])];
		expect(matchBridgeCards('See https://github.com/o/a.', e).map((m) => m.card.key)).toEqual([
			'a'
		]);
		expect(matchBridgeCards('See https://github.com/o/a/pull/3', e)).toEqual([]);
		expect(matchBridgeCards('The o/a repo', e)).toEqual([]);
		expect(
			matchBridgeCards('https://github.com/o/a', [
				{ ...e[0], content: { available: false, reason: 'x' } }
			])
		).toEqual([]);
	});
});
