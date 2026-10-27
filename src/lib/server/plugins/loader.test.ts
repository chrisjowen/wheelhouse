import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, TaskSummary } from '../../types';
import type { BridgeCard, SlotEntry } from '../../plugins/types';
import { writeInstalled, type InstalledRecord } from './installed';
import { loadInstalledPlugins, uiFile, type LoadedPlugins } from './loader';
import { PluginRegistry } from './registry';

const EXAMPLE = path.resolve('examples/project-links');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const rec = (o: Partial<InstalledRecord> = {}): InstalledRecord => ({
	repository: 'acme/plugin',
	ref: 'v1',
	commit: COMMIT,
	version: '0.1.0',
	installedAt: '2026-10-27T10:00:00.000Z',
	enabled: true,
	...o
});

/** A plugin directory with a manifest and a server entry of the given source. */
function fixture(dir: string, id: string, server: string, o: { name?: string; api?: number } = {}) {
	mkdirSync(path.join(dir, id, '.wheelhouse-plugin'), { recursive: true });
	writeFileSync(
		path.join(dir, id, '.wheelhouse-plugin', 'plugin.json'),
		JSON.stringify({
			name: o.name ?? id,
			version: '0.1.0',
			wheelhouse: {
				apiVersion: o.api ?? 1,
				server: 'server.mjs',
				contributions: [{ id: 'card', slot: 'harbour.card' }]
			}
		})
	);
	writeFileSync(path.join(dir, id, 'server.mjs'), server);
}

const CARD = `
	contributions: [{ slot: 'harbour.card', id: 'card', title: 'Card', provider: 'p', render: { blocks: true } }]`;

