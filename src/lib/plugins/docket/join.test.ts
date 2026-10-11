import { describe, expect, it } from 'vitest';
import { acme } from './fixtures/acme';
import { hazardsOf, joinFiles, normalizePath, pathMatches } from './join';

describe('joining a task to the chart', () => {
	it('places the report’s example: a Stripe change in Orders', () => {
		const j = joinFiles(acme(), [
			'services/orders/src/payments/charge.ts',
			'./services/orders/package.json',
			'README.md'
		]);
		expect(j.touched).toEqual([
			{
				id: 'service.orders',
				files: ['services/orders/package.json', 'services/orders/src/payments/charge.ts']
			}
		]);
		expect(j.touchedLinks).toEqual([
			expect.objectContaining({
				source: 'service.orders',
				rel: 'depends_on',
				target: 'system.stripe',
				mark: 'charted'
			})
		]);
		expect(j.nearby.map((l) => `${l.rel} ${l.target}`)).toEqual([
			'depends_on datasource.orders-db',
			'depends_on system.stripe',
			'uses library.order-events',
			'deployed_to environment.production'
		]);
		expect(j.restricted).toEqual([
			{
				id: 'constraint.pci-scope',
				appliesTo: ['service.orders', 'system.stripe'],
				direct: true
			},
			{
				id: 'constraint.eu-data-residency',
				appliesTo: ['datasource.orders-db', 'environment.production'],
				direct: false
			}
		]);
		expect(j.notices).toEqual([
			{
				id: 'decision.orders-on-postgres',
				appliesTo: ['service.orders', 'datasource.orders-db'],
				superseded: false
			},
			{ id: 'decision.orders-on-dynamodb', appliesTo: ['service.orders'], superseded: true }
		]);
		expect(j.dependents.map((l) => `${l.source} ${l.rel}`)).toEqual([
			'service.checkout depends_on'
		]);
		expect(j.coverage).toEqual({ files: 3, matched: 2, evidencePaths: 9 });
		expect(hazardsOf(j)).toEqual([{ id: 'constraint.pci-scope', appliesTo: ['service.orders'] }]);
	});

	it('finds no hazard where only decisions apply', () => {
		const j = joinFiles(acme(), ['agents/research-assistant/src/agent.ts']);
		expect(j.touched.map((t) => t.id)).toEqual(['agent.research-assistant']);
		expect(j.notices.map((n) => n.id)).toEqual(['decision.research-assistant-on-databricks']);
		// It reaches Sessions and Production, which EU data residency covers: not a direct touch.
		expect(j.restricted).toEqual([
			{
				id: 'constraint.eu-data-residency',
				appliesTo: ['datasource.sessions', 'environment.production'],
				direct: false
			}
		]);
		expect(hazardsOf(j)).toEqual([]);
	});

	it('places nothing when no evidence names the files', () => {
		const j = joinFiles(acme(), ['docs/intro.md']);
		expect(j.touched).toEqual([]);
		expect(j.nearby).toEqual([]);
		expect(j.restricted).toEqual([]);
		expect(j.coverage).toMatchObject({ files: 1, matched: 0 });
		expect(joinFiles(acme(), []).coverage.files).toBe(0);
	});

	it('matches exact paths, and directories only when the evidence names one', () => {
		expect(normalizePath('./a//b.ts')).toBe('a/b.ts');
		expect(normalizePath('/a\\b.ts')).toBe('a/b.ts');
		expect(pathMatches('services/orders/', 'services/orders/src/x.ts')).toBe(true);
		expect(pathMatches('services/orders', 'services/orders/src/x.ts')).toBe(false);
		expect(pathMatches('services/orders/a.ts', './services/orders/a.ts')).toBe(true);
		expect(pathMatches('', 'a.ts')).toBe(false);
	});
});
