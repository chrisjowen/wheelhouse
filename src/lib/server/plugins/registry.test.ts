import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, TaskSummary } from '../../types';
import type { BridgeCard, SlotEntry } from '../../plugins/types';
import { EMPTY_CONFIG, type PluginConfig } from './config';
import {
	checkManifest,
	MAX_TIMEOUT_MS,
	PluginRegistry,
	SUPPORTED_API_VERSIONS,
	type RegistryHost
} from './registry';
import { PLUGIN_API_VERSION, type Provider, type WheelhousePlugin } from './types';

const project = (id: string, p: Partial<Project> = {}): Project => ({
	id,
	name: id,
	description: null,
	path: null,
	passage: null,
	...p
});
const task = (id: string, projectId: string, t: Partial<TaskSummary> = {}) =>
	({ id, projectId, title: `Task ${id}`, status: 'working', pr: null, ...t }) as TaskSummary;

const text = (s: string) => [{ block: 'text.v1', text: s }];
const ok = (value: unknown) => ({
	available: true as const,
	value,
	source: 'a test',
	observedAt: null
});

function plugin(o: Partial<WheelhousePlugin> & { id: string }): WheelhousePlugin {
	return {
		apiVersion: PLUGIN_API_VERSION,
		name: o.id,
		version: '1.0.0',
		enabledByDefault: true,
		providers: [],
		contributions: [],
		...o
	};
}

function host(
	o: Partial<RegistryHost> & {
		config?: () => Promise<{ config: PluginConfig; error: string | null }>;
	} = {}
): RegistryHost {
	return {
		fleet: () => ({
			projects: [project('alpha'), project('beta')],
			tasks: [task('a-1', 'alpha'), task('b-1', 'beta')]
		}),
		worktree: () => null,
		config: async () => ({ config: EMPTY_CONFIG, error: null }),
		...o
	};
}

/** A plugin with one provider and one contribution in the given slot. */
function simple(id: string, provider: Partial<Provider>, slot: SlotEntry['slot'] = 'project.tab') {
	return plugin({
		id,
		providers: [
			{ id: 'p', scope: 'project', ttlMs: 60_000, fetch: async () => ok(text(id)), ...provider }
		],
		contributions: [
			{
				slot,
				id: 'c',
				title: id,
				provider: 'p',
				render: { blocks: true },
				...(slot === 'step.evidence' ? { placement: { step: 'pr' } } : {})
			}
		]
	});
}

describe('manifest checks and contract versions', () => {
	it('supports the current contract', () => {
		expect(SUPPORTED_API_VERSIONS).toContain(PLUGIN_API_VERSION);
	});

	it('refuses a plugin written for a contract it does not support, and says why', async () => {
		const future = simple('future', {});
		future.apiVersion = PLUGIN_API_VERSION + 1;
		const reg = new PluginRegistry([future, simple('fine', {})], host());
		const [refused, loaded] = reg.status();
		expect(refused).toMatchObject({ id: 'future', state: 'refused' });
		expect(refused.reason).toContain(`plugin contract ${PLUGIN_API_VERSION + 1}`);
		expect(loaded).toMatchObject({ id: 'fine', state: 'loaded', reason: null });
		// A refused plugin contributes nothing; the others still do.
		const view = await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(view.entries.map((e) => e.pluginId)).toEqual(['fine']);
	});

	it('refuses contract 0 and versions below the supported range', () => {
		const old = simple('old', {});
		old.apiVersion = 0;
		expect(checkManifest(old, new Set())).toContain('plugin contract 0');
	});

	it('refuses malformed manifests', () => {
		const taken = new Set(['dup']);
		expect(checkManifest(simple('Bad Id', {}), taken)).toContain('id');
		expect(checkManifest(simple('dup', {}), taken)).toContain('already uses');
		expect(checkManifest({ ...simple('v', {}), version: 'one' }, taken)).toContain('semantic');
		const missing = simple('m', {});
		missing.contributions[0].provider = 'nope';
		expect(checkManifest(missing, taken)).toContain('does not declare');
		const wide = simple('w', { scope: 'task' });
		expect(checkManifest(wide, taken)).toContain('task provider in project.tab');
		for (const f of ['', '/etc/x', '../x', 'a/../../x']) {
			expect(checkManifest({ ...simple('f', {}), enabledWhenFile: f }, taken)).toContain(
				'enabledWhenFile'
			);
		}
		expect(
			checkManifest({ ...simple('f', {}), enabledWhenFile: '.docket.yaml' }, taken)
		).toBeNull();
		const nostep = simple('s', { scope: 'task' }, 'task.section');
		nostep.contributions[0].slot = 'step.evidence';
		expect(checkManifest(nostep, taken)).toContain('names no step');
		const card = simple('b', { scope: 'fleet' }, 'bridge.card');
		card.contributions[0].render = { component: 'b/x' };
		expect(checkManifest(card, taken)).toContain('blocks only');
		const slot = simple('u', {});
		(slot.contributions[0] as { slot: string }).slot = 'sidebar';
		expect(checkManifest(slot, taken)).toContain('unknown slot');
	});
});

