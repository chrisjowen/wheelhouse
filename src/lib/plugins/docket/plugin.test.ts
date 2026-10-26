import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PluginConfig } from '../../server/plugins/config';
import { ServicePorts } from '../../server/plugins/ports';
import { PluginRegistry } from '../../server/plugins/registry';
import { ServiceManager } from '../../server/plugins/services';
import type { Project, TaskSummary } from '../../types';
import { projectLinks } from '../project-links/plugin.server';
import type { ServiceSpec, SlotEntry } from '../types';
import { ACME_FILE } from './fixtures/acme';
import { clearDocketCache, docket, preferredPort, readSettings } from './plugin.server';
import type { ChartData } from './types';

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
		{
			id: 'acme',
			name: 'Acme',
			description: null,
			posture: null,
			registered: true,
			path: path.join(dir, 'acme'),
			passage: null
		},
		{
			id: 'plain',
			name: 'Plain',
			description: null,
			posture: null,
			registered: true,
			path: path.join(dir, 'plain'),
			passage: null
		}
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
		host: fake(
			'docket-host',
			`process.stdout.write('Usage: docket open [options]\\n  --host <host>  address to listen on\\n  -p, --port <port>\\n');`
		),
		old: fake('docket-old', `console.error("error: unknown command 'graph'"); process.exit(1);`),
		oldJson: fake(
			'docket-old-json',
			`console.error("error: unknown option '--json'"); process.exit(1);`
		),
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
			slots: ['project.tab']
		});
		expect(await project(reg, 'plain')).toEqual({});
		expect(await taskSlots(reg, 'docs')).toEqual({});
	});

	it('declares the viewer as a service it shows but does not start', async () => {
		const sv = await registry({ bin: bin.ok, ports: { acme: 4999 } }).service(
			'docket',
			'viewer',
			'acme'
		);
		expect(sv?.title).toBe('docket’s viewer');
		if (!sv?.resolution.available) throw new Error('no viewer');
		expect(sv.resolution.spec).toMatchObject({
			url: 'http://127.0.0.1:4999',
			argv: [bin.ok, 'open', '--port', '4999', '--no-open'],
			cwd: path.join(dir, 'acme'),
			// docket open listens on every interface, so Wheelhouse never starts it.
			binds: 'all'
		});
		expect(sv.resolution.hint).toBe(`cd ${path.join(dir, 'acme')} && docket open --port 4999`);
		expect(sv.resolution.note).toContain('listens on every network interface');
		// A docket whose docket open takes --host is started on loopback alone.
		const host = await registry({ bin: bin.host, ports: { acme: 4999 } }).service(
			'docket',
			'viewer',
			'acme'
		);
		if (!host?.resolution.available) throw new Error('no viewer');
		expect(host.resolution.spec).toMatchObject({
			argv: [bin.host, 'open', '--host', '127.0.0.1', '--port', '4999', '--no-open'],
			binds: 'loopback'
		});
		expect(host.resolution.note).toBeNull();
		expect(host.resolution.hint).toBe(
			`cd ${path.join(dir, 'acme')} && docket open --host 127.0.0.1 --port 4999`
		);
		// Off for a project without a docket, and no such service for the fleet.
		expect((await registry({}).service('docket', 'viewer', 'plain'))?.resolution).toMatchObject({
			available: false
		});
		expect(await registry({}).service('docket', 'viewer', null)).toBeNull();
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

	it('adds only the Chart: no Harbour card and no task section', async () => {
		const reg = registry({ bin: bin.ok });
		expect(Object.keys(await project(reg, 'acme'))).toEqual(['project.tab']);
		expect(await taskSlots(reg, 'pay')).toEqual({});
		expect(docket.providers.map((p) => p.id)).toEqual(['chart']);
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
			[bin.old, /too old for the Chart\. Update docket\./],
			[bin.oldJson, /too old for the Chart\. Update docket\./],
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
			expect(bySlot(entries, 'project-links')['project.tab'].content.available).toBe(true);
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

	it('keeps only absolute paths and real ports from its settings', () => {
		expect(
			readSettings({
				bin: 'docket',
				roots: { a: 'rel', b: '/abs' },
				timeoutMs: 60_000,
				ports: { a: 4500, b: 80, c: 'x', d: 70_000 }
			})
		).toEqual({ bin: null, roots: { b: '/abs' }, timeoutMs: 9_500, ports: { a: 4500 } });
		expect(readSettings({})).toEqual({ bin: null, roots: {}, timeoutMs: 8_000, ports: {} });
	});
});

describe('the docket viewer’s port', () => {
	const fleet: Project[] = [];
	const ids = ['p65', 'p100'];
	const makeFleet = () => ids.map((id) => ({
		id,
		name: id,
		description: null,
		path: path.join(dir, id),
		passage: null
	}));
	let on: Record<string, boolean>;
	let ports: ServicePorts;
	const reg = () =>
		new PluginRegistry([docket], {
			fleet: () => ({ projects: fleet, tasks: [] }),
			worktree: () => null,
			config: async () => ({
				config: {
					plugins: { docket: { settings: { bin: bin.host }, projects: on } }
				} as PluginConfig,
				error: null
			}),
			servicePorts: ports
		});
	const viewer = async (id: string): Promise<ServiceSpec> => {
		const sv = await reg().service('docket', 'viewer', id);
		if (!sv?.resolution.available) throw new Error(`no viewer for ${id}`);
		return sv.resolution.spec;
	};

	let server: Server | null = null;
	afterAll(() => server?.close());

	it('keeps a project’s port when another project wanting the same one is turned on', async () => {
		fleet.push(...makeFleet());
		for (const p of fleet) mkdirSync(p.path!, { recursive: true });
		ports = new ServicePorts(path.join(dir, 'state', 'service-ports.json'));
		// p65 and p100 are worked out to the same port.
		expect(preferredPort('p65')).toBe(preferredPort('p100'));
		on = { p65: true, p100: false };
		const p65 = await viewer('p65');
		expect(p65.url).toBe(`http://127.0.0.1:${preferredPort('p65')}`);

		// p65's viewer runs, serving p65's docket.
		const port = Number(new URL(p65.url).port);
		server = createServer((req, res) => {
			res.setHeader('content-type', 'application/json');
			res.end(
				req.url === '/api/graph'
					? JSON.stringify({ project: { name: 'p65', root: p65.identity!.value } })
					: '{}'
			);
		});
		await new Promise<void>((r) => server!.listen(port, '127.0.0.1', r));

		on = { p65: true, p100: true };
		const p100 = await viewer('p100');
		expect((await viewer('p65')).url).toBe(p65.url);
		expect(p100.url).not.toBe(p65.url);
		// The same ports from a fresh start of Wheelhouse.
		ports = new ServicePorts(ports.file);
		expect((await viewer('p100')).url).toBe(p100.url);

		const m = new ServiceManager({ logDir: path.join(dir, 'state', 'services') });
		expect(await m.status('p65', p65)).toMatchObject({ state: 'running' });
		expect(await m.status('p100', p100)).toMatchObject({ state: 'stopped' });
		// Had p100 been given p65's port, p65's viewer would not read as p100's.
		const at = (spec: ServiceSpec, base: string): ServiceSpec => ({
			...spec,
			url: base,
			health: `${base}/api/adapters`,
			identity: { ...spec.identity!, url: `${base}/api/graph` }
		});
		expect(await m.status('p100', at(p100, p65.url))).toMatchObject({
			state: 'unavailable',
			reason: expect.stringContaining('Something else answers')
		});
	});
});
