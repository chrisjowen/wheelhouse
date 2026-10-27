import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, TaskSummary } from '../../types';
import type { BridgeCard, SlotEntry } from '../../plugins/types';
import { writeInstalled } from './installed';
import {
	bundledPluginsDir,
	loadBundledPlugins,
	loadInstalledPlugins,
	type LoadedPlugins
} from './loader';
import { PluginRegistry } from './registry';

/** The plugins bundled with Wheelhouse, loaded from `plugins/` as the server loads them. */

const BUNDLED = path.resolve('plugins');
const on = async () => ({
	config: { plugins: { 'project-links': { enabled: true } } },
	error: null
});

describe('the bundled plugins directory', () => {
	it('is the variable the CLI sets, else plugins in the working directory', () => {
		expect(bundledPluginsDir({ WHEELHOUSE_BUNDLED_PLUGINS_DIR: '/opt/wh/plugins' })).toBe(
			'/opt/wh/plugins'
		);
		expect(bundledPluginsDir({})).toBe(BUNDLED);
	});

	it('says when it cannot be read', async () => {
		expect(await loadBundledPlugins(path.join(BUNDLED, 'missing'))).toMatchObject({
			installed: [],
			error: expect.stringContaining('could not read')
		});
	});
});

describe('webUrl', () => {
	it('turns GitHub-style remotes into browser URLs without credentials', async () => {
		const { webUrl } = (await import(
			pathToFileURL(path.join(BUNDLED, 'project-links/wheelhouse/server/index.js')).href
		)) as { webUrl: (remote: string) => string | null };
		expect(webUrl('git@github.com:chrisjowen/wheelhouse.git\n')).toBe(
			'https://github.com/chrisjowen/wheelhouse'
		);
		expect(webUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r');
		expect(webUrl('https://user:token@github.com/o/r')).toBe('https://github.com/o/r');
		expect(webUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r');
		expect(webUrl('/srv/git/r.git')).toBeNull();
		expect(webUrl('file:///srv/git/r.git')).toBeNull();
		expect(webUrl('https://github.com/o/r/extra')).toBeNull();
	});
});

describe('Project links, bundled, through every slot', () => {
	let dir: string;
	let bundled: LoadedPlugins;
	let reg: PluginRegistry;
	const fleet = { projects: [] as Project[], tasks: [] as TaskSummary[] };

	beforeAll(async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-project-links-'));
		execFileSync('git', ['init', '-q', dir]);
		execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:o/r.git']);
		writeFileSync(path.join(dir, 'README.md'), '# Harbour Docs\n\nText.\n');
		fleet.projects.push({
			id: 'docs',
			name: 'Harbour docs',
			description: 'The docs site',
			posture: null,
			registered: true,
			path: dir,
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
		bundled = await loadBundledPlugins(BUNDLED);
		reg = new PluginRegistry(
			[],
			{ fleet: () => fleet, worktree: () => null, config: on },
			{ plugins: bundled.installed, problems: bundled.problems }
		);
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const by = (entries: SlotEntry[]) => Object.fromEntries(entries.map((e) => [e.slot, e]));

	it('loads as built in, off by default, with no repository or commit', () => {
		expect(bundled).toMatchObject({ problems: [], error: null });
		expect(reg.status()).toEqual([
			expect.objectContaining({
				id: 'project-links',
				state: 'loaded',
				source: 'builtin',
				repository: null,
				commit: null,
				enabledByDefault: false,
				slots: ['project.tab', 'harbour.card', 'task.section', 'step.evidence', 'bridge.card']
			})
		]);
		expect(reg.uiDir('project-links')).toBe(path.join(BUNDLED, 'project-links/wheelhouse/ui'));
	});

	it('fills the project tab and the Harbour card, drawn by its element', async () => {
		const s = by((await reg.slots({ scope: 'project', projectId: 'docs' })).entries);
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
				{
					block: 'table.v1',
					rows: [['Fix links', { text: '#3', href: 'https://github.com/o/r/pull/3' }, 'Open']]
				}
			]
		});
		expect(s['harbour.card']).toMatchObject({
			render: { element: 'project-links-summary' },
			ui: '/api/plugins/project-links/ui/index.js?v=0.2.0',
			content: {
				available: true,
				value: { repoUrl: 'https://github.com/o/r', readme: { title: 'Harbour Docs' } }
			}
		});
	});

	it('fills the task section and the Pull request step evidence', async () => {
		const s = by((await reg.slots({ scope: 'task', taskId: 'd-1' })).entries);
		expect(s['task.section'].content).toMatchObject({
			value: [
				{ block: 'status.v1', label: 'Pull request open' },
				{
					block: 'links.v1',
					links: expect.arrayContaining([
						{ label: 'Branch', href: 'https://github.com/o/r/tree/fm/d-1', note: 'fm/d-1' }
					])
				}
			]
		});
		expect(s['step.evidence']).toMatchObject({
			step: 'pr',
			content: {
				value: [{ block: 'links.v1', links: [{ href: 'https://github.com/o/r/compare/fm/d-1' }] }]
			}
		});
	});

	it('offers a Bridge card for a reply that links the repository', async () => {
		const [e] = (await reg.slots({ scope: 'fleet' })).entries;
		const cards = (e.content as { value: BridgeCard[] }).value;
		expect(cards).toMatchObject([
			{ key: 'docs', title: 'Harbour docs', mentions: ['https://github.com/o/r'] }
		]);
	});

	it('refuses an installed copy with the same id', async () => {
		const plugins = mkdtempSync(path.join(tmpdir(), 'wh-project-links-installed-'));
		try {
			cpSync(path.join(BUNDLED, 'project-links'), path.join(plugins, 'project-links'), {
				recursive: true
			});
			await writeInstalled(plugins, {
				schema: 'wheelhouse-installed-plugins.v1',
				plugins: {
					'project-links': {
						repository: 'acme/links',
						ref: null,
						commit: '0123456789abcdef0123456789abcdef01234567',
						version: '0.2.0',
						installedAt: '2026-10-27T10:00:00.000Z',
						enabled: true
					}
				}
			});
			const installed = await loadInstalledPlugins(plugins);
			const both = new PluginRegistry(
				[],
				{ fleet: () => fleet, worktree: () => null, config: on },
				{ plugins: [...bundled.installed, ...installed.installed] }
			);
			expect(both.status()).toMatchObject([
				{ id: 'project-links', source: 'builtin', state: 'loaded' },
				{
					id: 'project-links',
					source: 'installed',
					state: 'refused',
					reason: expect.stringContaining('another plugin already uses the id "project-links"')
				}
			]);
		} finally {
			rmSync(plugins, { recursive: true, force: true });
		}
	});
});

describe('Project links, when the remote lookup fails', () => {
	it('looks again next time instead of keeping the failure', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'wh-project-links-noremote-'));
		try {
			execFileSync('git', ['init', '-q', dir]);
			const fleet = {
				projects: [{ id: 'bare', name: 'Bare', description: null, path: dir }] as Project[],
				tasks: [] as TaskSummary[]
			};
			const bundled = await loadBundledPlugins(BUNDLED);
			const registry = () =>
				new PluginRegistry(
					[],
					{ fleet: () => fleet, worktree: () => null, config: on },
					{ plugins: bundled.installed }
				);
			const summary = async () =>
				(await registry().slots({ scope: 'project', projectId: 'bare' })).entries.find(
					(e) => e.slot === 'harbour.card'
				)?.content;

			expect(await summary()).toMatchObject({ value: { repoUrl: null } });
			execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:o/bare.git']);
			expect(await summary()).toMatchObject({ value: { repoUrl: 'https://github.com/o/bare' } });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