describe('filling slots', () => {
	it('fills each scope with only its own slots', async () => {
		const p = plugin({
			id: 'all',
			providers: [
				{
					id: 'fleet',
					scope: 'fleet',
					ttlMs: 1000,
					fetch: async (c) =>
						ok([
							{
								key: 'k',
								title: 'K',
								mentions: ['https://x.test/a'],
								blocks: text(`${c.projects.length} projects`)
							}
						])
				},
				{
					id: 'proj',
					scope: 'project',
					ttlMs: 1000,
					fetch: async (c) => ok(text(`${c.project!.id}: ${c.tasks.map((t) => t.id).join(',')}`))
				},
				{
					id: 'task',
					scope: 'task',
					ttlMs: 1000,
					fetch: async (c) => ok(text(`${c.task!.id} in ${c.project!.id}`))
				}
			],
			contributions: [
				{
					slot: 'bridge.card',
					id: 'card',
					title: 'Card',
					provider: 'fleet',
					render: { blocks: true }
				},
				{
					slot: 'project.tab',
					id: 'tab',
					title: 'Tab',
					provider: 'proj',
					render: { blocks: true }
				},
				{
					slot: 'harbour.card',
					id: 'hc',
					title: 'HC',
					provider: 'proj',
					render: { component: 'all/x' }
				},
				{
					slot: 'task.section',
					id: 'sec',
					title: 'Sec',
					provider: 'task',
					placement: { order: 250 },
					render: { blocks: true }
				},
				{
					slot: 'step.evidence',
					id: 'ev',
					title: 'Ev',
					provider: 'task',
					placement: { step: 'pr' },
					render: { blocks: true }
				}
			]
		});
		const reg = new PluginRegistry([p], host());

		const fleet = await reg.slots({ scope: 'fleet' });
		expect(fleet.entries.map((e) => e.slot)).toEqual(['bridge.card']);
		const cards = fleet.entries[0].content as { available: true; value: BridgeCard[] };
		expect(cards.value[0].blocks).toEqual(text('2 projects'));

		const proj = await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(proj.entries.map((e) => [e.slot, e.key])).toEqual([
			['harbour.card', 'all/hc@alpha'],
			['project.tab', 'all/tab@alpha']
		]);
		expect(proj.entries[1].content).toMatchObject({ available: true, value: text('alpha: a-1') });

		const t = await reg.slots({ scope: 'task', taskId: 'b-1' });
		expect(t.entries.map((e) => [e.slot, e.order, e.step])).toEqual([
			['task.section', 250, null],
			['step.evidence', 500, 'pr']
		]);
		expect(t.entries[0].content).toMatchObject({ value: text('b-1 in beta') });
	});

	it('returns nothing for an unknown project or task', async () => {
		const reg = new PluginRegistry([simple('x', {})], host());
		expect((await reg.slots({ scope: 'project', projectId: 'nope' })).entries).toEqual([]);
		expect((await reg.slots({ scope: 'task', taskId: 'nope' })).entries).toEqual([]);
	});

	it('validates blocks: unknown types fall back, unsafe links lose their URL', async () => {
		const reg = new PluginRegistry(
			[
				simple('v', {
					fetch: async () =>
						ok([
							{
								block: 'links.v1',
								links: [
									{ label: 'bad', href: 'javascript:alert(1)' },
									{ label: 'good', href: 'https://ok.test/' }
								]
							},
							{ block: 'chart.v9', data: 1 }
						])
				})
			],
			host()
		);
		const [e] = (await reg.slots({ scope: 'project', projectId: 'alpha' })).entries;
		expect(e.content).toMatchObject({
			available: true,
			value: [
				{ block: 'links.v1', links: [{ label: 'good', href: 'https://ok.test/' }] },
				{ block: 'unknown', type: 'chart.v9' }
			]
		});
	});

	it('hides a provider-available entry while its provider has nothing', async () => {
		const p = simple('quiet', { fetch: async () => ({ available: false, reason: 'nothing yet' }) });
		const reg = new PluginRegistry([p], host());
		expect((await reg.slots({ scope: 'project', projectId: 'alpha' })).entries[0].content).toEqual({
			available: false,
			reason: 'nothing yet'
		});
		p.contributions[0].when = 'provider-available';
		const reg2 = new PluginRegistry([p], host());
		expect((await reg2.slots({ scope: 'project', projectId: 'alpha' })).entries).toEqual([]);
	});

	it('runs a provider once per ttl and shares it between contributions', async () => {
		let calls = 0;
		let now = 0;
		const p = simple('cached', { ttlMs: 1000, fetch: async () => (calls++, ok(text('x'))) });
		p.contributions.push({ ...p.contributions[0], id: 'c2', slot: 'harbour.card' });
		const reg = new PluginRegistry([p], host({ now: () => now }));
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(calls).toBe(1);
		now = 999;
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(calls).toBe(1);
		now = 1000;
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(calls).toBe(2);
		await reg.slots({ scope: 'project', projectId: 'beta' });
		expect(calls).toBe(3);
	});

	it('gives providers copies, so a provider cannot change the fleet', async () => {
		const fleet = { projects: [project('alpha')], tasks: [task('a-1', 'alpha')] };
		const p = simple('mut', {
			fetch: async (c) => {
				c.tasks[0].title = 'changed';
				c.project!.name = 'changed';
				return ok(text('x'));
			}
		});
		await new PluginRegistry([p], host({ fleet: () => fleet })).slots({
			scope: 'project',
			projectId: 'alpha'
		});
		expect(fleet.tasks[0].title).toBe('Task a-1');
		expect(fleet.projects[0].name).toBe('alpha');
	});
});