describe('loading installed plugins', () => {
	let dir: string;
	let loaded: LoadedPlugins;
	let reg: PluginRegistry;
	const fleet = { projects: [] as Project[], tasks: [] as TaskSummary[] };

	beforeAll(async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-plugins-'));
		cpSync(EXAMPLE, path.join(dir, 'project-links'), { recursive: true });
		fixture(dir, 'broken', `throw new Error('boom while importing');`);
		fixture(dir, 'hangs', `await new Promise(() => {}); export default {};`);
		fixture(dir, 'future', `export default {};`, { api: 2 });
		fixture(dir, 'misnamed', `export default {};`, { name: 'something-else' });
		fixture(dir, 'off', `throw new Error('never imported');`);
		fixture(
			dir,
			'flaky',
			`export default {
				providers: [{ id: 'p', scope: 'project', ttlMs: 0, fetch: async () => { throw new Error('provider broke'); } }],${CARD}
			};`
		);
		await writeInstalled(dir, {
			schema: 'wheelhouse-installed-plugins.v1',
			plugins: {
				'project-links': rec({ repository: 'chrisjowen/wheelhouse', version: '0.2.0' }),
				broken: rec(),
				hangs: rec(),
				future: rec(),
				misnamed: rec(),
				off: rec({ enabled: false }),
				flaky: rec(),
				gone: rec()
			}
		});
		loaded = await loadInstalledPlugins(dir, { timeoutMs: 500 });

		const clone = mkdtempSync(path.join(tmpdir(), 'wh-plugins-clone-'));
		execFileSync('git', ['init', '-q', clone]);
		execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'git@github.com:o/r.git']);
		writeFileSync(path.join(clone, 'README.md'), '# Harbour Docs\n\nText.\n');
		fleet.projects.push({
			id: 'docs',
			name: 'Harbour docs',
			description: 'The docs site',
			posture: null,
			registered: true,
			path: clone,
			passage: null
		});
		fleet.tasks.push({
			id: 'd-1',
			projectId: 'docs',
			title: 'Fix links',
			status: 'needs-review',
			branch: 'fm/d-1',
			pr: { url: 'https://github.com/o/r/pull/3', number: 3 },
			preview: null
		} as TaskSummary);
		reg = new PluginRegistry(
			[],
			{
				fleet: () => fleet,
				worktree: () => null,
				config: async () => ({
					config: { plugins: { 'project-links': { enabled: true }, flaky: { enabled: true } } },
					error: null
				})
			},
			{ dir, plugins: loaded.installed, problems: loaded.problems, error: loaded.error }
		);
	});
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
		if (fleet.projects[0]?.path) rmSync(fleet.projects[0].path, { recursive: true, force: true });
	});

	it('loads the good ones and reports each bad one with its reason, without stopping', () => {
		expect(loaded.installed.map((i) => i.plugin.id)).toEqual(['flaky', 'project-links']);
		const by = Object.fromEntries(reg.status().map((s) => [s.id, s]));
		expect(by['project-links']).toMatchObject({
			state: 'loaded',
			source: 'installed',
			repository: 'chrisjowen/wheelhouse',
			commit: COMMIT,
			version: '0.2.0'
		});
		expect(by.broken).toMatchObject({
			state: 'failed',
			reason: expect.stringContaining('its server entry failed to load: boom while importing')
		});
		expect(by.hangs).toMatchObject({
			state: 'failed',
			reason: expect.stringContaining('did not load within 500 ms')
		});
		expect(by.future).toMatchObject({
			state: 'failed',
			reason: expect.stringContaining('written for plugin contract 2')
		});
		expect(by.misnamed).toMatchObject({
			state: 'failed',
			reason: expect.stringContaining(
				'names it "something-else", but it is installed as "misnamed"'
			)
		});
		expect(by.gone).toMatchObject({
			state: 'failed',
			reason: expect.stringContaining('its manifest could not be read')
		});
		expect(by.off).toMatchObject({ state: 'disabled', reason: null });
	});

	it('shows the failures in the plugins view', async () => {
		const view = await reg.view();
		expect(view.installed).toEqual({ dir, error: null });
		expect(
			view.plugins
				.filter((p) => p.state === 'failed')
				.map((p) => p.id)
				.sort()
		).toEqual(['broken', 'future', 'gone', 'hangs', 'misnamed']);
	});

	it('contains a provider that throws to its own entry', async () => {
		const entries = (await reg.slots({ scope: 'project', projectId: 'docs' })).entries;
		expect(entries.find((e) => e.pluginId === 'flaky')?.content).toEqual({
			available: false,
			reason: 'The flaky plugin failed: provider broke'
		});
		expect(entries.find((e) => e.key === 'project-links/summary@docs')?.content.available).toBe(
			true
		);
	});

	it('reports an unreadable installed record instead of loading nothing quietly', async () => {
		const bad = mkdtempSync(path.join(tmpdir(), 'wh-plugins-bad-'));
		try {
			writeFileSync(path.join(bad, 'installed.json'), '{"schema":"nope"}');
			expect(await loadInstalledPlugins(bad)).toMatchObject({
				installed: [],
				error: expect.stringContaining('is not a wheelhouse-installed-plugins.v1 record')
			});
		} finally {
			rmSync(bad, { recursive: true, force: true });
		}
	});

	describe('the example Project links plugin, through every slot', () => {
		const slotsBy = (entries: SlotEntry[]) =>
			Object.fromEntries(
				entries.filter((e) => e.pluginId === 'project-links').map((e) => [e.slot, e])
			);

		it('fills the project tab with blocks and the Harbour card with its element', async () => {
			const s = slotsBy((await reg.slots({ scope: 'project', projectId: 'docs' })).entries);
			expect(s['project.tab'].content).toMatchObject({
				available: true,
				value: [
					{
						block: 'links.v1',
						links: [
							{ label: 'Repository', href: 'https://github.com/o/r' },
							{
								label: 'README',
								href: 'https://github.com/o/r/blob/HEAD/README.md',
								note: 'Harbour Docs'
							},
							{ label: 'Pull requests', href: 'https://github.com/o/r/pulls' }
						]
					},
					{ block: 'kv.v1' },
					{ block: 'table.v1' }
				]
			});
			expect(s['harbour.card']).toMatchObject({
				render: { element: 'project-links-summary' },
				ui: `/api/plugins/project-links/ui/index.js?v=0.2.0-${COMMIT.slice(0, 12)}`,
				content: {
					available: true,
					value: { repoUrl: 'https://github.com/o/r', readme: { title: 'Harbour Docs' } }
				}
			});
			expect(s['project.tab'].ui).toBeUndefined();
		});

		it('fills the task section and the Pull request step evidence', async () => {
			const s = slotsBy((await reg.slots({ scope: 'task', taskId: 'd-1' })).entries);
			expect(s['task.section'].content).toMatchObject({
				value: [{ block: 'status.v1', label: 'Pull request open' }, { block: 'links.v1' }]
			});
			expect(s['step.evidence']).toMatchObject({
				step: 'pr',
				content: {
					value: [{ block: 'links.v1', links: [{ href: 'https://github.com/o/r/compare/fm/d-1' }] }]
				}
			});
		});

		it('offers a Bridge card for a reply that links the repository', async () => {
			const s = slotsBy((await reg.slots({ scope: 'fleet' })).entries);
			expect((s['bridge.card'].content as { value: BridgeCard[] }).value).toMatchObject([
				{ key: 'docs', title: 'Harbour docs', mentions: ['https://github.com/o/r'] }
			]);
		});

		it('serves only files under its UI bundle’s directory', async () => {
			const ui = reg.uiDir('project-links')!;
			expect(ui).toBe(path.join(await realDir(dir), 'project-links', 'wheelhouse', 'ui'));
			expect(await uiFile(ui, 'index.js')).toBe(path.join(ui, 'index.js'));
			for (const rel of ['../server/index.js', '/etc/passwd', 'a//b.js', '', 'missing.js']) {
				expect(await uiFile(ui, rel), rel).toBeNull();
			}
			symlinkSync(path.join(dir, 'installed.json'), path.join(ui, 'escape.js'));
			expect(await uiFile(ui, 'escape.js')).toBeNull();
			expect(reg.uiDir('flaky')).toBeNull();
		});
	});
});

async function realDir(p: string) {
	const { realpath } = await import('node:fs/promises');
	return realpath(p);
}
