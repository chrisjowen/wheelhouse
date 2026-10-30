import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project, TaskSummary } from '../../types';
import type { SlotEntry } from '../../plugins/types';
import { loadBundledPlugins, type LoadedPlugins } from './loader';
import { PluginRegistry } from './registry';

/**
 * The bundled Vault plugin, loaded as the server loads it from a package laid
 * out as Wheelhouse's is (plugins/vault beside dist/wh-vault.js), reading a
 * vault file and usage log through the real wh-vault CLI (built here from
 * cli/vault). The fixtures hold names only: the plugin and the commands it
 * runs never ask for a value. Its page is Wheelhouse's own `vault/overview`
 * panel, which only a plugin bundled with Wheelhouse may name.
 */

const BUNDLED = path.resolve('plugins');
const project = (id: string, dir: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: dir,
	passage: null
});

let root: string;
let cacheDir: string;
let bundled: LoadedPlugins;
const fleet = { projects: [] as Project[], tasks: [] as TaskSummary[] };
const savedConfigDir = process.env.WHEELHOUSE_CONFIG_DIR;

/** A package with the Vault plugin and `wh-vault` (the built one, other code, or none) in dist. */
async function packageWith(code: string | null): Promise<LoadedPlugins> {
	const dir = mkdtempSync(path.join(cacheDir, 'package-'));
	cpSync(path.join(BUNDLED, 'vault'), path.join(dir, 'plugins', 'vault'), { recursive: true });
	if (code !== null) {
		mkdirSync(path.join(dir, 'dist'));
		writeFileSync(path.join(dir, 'dist', 'wh-vault.js'), code);
	}
	return loadBundledPlugins(path.join(dir, 'plugins'));
}

function registry(loaded = bundled) {
	return new PluginRegistry(
		[],
		{
			fleet: () => fleet,
			worktree: () => null,
			home: () => root,
			config: async () => ({ config: { plugins: {} }, error: null })
		},
		{ plugins: loaded.installed, problems: loaded.problems }
	);
}

const vaultEntries = (entries: SlotEntry[]) => entries.filter((e) => e.pluginId === 'vault');
const values = (e: SlotEntry | undefined) => (e?.content as { value: unknown[] }).value;