describe('error isolation', () => {
	it('a plugin that throws, hangs or returns junk never breaks the others', async () => {
		const reg = new PluginRegistry(
			[
				simple('throws', {
					fetch: async () => {
						throw new Error('kaboom');
					}
				}),
				simple('sync-throws', {
					fetch: () => {
						throw new Error('sync kaboom');
					}
				}),
				simple('hangs', { timeoutMs: 50, fetch: () => new Promise(() => {}) }),
				simple('junk', { fetch: async () => 'not available' as never }),
				simple('cyclic', {
					fetch: async () => {
						const a: Record<string, unknown> = {};
						a.a = a;
						return ok(a);
					}
				}),
				simple('notblocks', { fetch: async () => ok({ not: 'a list' }) }),
				simple('fine', {})
			],
			host()
		);
		const started = Date.now();
		const { entries } = await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(Date.now() - started).toBeLessThan(2000);
		const by = Object.fromEntries(entries.map((e) => [e.pluginId, e.content]));
		expect(by.throws).toEqual({ available: false, reason: 'The throws plugin failed: kaboom' });
		expect(by['sync-throws']).toEqual({
			available: false,
			reason: 'The sync-throws plugin failed: sync kaboom'
		});
		expect(by.hangs).toEqual({
			available: false,
			reason: 'The hangs plugin did not answer within 50 ms.'
		});
		expect(by.junk).toMatchObject({
			available: false,
			reason: expect.stringContaining('does not understand')
		});
		expect(by.cyclic).toMatchObject({
			available: false,
			reason: expect.stringContaining('cannot show')
		});
		expect(by.notblocks).toMatchObject({
			available: false,
			reason: expect.stringContaining('list of blocks')
		});
		expect(by.fine).toMatchObject({ available: true, value: text('fine') });
	});

	it('aborts a timed-out call and caps the timeout', async () => {
		let aborted = false;
		const reg = new PluginRegistry(
			[
				simple('slow', {
					timeoutMs: 20,
					fetch: (c) =>
						new Promise(() => c.signal.addEventListener('abort', () => (aborted = true)))
				})
			],
			host()
		);
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(aborted).toBe(true);
		expect(MAX_TIMEOUT_MS).toBe(10_000);
	});

	it('retries a failure sooner than a long ttl', async () => {
		let calls = 0;
		let now = 0;
		const reg = new PluginRegistry(
			[
				simple('flaky', {
					ttlMs: 3_600_000,
					fetch: async () => (calls++, { available: false, reason: 'down' })
				})
			],
			host({ now: () => now })
		);
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		now = 15_000;
		await reg.slots({ scope: 'project', projectId: 'alpha' });
		expect(calls).toBe(2);
	});

	it('keeps working when the plugins file cannot be read', async () => {
		const reg = new PluginRegistry(
			[simple('x', {})],
			host({
				config: async () => {
					throw new Error('disk gone');
				}
			})
		);
		expect((await reg.slots({ scope: 'project', projectId: 'alpha' })).entries).toHaveLength(1);
		expect((await reg.view()).config.error).toBe('disk gone');
	});
});

