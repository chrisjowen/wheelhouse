import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Chart from './Chart.svelte';
import { acme } from './fixtures/acme';
import type { ChartData } from './types';

const html = (c: typeof Chart, data: unknown) =>
	render(c, { props: { data } })
		.body.replace(/<!--[^>]*-->/g, '')
		.replace(/\s+/g, ' ');

const chart: ChartData = {
	state: 'chart',
	graph: acme(),
	vessels: [
		{
			taskId: 'pay',
			title: 'Retry Stripe charges',
			step: 'Building',
			status: 'Working',
			touched: ['service.orders'],
			hazards: ['constraint.pci-scope']
		}
	],
	unplaced: 1,
	configuredRoot: '/fixtures/acme-platform',
	openCommand: 'docket open --root /fixtures/acme-platform'
};

describe('docket panels', () => {
	it('say plainly when a project keeps no docket', () => {
		const out = html(Chart, { state: 'no-docket' });
		expect(out).toContain('This project keeps no docket');
		expect(out).not.toContain('<svg');
	});

	it('draw the chart with its waters, harbours, vessels and key', () => {
		const out = html(Chart, chart);
		expect(out).toContain('21 landmarks');
		expect(out).toContain('37 routes');
		expect(out).toContain('1 vessel under way');
		expect(out).toContain('1 hazard on a course');
		expect(out).toContain('surveyed 2026-09-14');
		expect(out).toContain('Platform Engineering');
		expect(out).toContain('No owner on record');
		expect(out).toContain('Where code runs');
		expect(out).toContain('Retry Stripe charges');
		expect(out).toContain('in restricted waters: Card data never touches Acme systems');
		expect(out).toContain('Position approximate (PA)');
		expect(out).toContain('Existence doubtful (ED)');
		expect(out).toContain('Notices to mariners');
		expect(out).toContain('Open in docket');
		expect(out).toContain('docket open --root /fixtures/acme-platform</code>');
		expect(out).toContain('set in Wheelhouse’s');
		expect(out).toContain('1 other task under way');
		// Nothing in the chart edits the docket or asks anything.
		expect(out).not.toMatch(/<form|<textarea|<input/);
	});
});
