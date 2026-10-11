import { describe, expect, it } from 'vitest';
import { acme } from './fixtures/acme';
import { parseGraph } from './graph';
import { layoutChart, type LaidNode } from './layout';

const overlaps = (a: LaidNode, b: LaidNode) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the chart layout', () => {
	const layout = layoutChart(acme());
	const node = (id: string) => layout.nodes.find((n) => n.id === id)!;

	it('draws landmarks, not teams, decisions or constraints', () => {
		const ids = layout.nodes.map((n) => n.id);
		expect(ids).toContain('service.orders');
		expect(ids).not.toContain('team.platform-engineering');
		expect(ids).not.toContain('decision.orders-on-postgres');
		expect(ids).not.toContain('constraint.pci-scope');
		expect(layout.nodes).toHaveLength(14);
	});

	it('puts each owner’s exhibits in its own waters, unowned last', () => {
		expect(layout.lanes.map((l) => l.title)).toEqual([
			'Platform Engineering',
			'Research Platform',
			'No owner on record'
		]);
		const inLane = (id: string) =>
			layout.lanes.find((l) => node(id).y >= l.y && node(id).y + node(id).h <= l.y + l.h)?.title;
		expect(inLane('service.orders')).toBe('Platform Engineering');
		expect(inLane('agent.research-assistant')).toBe('Research Platform');
		expect(inLane('system.stripe')).toBe('No owner on record');
	});

	it('runs dependencies left to right and keeps harbours on the coast, production first', () => {
		expect(node('service.checkout').x).toBeLessThan(node('service.orders').x);
		expect(node('service.orders').x).toBeLessThan(node('system.stripe').x);
		expect(node('service.orders').x).toBeLessThan(node('datasource.orders-db').x);
		const harbours = layout.nodes.filter((n) => n.kind === 'harbour');
		expect(harbours.map((n) => n.id)).toEqual(['environment.production', 'environment.staging']);
		expect(Math.min(...harbours.map((n) => n.x))).toBeGreaterThan(
			Math.max(...layout.nodes.filter((n) => n.kind !== 'harbour').map((n) => n.x + n.w))
		);
		expect(layout.coast).not.toBeNull();
	});

	it('sinks places with no lines to the bottom of their column', () => {
		const repo = node('repository.acme-platform');
		const sameColumn = layout.nodes.filter((n) => n.x === repo.x && n.kind === 'landmark');
		const lane = layout.lanes[0];
		const inLane = sameColumn.filter((n) => n.y >= lane.y && n.y < lane.y + lane.h);
		expect(Math.max(...inLane.map((n) => n.y))).toBe(repo.y);
	});

	it('never overlaps two places, and fits them all', () => {
		for (const a of layout.nodes) {
			expect(a.x).toBeGreaterThanOrEqual(0);
			expect(a.y).toBeGreaterThanOrEqual(0);
			expect(a.x + a.w).toBeLessThanOrEqual(layout.width);
			expect(a.y + a.h).toBeLessThanOrEqual(layout.height);
			for (const b of layout.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
		}
	});

	it('hatches restricted waters and lists notices to mariners', () => {
		expect(layout.restrictions.map((r) => [r.letter, r.title])).toEqual([
			['A', 'Card data never touches Acme systems'],
			['B', 'Customer data stays in the EU']
		]);
		expect(layout.halos.filter((h) => h.node === 'service.orders').map((h) => h.letter)).toEqual([
			'A'
		]);
		const prod = layout.halos.filter((h) => h.node === 'environment.production');
		expect(prod).toHaveLength(1);
		expect(layout.notices.map((n) => [n.exhibit.id, n.superseded])).toEqual([
			['decision.research-assistant-on-databricks', false],
			['decision.orders-on-postgres', false],
			['decision.orders-on-dynamodb', true]
		]);
	});

	it('draws lines only between places, with their confidence', () => {
		const rels = new Set(layout.edges.map((e) => e.rel));
		expect(rels).toEqual(new Set(['depends_on', 'uses', 'guarded_by', 'deployed_to']));
		expect(layout.edges).toHaveLength(16);
		const stripe = layout.edges.find(
			(e) => e.source === 'service.orders' && e.target === 'system.stripe'
		)!;
		expect(stripe.mark).toBe('charted');
		expect(stripe.quiet).toBe(false);
		// Lines into a harbour are quiet: drawn only for what is selected.
		const quiet = layout.edges.filter((e) => e.quiet);
		expect(quiet.map((e) => e.rel)).toEqual([
			'deployed_to',
			'deployed_to',
			'deployed_to',
			'deployed_to'
		]);
		expect(quiet.every((e) => e.target === 'environment.production')).toBe(true);
		expect(stripe.d).toMatch(/^M[\d.]+,[\d.]+ C/);
	});

	it('is the same every time', () => {
		expect(layoutChart(acme())).toEqual(layout);
	});

	it('shows a dangling target as an unsurveyed ghost', () => {
		const r = parseGraph(
			JSON.stringify({
				schema: 'docket.graph',
				version: 1,
				entities: [{ id: 'service.a', type: 'service', title: 'A', links: [] }],
				edges: [{ source: 'service.a', rel: 'depends_on', target: 'system.gone', dangling: true }]
			})
		);
		if (!r.ok) throw new Error(r.reason);
		const l = layoutChart(r.graph);
		expect(l.nodes.find((n) => n.id === 'system.gone')).toMatchObject({
			kind: 'ghost',
			exhibit: null
		});
		expect(l.edges[0].mark).toBe('unsurveyed');
		expect(l.coast).toBeNull();
	});
});