describe('per-project enablement', () => {
	const config = (c: PluginConfig) => async () => ({ config: c, error: null });

	it('follows the project setting, then the plugin setting, then the default', async () => {
		const on = simple('on', {});
		const off = { ...simple('off', {}), enabledByDefault: false };
		const reg = new PluginRegistry(
			[on, off],
			host({
				config: config({
					plugins: {
						on: { projects: { beta: false } },
						off: { enabled: true, projects: { alpha: false } }
					}
				})
			})
		);
		const ids = async (projectId: string) =>
			(await reg.slots({ scope: 'project', projectId })).entries.map((e) => e.pluginId);
		expect(await ids('alpha')).toEqual(['on']);
		expect(await ids('beta')).toEqual(['off']);
		expect((await reg.view()).enabled).toEqual({ alpha: ['on'], beta: ['off'] });
	});

	it('can be on by default only where a project’s clone has a file', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'wh-plugin-when-'));
		try {
			mkdirSync(path.join(dir, 'a'));
			mkdirSync(path.join(dir, 'b'));
			writeFileSync(path.join(dir, 'a', '.marker'), '');
			const p = { ...simple('w', {}), enabledByDefault: true, enabledWhenFile: '.marker' };
			const fleet = () => ({
				projects: [
					project('alpha', { path: path.join(dir, 'a') }),
					project('beta', { path: path.join(dir, 'b') }),
					project('gamma')
				],
				tasks: [task('a-1', 'alpha'), task('b-1', 'beta')]
			});
			const reg = new PluginRegistry([p], host({ fleet }));
			expect((await reg.view()).enabled).toEqual({ alpha: ['w'], beta: [], gamma: [] });
			expect(reg.status()[0].enabledWhenFile).toBe('.marker');
			const forced = new PluginRegistry(
				[p],
				host({
					fleet,
					config: config({ plugins: { w: { projects: { beta: true, alpha: false } } } })
				})
			);
			expect((await forced.view()).enabled).toEqual({ alpha: [], beta: ['w'], gamma: [] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('task slots follow the task’s project; fleet providers see only enabled projects', async () => {
		const seen: string[][] = [];
		const p = plugin({
			id: 'p',
			providers: [
				{ id: 't', scope: 'task', ttlMs: 1, fetch: async () => ok(text('t')) },
				{
					id: 'f',
					scope: 'fleet',
					ttlMs: 1,
					fetch: async (c) => (seen.push(c.projects.map((x) => x.id)), ok([]))
				}
			],
			contributions: [
				{ slot: 'task.section', id: 's', title: 'S', provider: 't', render: { blocks: true } },
				{ slot: 'bridge.card', id: 'b', title: 'B', provider: 'f', render: { blocks: true } }
			]
		});
		const reg = new PluginRegistry(
			[p],
			host({ config: config({ plugins: { p: { projects: { alpha: false } } } }) })
		);
		expect((await reg.slots({ scope: 'task', taskId: 'a-1' })).entries).toEqual([]);
		expect((await reg.slots({ scope: 'task', taskId: 'b-1' })).entries).toHaveLength(1);
		await reg.slots({ scope: 'fleet' });
		expect(seen).toEqual([['beta']]);

		const none = new PluginRegistry(
			[p],
			host({ config: config({ plugins: { p: { enabled: false } } }) })
		);
		expect((await none.slots({ scope: 'fleet' })).entries).toEqual([]);
	});
});

describe('provider context', () => {
	let dir: string;
	let clone: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-plugin-ctx-'));
		clone = path.join(dir, 'clone');
		mkdirSync(path.join(clone, 'docs'), { recursive: true });
		writeFileSync(path.join(clone, 'docs', 'a.md'), 'hello from a');
		writeFileSync(path.join(dir, 'secret.txt'), 'outside');
		symlinkSync(path.join(dir, 'secret.txt'), path.join(clone, 'escape.txt'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const fleet = () => ({
		projects: [project('alpha', { path: clone }), project('bare')],
		tasks: [task('a-1', 'alpha')]
	});

	it('reads files only inside the clone, bounded', async () => {
		const reads: (string | null)[] = [];
		const p = simple('r', {
			fetch: async (c) => {
				for (const rel of [
					'docs/a.md',
					'../secret.txt',
					'escape.txt',
					'/etc/hosts',
					'missing.md',
					'docs'
				]) {
					reads.push(await c.readFile(rel, { root: 'project', maxBytes: 5 }));
				}
				reads.push(await c.readFile('docs/a.md', { root: 'task', maxBytes: 100 }));
				return ok([]);
			}
		});
		await new PluginRegistry([p], host({ fleet })).slots({ scope: 'project', projectId: 'alpha' });
		expect(reads).toEqual(['hello', null, null, null, null, null, null]);
	});

	it('runs commands without a shell in the clone, with a minimal environment', async () => {
		const out: unknown[] = [];
		const p = simple('e', {
			fetch: async (c) => {
				out.push(await c.exec({ argv: ['pwd'], cwd: 'project', timeoutMs: 2000, maxBytes: 1000 }));
				out.push(
					await c.exec({
						argv: ['sh', '-c', 'echo $WHEELHOUSE_SECRET'],
						cwd: 'project',
						timeoutMs: 2000,
						maxBytes: 1000
					})
				);
				out.push(
					await c.exec({
						argv: ['echo', '$(whoami)'],
						cwd: 'project',
						timeoutMs: 2000,
						maxBytes: 1000
					})
				);
				out.push(await c.exec({ argv: ['pwd'], cwd: 'task', timeoutMs: 2000, maxBytes: 1000 }));
				out.push(
					await c.exec({ argv: ['sleep', '5'], cwd: 'project', timeoutMs: 50, maxBytes: 1000 })
				);
				return ok([]);
			}
		});
		await new PluginRegistry(
			[p],
			host({ fleet, env: { ...process.env, WHEELHOUSE_SECRET: 'leak' } })
		).slots({
			scope: 'project',
			projectId: 'alpha'
		});
		expect((out[0] as { stdout: string }).stdout.trim()).toMatch(/clone$/);
		expect(out[1]).toEqual({ ok: true, stdout: '\n' });
		expect(out[2]).toEqual({ ok: true, stdout: '$(whoami)\n' });
		expect(out[3]).toMatchObject({ ok: false, reason: 'there is no task directory to run in' });
		expect(out[4]).toMatchObject({ ok: false, reason: expect.stringContaining('timed out') });
	});

	it('hands a provider its settings, and changed files for its own tasks only', async () => {
		const seen: unknown[] = [];
		const p = simple('s', {
			fetch: async (c) => {
				seen.push({ ...c.settings });
				c.settings.mutated = true;
				seen.push(await c.changedFiles('a-1'), await c.changedFiles('b-1'));
				seen.push(
					await c.exec({
						argv: ['sh', '-c', 'echo oops >&2; exit 3'],
						cwd: 'project',
						timeoutMs: 2000,
						maxBytes: 1000
					})
				);
				return ok([]);
			}
		});
		const settings = { bin: '/x/docket' };
		await new PluginRegistry(
			[p],
			host({
				fleet: () => ({
					projects: [project('alpha', { path: clone }), project('beta')],
					tasks: [task('a-1', 'alpha'), task('b-1', 'beta')]
				}),
				changedFiles: async (id) => [`${id}.ts`],
				config: async () => ({ config: { plugins: { s: { settings } } }, error: null })
			})
		).slots({ scope: 'project', projectId: 'alpha' });
		expect(seen).toEqual([
			{ bin: '/x/docket' },
			['a-1.ts'],
			null,
			{ ok: false, reason: 'exited with code 3', stdout: '', stderr: 'oops\n' }
		]);
		expect(settings).toEqual({ bin: '/x/docket' });
	});

	it('lets a fleet provider name a visible project, and no other', async () => {
		const out: unknown[] = [];
		const p = plugin({
			id: 'f',
			providers: [
				{
					id: 'f',
					scope: 'fleet',
					ttlMs: 1,
					fetch: async (c) => {
						out.push(
							await c.readFile('docs/a.md', { root: 'project', maxBytes: 100, project: 'alpha' })
						);
						out.push(await c.readFile('docs/a.md', { root: 'project', maxBytes: 100 }));
						out.push(
							await c.readFile('docs/a.md', { root: 'project', maxBytes: 100, project: 'bare' })
						);
						return ok([]);
					}
				}
			],
			contributions: [
				{ slot: 'bridge.card', id: 'b', title: 'B', provider: 'f', render: { blocks: true } }
			]
		});
		await new PluginRegistry([p], host({ fleet })).slots({ scope: 'fleet' });
		expect(out).toEqual(['hello from a', null, null]);
	});
});
