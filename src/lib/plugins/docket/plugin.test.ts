import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PluginConfig } from '../../server/plugins/config';
import { PluginRegistry } from '../../server/plugins/registry';
import type { Project, TaskSummary } from '../../types';
import { projectLinks } from '../project-links/plugin.server';
import type { SlotEntry } from '../types';
import { ACME_FILE } from './fixtures/acme';
import { clearDocketCache, docket, readSettings } from './plugin.server';
import type { ChartData, HazardsData, WatersData } from './types';

/**
 * The docket plugin through the registry, against fake `docket` commands: the
 * real acme-platform graph, a slow one, an old one without `graph`, one that
 * finds no docket and one that prints nonsense.
 */

let dir: string;
let bin: Record<string, string>;
const projects: Project[] = [];
const tasks: TaskSummary[] = [];
const changed = new Map<string, string[]>();

function fake(name: string, body: string): string {
	const file = path.join(dir, 'bin', name);
	writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
	chmodSync(file, 0o755);
	return file;
}

function task(id: string, projectId: string, status: TaskSummary['status'] = 'working') {
	return {
		id,
		projectId,
		title: `Task ${id}`,
		status,
		statusLabel: status === 'landed' ? 'Landed' : 'Working',
		passage: {
			track: 'ship',
			current: 1,
			basis: 'test',
			steps: [
				{ key: 'queued', label: 'Queued' },
				{ key: 'building', label: 'Building' }
			]
		}
	} as unknown as TaskSummary;
}

function registry(settings: Record<string, unknown>, extra: Partial<PluginConfig['plugins']> = {}) {
	const config: PluginConfig = {
		plugins: { docket: { settings }, ...extra } as PluginConfig['plugins']
	};
	return new PluginRegistry([docket, projectLinks], {
		fleet: () => ({ projects, tasks }),
		worktree: () => null,
		changedFiles: async (id) => changed.get(id) ?? null,
		config: async () => ({ config, error: null })
	});
}

const bySlot = (entries: SlotEntry[], pluginId = 'docket') =>
	Object.fromEntries(entries.filter((e) => e.pluginId === pluginId).map((e) => [e.slot, e]));
const project = async (reg: PluginRegistry, id: string) =>
	bySlot((await reg.slots({ scope: 'project', projectId: id })).entries);
const taskSlots = async (reg: PluginRegistry, id: string) =>
	bySlot((await reg.slots({ scope: 'task', taskId: id })).entries);

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-docket-'));
	mkdirSync(path.join(dir, 'bin'));
	for (const p of ['acme', 'plain']) mkdirSync(path.join(dir, p));
	writeFileSync(path.join(dir, 'acme', '.docket.yaml'), 'version: 1\n');
	projects.push(
		{ id: 'acme', name: 'Acme', description: null, path: path.join(dir, 'acme') },
		{ id: 'plain', name: 'Plain', description: null, path: path.join(dir, 'plain') }
	);
	tasks.push(
		task('pay', 'acme'),
		task('research', 'acme'),
		task('old', 'acme', 'landed'),
		task('docs', 'plain')
	);
	changed.set('pay', ['services/orders/src/payments/charge.ts', 'README.md']);
	changed.set('research', ['agents/research-assistant/src/agent.ts']);
	changed.set('old', ['services/orders/src/payments/charge.ts']);
	changed.set('docs', ['services/orders/src/payments/charge.ts']);
	bin = {
		ok: fake(
			'docket-ok',
			`process.stdout.write(require('fs').readFileSync(${JSON.stringify(ACME_FILE)}));`
		),
		slow: fake('docket-slow', 'setTimeout(() => {}, 20000);'),
		old: fake('docket-old', `console.error("error: unknown command 'graph'"); process.exit(1);`),
		none: fake(
			'docket-none',
			'console.error("No .docket.yaml found in /x or any parent directory."); process.exit(1);'
		),
		garbage: fake('docket-garbage', 'console.log("hello");'),
		missing: path.join(dir, 'bin', 'no-such-docket')
	};
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => clearDocketCache());

