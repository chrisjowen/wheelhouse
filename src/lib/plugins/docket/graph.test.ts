import { describe, expect, it } from 'vitest';
import { acme } from './fixtures/acme';
import { LIMITS, markFor, parseGraph, surveyDate } from './graph';

describe('reading docket graph --json', () => {
	it('reads the acme-platform example', () => {
		const g = acme();
		expect(g.project.name).toBe('acme-platform');
		expect(g.exhibits).toHaveLength(21);
		expect(g.links).toHaveLength(37);
		expect(g.trimmed).toEqual({ exhibits: 0, links: 0 });
		expect(g.diagnostics).toEqual({ errors: 0, warnings: 0, messages: [] });
		expect(g.index).toEqual({ synced: false, behind: 21 });
		expect(g.types.find((t) => t.name === 'service')?.icon).toBe('server');
		expect(g.surveyed).toBe('2026-09-14');

		const orders = g.exhibits.find((x) => x.id === 'service.orders')!;
		expect(orders).toMatchObject({
			type: 'service',
			title: 'Orders',
			owner: 'team.platform-engineering',
			confidence: 1,
			basis: 'stated',
			surveyed: '2026-09-02',
			path: '.docket/resources/services/orders.md'
		});
		expect(orders.summary).toMatch(/^Owns the order lifecycle/);
		expect(orders.summary).toContain('the only writer to datasource.orders-db;');
		expect(orders.attributes).toContainEqual({ key: 'lifecycle', value: 'active' });

		const agent = g.exhibits.find((x) => x.id === 'agent.research-assistant')!;
		expect(agent.attributes).toContainEqual({ key: 'modes', value: 'fast, slow' });
		expect(agent.evidence.map((e) => e.source).sort()).toEqual([
			'code',
			'conversation',
			'manifest'
		]);
	});

	it('draws link confidence as charted, position approximate and existence doubtful', () => {
		const g = acme();
		const link = (s: string, rel: string, t: string) =>
			g.links.find((l) => l.source === s && l.rel === rel && l.target === t)!;
		expect(link('service.orders', 'depends_on', 'system.stripe')).toMatchObject({
			confidence: 0.98,
			mark: 'charted'
		});
		expect(link('service.orders', 'depends_on', 'system.stripe').evidence[1]).toMatchObject({
			source: 'code',
			path: 'services/orders/src/payments/charge.ts',
			lines: '8-31',
			symbol: 'chargeOrder',
			observedAt: '2026-09-02'
		});
		expect(link('agent.research-assistant', 'uses', 'datasource.market-data').mark).toBe(
			'approximate'
		);
		expect(link('service.checkout', 'depends_on', 'service.orders').mark).toBe('doubtful');
		expect(markFor(0.9, 'evidence', true)).toBe('unsurveyed');
		expect(markFor(0.3, 'evidence')).toBe('doubtful');
		expect(markFor(null, null)).toBe('doubtful');
	});

	it('refuses what is not a version 1 docket graph', () => {
		expect(parseGraph('not json')).toEqual({
			ok: false,
			reason: 'docket printed something that is not JSON.'
		});
		expect(parseGraph('{"schema":"other","version":1}').ok).toBe(false);
		expect(parseGraph('{"schema":"docket.graph","version":2}')).toEqual({
			ok: false,
			reason: 'docket printed graph version 2; this Wheelhouse reads version 1.'
		});
		expect(parseGraph('{"schema":"docket.graph","version":1}')).toMatchObject({
			ok: true,
			graph: { exhibits: [], links: [], surveyed: null }
		});
	});

	it('marks dangling targets, counts diagnostics and trims to its limits', () => {
		const entities = Array.from({ length: LIMITS.exhibits + 5 }, (_, i) => ({
			id: `service.s${i}`,
			type: 'service',
			title: `S${i}`,
			links: []
		}));
		const r = parseGraph(
			JSON.stringify({
				schema: 'docket.graph',
				version: 1,
				entities,
				edges: [
					{ source: 'service.s0', rel: 'depends_on', target: 'system.ghost', dangling: true },
					{ source: 'service.s0', rel: 'depends_on', target: `service.s${LIMITS.exhibits + 1}` }
				],
				diagnostics: [
					{ severity: 'error', code: 'x', message: 'bad file' },
					{ severity: 'warning', code: 'y', message: 'odd link' }
				]
			})
		);
		if (!r.ok) throw new Error(r.reason);
		expect(r.graph.exhibits).toHaveLength(LIMITS.exhibits);
		expect(r.graph.links).toEqual([
			expect.objectContaining({ dangling: true, mark: 'unsurveyed' })
		]);
		expect(r.graph.trimmed).toEqual({ exhibits: 5, links: 1 });
		expect(r.graph.diagnostics).toEqual({
			errors: 1,
			warnings: 1,
			messages: ['bad file', 'odd link']
		});
	});

	it('reads survey dates from dates and timestamps', () => {
		expect(surveyDate('2026-09-02')).toBe('2026-09-02');
		expect(surveyDate('2026-09-02T10:00:00Z')).toBe('2026-09-02');
		expect(surveyDate('last week')).toBeNull();
		expect(surveyDate(20260902)).toBeNull();
	});
});