beforeAll(async () => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-vault-plugin-'));
	// Inside the repository, so the bundle finds commander in node_modules.
	mkdirSync(path.resolve('node_modules/.cache'), { recursive: true });
	cacheDir = mkdtempSync(path.resolve('node_modules/.cache/wh-vault-test-'));
	const built = await build({
		entryPoints: [path.resolve('cli/vault/index.ts')],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		write: false,
		logLevel: 'silent'
	});
	bundled = await packageWith(built.outputFiles[0].text);
	fleet.projects.push(project('wheelhouse', root), project('casebook', root));
	fleet.tasks.push({ id: 'wh-1', projectId: 'wheelhouse', title: 'Ship it' } as TaskSummary);
	fleet.tasks.push({ id: 'wh-2', projectId: 'wheelhouse', title: 'Other' } as TaskSummary);
});
afterAll(() => {
	rmSync(root, { recursive: true, force: true });
	rmSync(cacheDir, { recursive: true, force: true });
	if (savedConfigDir === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
	else process.env.WHEELHOUSE_CONFIG_DIR = savedConfigDir;
});

let config: string;
beforeEach(() => {
	config = mkdtempSync(path.join(root, 'config-'));
	process.env.WHEELHOUSE_CONFIG_DIR = config;
});

function writeVault() {
	const dir = path.join(config, 'vault');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(
		path.join(dir, 'vault.json'),
		JSON.stringify({
			schema: 'wh-vault.v1',
			backend: 'keychain',
			secrets: {
				VERCEL_TOKEN: {
					projects: ['wheelhouse'],
					createdAt: '2026-10-28T09:00:00.000Z',
					updatedAt: '2026-10-28T09:30:00.000Z'
				},
				SUPABASE_TOKEN: {
					projects: [],
					createdAt: '2026-10-28T09:00:00.000Z',
					updatedAt: '2026-10-28T09:00:00.000Z'
				}
			}
		})
	);
	const line = (e: object) => JSON.stringify(e);
	writeFileSync(
		path.join(dir, 'audit.jsonl'),
		[
			line({
				at: '2026-10-28T09:00:00.000Z',
				event: 'set',
				names: ['VERCEL_TOKEN', 'SUPABASE_TOKEN'],
				task: null,
				project: null
			}),
			line({
				at: '2026-10-29T10:00:00.000Z',
				event: 'run',
				names: ['VERCEL_TOKEN'],
				task: 'wh-1',
				project: 'wheelhouse',
				program: 'vercel',
				outcome: 'ok',
				exit: 0,
				signal: null
			}),
			line({
				at: '2026-10-29T11:00:00.000Z',
				event: 'run',
				names: ['SUPABASE_TOKEN'],
				task: 'wh-1',
				project: 'wheelhouse',
				program: 'supabase',
				outcome: 'denied',
				reason: 'SUPABASE_TOKEN is not granted to wheelhouse'
			})
		].join('\n') + '\n'
	);
}

describe('the bundled Vault plugin', () => {
	it('loads as built in and on by default, with a page, a project tab and a task section', () => {
		expect(bundled.problems).toEqual([]);
		expect(registry().status()).toContainEqual(
			expect.objectContaining({
				id: 'vault',
				state: 'loaded',
				source: 'builtin',
				enabledByDefault: true,
				slots: ['nav.page', 'project.tab', 'task.section']
			})
		);
	});

	it('shows an empty Vault page, and runs nothing, while wh-vault holds no secrets', async () => {
		const marker = path.join(root, 'ran');
		const reg = registry(
			await packageWith(
				`import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '');\n`
			)
		);
		const [page] = vaultEntries((await reg.slots({ scope: 'fleet' })).entries);
		expect(page).toMatchObject({
			slot: 'nav.page',
			title: 'Vault',
			render: { component: 'vault/overview' },
			content: { available: true, value: { secrets: [], used: [], problem: null } }
		});
		expect(
			vaultEntries((await reg.slots({ scope: 'project', projectId: 'wheelhouse' })).entries)
		).toEqual([]);
		expect(vaultEntries((await reg.slots({ scope: 'task', taskId: 'wh-1' })).entries)).toEqual([]);
		expect(existsSync(marker)).toBe(false);
	});

	it('gives the Vault page names, grants, dates and recent use, marking known tasks', async () => {
		writeVault();
		const [page] = vaultEntries((await registry().slots({ scope: 'fleet' })).entries);
		expect(page).toMatchObject({
			slot: 'nav.page',
			title: 'Vault',
			render: { component: 'vault/overview' },
			content: { available: true }
		});
		const value = (page.content as { value: Record<string, unknown> }).value;
		expect(value.problem).toBeNull();
		expect(value.secrets).toEqual([
			{
				name: 'SUPABASE_TOKEN',
				projects: [],
				updatedAt: '2026-10-28T09:00:00.000Z',
				lastUsedAt: null
			},
			{
				name: 'VERCEL_TOKEN',
				projects: ['wheelhouse'],
				updatedAt: '2026-10-28T09:30:00.000Z',
				lastUsedAt: '2026-10-29T10:00:00.000Z'
			}
		]);
		expect(value.used).toEqual([
			{
				at: '2026-10-29T11:00:00.000Z',
				task: 'wh-1',
				taskKnown: true,
				project: 'wheelhouse',
				names: ['SUPABASE_TOKEN'],
				program: 'supabase',
				result: 'Refused: not granted'
			},
			{
				at: '2026-10-29T10:00:00.000Z',
				task: 'wh-1',
				taskKnown: true,
				project: 'wheelhouse',
				names: ['VERCEL_TOKEN'],
				program: 'vercel',
				result: 'Exit 0'
			}
		]);
	});

	it('reads the vault afresh as soon as the vault file changes', async () => {
		writeVault();
		const reg = registry();
		await reg.slots({ scope: 'fleet' });
		const file = path.join(config, 'vault', 'vault.json');
		writeFileSync(
			file,
			JSON.stringify({ schema: 'wh-vault.v1', backend: 'keychain', secrets: {} })
		);
		utimesSync(file, new Date(), new Date(Date.now() + 5_000));
		reg.forget('vault');
		const [page] = vaultEntries((await reg.slots({ scope: 'fleet' })).entries);
		expect((page.content as { value: { secrets: unknown[] } }).value.secrets).toEqual([]);
	});

	it('shows a project the secrets granted to it, and no tab where nothing is granted or used', async () => {
		writeVault();
		const reg = registry();
		const [tab] = vaultEntries(
			(await reg.slots({ scope: 'project', projectId: 'wheelhouse' })).entries
		);
		expect(tab).toMatchObject({
			slot: 'project.tab',
			title: 'Secrets',
			key: 'vault/secrets@wheelhouse'
		});
		const blocks = values(tab) as Record<string, unknown>[];
		expect(blocks[1]).toMatchObject({
			block: 'table.v1',
			columns: ['Secret', 'Value set', 'Last used'],
			rows: [['VERCEL_TOKEN', expect.any(String), expect.any(String)]]
		});
		expect(blocks[2]).toMatchObject({
			block: 'links.v1',
			links: [{ label: 'Change who can use them', href: '/plugins/vault/overview' }]
		});
		expect(
			vaultEntries((await reg.slots({ scope: 'project', projectId: 'casebook' })).entries)
		).toEqual([]);
	});

	it('lists the secrets a task used, and no section for a task that used none', async () => {
		writeVault();
		const reg = registry();
		const [section] = vaultEntries((await reg.slots({ scope: 'task', taskId: 'wh-1' })).entries);
		expect(section).toMatchObject({ slot: 'task.section', title: 'Secrets used' });
		expect((values(section) as Record<string, unknown>[])[1]).toMatchObject({
			columns: ['When', 'Secrets', 'Command', 'Result'],
			rows: [
				[expect.any(String), 'SUPABASE_TOKEN', 'supabase', 'Refused: not granted'],
				[expect.any(String), 'VERCEL_TOKEN', 'vercel', 'Exit 0']
			]
		});
		expect(vaultEntries((await reg.slots({ scope: 'task', taskId: 'wh-2' })).entries)).toEqual([]);
	});

	it('hides its entries when wh-vault cannot be run', async () => {
		writeVault();
		const reg = registry(await packageWith(null));
		expect(vaultEntries((await reg.slots({ scope: 'fleet' })).entries)).toEqual([]);
	});

	it('works out Wheelhouse’s config directory as Wheelhouse does', async () => {
		const { configDir } = (await import(
			pathToFileURL(path.join(BUNDLED, 'vault/wheelhouse/server/index.js')).href
		)) as { configDir: (env: NodeJS.ProcessEnv) => string };
		expect(configDir({ WHEELHOUSE_CONFIG_DIR: '/c/wh' })).toBe('/c/wh');
		expect(configDir({ XDG_CONFIG_HOME: '/x' })).toBe('/x/wheelhouse');
		expect(configDir({})).toMatch(/\.config\/wheelhouse$/);
	});
});