describe('the docket plugin', () => {
	it('is on by default only for projects that keep a docket', async () => {
		const reg = registry({ bin: bin.ok });
		expect((await reg.view()).enabled).toEqual({ acme: ['docket'], plain: [] });
		expect(reg.status().find((p) => p.id === 'docket')).toMatchObject({
			state: 'loaded',
			enabledWhenFile: '.docket.yaml',
			slots: ['project.tab', 'harbour.card', 'task.section']
		});
		expect(await project(reg, 'plain')).toEqual({});
		expect(await taskSlots(reg, 'docs')).toEqual({});
	});

	it('charts the docket, with vessels where tasks under way touch it', async () => {
		const s = await project(registry({ bin: bin.ok }), 'acme');
		const tab = s['project.tab'];
		expect(tab).toMatchObject({ title: 'Chart', render: { component: 'docket/chart' } });
		if (!tab.content.available) throw new Error(tab.content.reason);
		expect(tab.content.source).toBe('the project’s docket');
		const chart = tab.content.value as ChartData;
		expect(chart.state).toBe('chart');
		expect(chart.graph.exhibits).toHaveLength(21);
		expect(chart.configuredRoot).toBeNull();
		expect(chart.openCommand).toBe(`docket open --root ${path.join(dir, 'acme')}`);
		// The landed task is not under way, so it is no vessel.
		expect(chart.vessels).toEqual([
			{
				taskId: 'pay',
				title: 'Task pay',
				step: 'Building',
				status: 'Working',
				touched: ['service.orders'],
				hazards: ['constraint.pci-scope']
			},
			{
				taskId: 'research',
				title: 'Task research',
				step: 'Building',
				status: 'Working',
				touched: ['agent.research-assistant'],
				hazards: []
			}
		]);
		expect(chart.unplaced).toBe(0);
	});

	it('raises Hazards ahead only for a task in restricted waters', async () => {
		const s = await project(registry({ bin: bin.ok }), 'acme');
		const card = s['harbour.card'];
		expect(card.title).toBe('Hazards ahead');
		if (!card.content.available) throw new Error(card.content.reason);
		expect(card.content.value as HazardsData).toEqual({
			hazards: [
				{
					taskId: 'pay',
					title: 'Task pay',
					step: 'Building',
					exhibits: [{ id: 'service.orders', title: 'Orders' }],
					restrictions: [
						{ id: 'constraint.pci-scope', title: 'Card data never touches Acme systems' }
					]
				}
			],
			chartHref: '/?project=acme&tab=docket%2Fchart'
		});

		const saved = changed.get('pay')!;
		changed.set('pay', ['README.md']);
		try {
			clearDocketCache();
			expect((await project(registry({ bin: bin.ok }), 'acme'))['harbour.card']).toBeUndefined();
		} finally {
			changed.set('pay', saved);
		}
	});

	it('pins “Waters this passage crosses” after Building', async () => {
		const s = await taskSlots(registry({ bin: bin.ok }), 'pay');
		const section = s['task.section'];
		expect(section).toMatchObject({
			title: 'Waters this passage crosses',
			step: 'building',
			render: { component: 'docket/waters' }
		});
		if (!section.content.available) throw new Error(section.content.reason);
		const w = section.content.value as WatersData;
		if (w.state !== 'waters') throw new Error(w.state);
		expect(w.join.touched).toEqual([
			{ id: 'service.orders', files: ['services/orders/src/payments/charge.ts'] }
		]);
		expect(w.join.restricted.map((r) => r.id)).toEqual([
			'constraint.pci-scope',
			'constraint.eu-data-residency'
		]);
		expect(w.exhibits['service.orders']).toEqual({ title: 'Orders', type: 'service' });
		expect(w.chartHref).toBe('/?project=acme&tab=docket%2Fchart&vessel=pay');
	});

	it('says plainly when an enabled project keeps no docket', async () => {
		const reg = registry(
			{ bin: bin.ok },
			{ docket: { projects: { plain: true }, settings: { bin: bin.ok } } }
		);
		const s = await project(reg, 'plain');
		expect(s['project.tab'].content).toMatchObject({
			available: true,
			value: { state: 'no-docket' }
		});
		expect(s['harbour.card']).toBeUndefined();
		expect(await taskSlots(reg, 'docs')).toEqual({});

		// docket's own "no .docket.yaml" answer reads the same way.
		clearDocketCache();
		const none = await project(
			registry({ bin: bin.none, roots: { acme: path.join(dir, 'plain') } }),
			'acme'
		);
		expect(none['project.tab'].content).toMatchObject({ value: { state: 'no-docket' } });
	});

	it('reads a docket the captain points it at', async () => {
		const reg = registry(
			{ bin: bin.ok, roots: { plain: '/somewhere/acme-platform', acme: 'relative/ignored' } },
			{
				docket: {
					projects: { plain: true },
					settings: { bin: bin.ok, roots: { plain: '/somewhere/acme-platform' } }
				}
			}
		);
		const tab = (await project(reg, 'plain'))['project.tab'];
		if (!tab.content.available) throw new Error(tab.content.reason);
		expect(tab.content.source).toBe(
			'the docket at /somewhere/acme-platform, set in Wheelhouse’s plugins file'
		);
		expect(tab.content.value).toMatchObject({
			state: 'chart',
			configuredRoot: '/somewhere/acme-platform',
			vessels: [{ taskId: 'docs', touched: ['service.orders'] }]
		});
	});

	it('keeps a failing docket to its own entries', async () => {
		const cases: [string, RegExp][] = [
			[bin.old, /cannot export its graph yet/],
			[bin.garbage, /not JSON/],
			[bin.missing, /could not find the docket CLI/]
		];
		for (const [b, reason] of cases) {
			clearDocketCache();
			const reg = registry({ bin: b }, { 'project-links': { enabled: true } });
			const entries = (await reg.slots({ scope: 'project', projectId: 'acme' })).entries;
			const s = bySlot(entries);
			expect(s['project.tab'].content).toEqual({
				available: false,
				reason: expect.stringMatching(reason)
			});
			expect(s['harbour.card']).toBeUndefined();
			expect(bySlot(entries, 'project-links')['project.tab'].content.available).toBe(true);
			const w = (await taskSlots(reg, 'pay'))['task.section'];
			expect(w.content).toMatchObject({ available: true, value: { state: 'unreadable' } });
		}
	});

	it('gives up on a docket that does not answer in time', async () => {
		const reg = registry({ bin: bin.slow, timeoutMs: 300 });
		const started = Date.now();
		const s = await project(reg, 'acme');
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(s['project.tab'].content).toEqual({
			available: false,
			reason: 'docket did not answer within 0.3 s.'
		});
	});

	it('keeps only absolute paths from its settings', () => {
		expect(
			readSettings({ bin: 'docket', roots: { a: 'rel', b: '/abs' }, timeoutMs: 60_000 })
		).toEqual({ bin: null, roots: { b: '/abs' }, timeoutMs: 9_500 });
		expect(readSettings({})).toEqual({ bin: null, roots: {}, timeoutMs: 8_000 });
	});
});
