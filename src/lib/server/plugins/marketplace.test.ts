import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL_REGISTRY_REPO, REGISTRY_SCHEMA } from '../../plugins/marketplace';
import type { Git } from './install';
import {
	fetchIcon,
	Marketplace,
	parseRegistriesConfig,
	readRegistries,
	readRegistry,
	REGISTRIES_FILE,
	registryId,
	RETRY_INTERVAL_MS,
	SYNC_INTERVAL_MS,
	type Fetcher
} from './marketplace';
import { NO_RECORD } from './registry-clones';

/**
 * The marketplace's logic against a stand-in git that "fetches" each
 * repository from a table of files; registry-clones.integration.test.ts runs
 * the clones against real repositories.
 */

const OFFICIAL_URL = `https://github.com/${OFFICIAL_REGISTRY_REPO}/blob/HEAD/wheelhouse-registry.json`;
const OFFICIAL_ID = registryId(OFFICIAL_REGISTRY_REPO, null, 'wheelhouse-registry.json');

const manifest = (name: string, plugins: string[]) =>
	JSON.stringify({
		schema: REGISTRY_SCHEMA,
		name,
		plugins: plugins.map((p) => ({
			name: p,
			description: `The ${p} plugin.`,
			repository: `acme/${p}`
		}))
	});

/** Each repository's files (by `org/repo`), or a failure git would print. */
type Repos = Record<string, Record<string, string> | { fail: string }>;

/**
 * A git that knows `repos`: a fetch of `org/repo` (cloned from `test:org/repo`)
 * remembers it, and a checkout writes its files. Counts the fetches; `hold`
 * keeps each fetch waiting until the function it returns is called.
 */
function fakeGit(repos: Repos): Git & { fetches: string[]; hold: () => () => void } {
	const fetched = new Map<string, string>();
	const fetches: string[] = [];
	let held: Promise<void> | null = null;
	const hold = () => {
		let release = () => {};
		held = new Promise((r) => (release = r));
		return () => {
			held = null;
			release();
		};
	};
	const git = async (args: string[], cwd: string) => {
		const cmd = args.find((a) => !a.startsWith('-') && !a.includes('='));
		if (cmd === 'init') {
			await mkdir(path.join(cwd, '.git'), { recursive: true });
			return { code: 0, stdout: '', stderr: '' };
		}
		if (cmd === 'fetch') {
			const url = args.find((a) => a.startsWith('test:'))!;
			const repo = url.slice('test:'.length);
			fetches.push(repo);
			if (held) await held;
			const r = repos[repo];
			if (!r) return { code: 128, stdout: '', stderr: 'remote: Repository not found.\n' };
			if ('fail' in r) return { code: 128, stdout: '', stderr: r.fail };
			fetched.set(cwd, repo);
			return { code: 0, stdout: '', stderr: '' };
		}
		if (cmd === 'checkout') {
			const r = repos[fetched.get(cwd)!] as Record<string, string>;
			for (const f of await listed(cwd)) await rm(path.join(cwd, f), { recursive: true });
			for (const [f, body] of Object.entries(r)) {
				await mkdir(path.dirname(path.join(cwd, f)), { recursive: true });
				await writeFile(path.join(cwd, f), body);
			}
			return { code: 0, stdout: '', stderr: '' };
		}
		if (cmd === 'rev-parse') return { code: 0, stdout: 'c0ffee\n', stderr: '' };
		return { code: 0, stdout: '', stderr: '' };
	};
	return Object.assign(git, { fetches, hold });
}

async function listed(dir: string): Promise<string[]> {
	const { readdir } = await import('node:fs/promises');
	return (await readdir(dir)).filter((f) => f !== '.git');
}

let dir: string;
let configDir: string;
let cacheDir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-marketplace-'));
	configDir = path.join(dir, 'config');
	cacheDir = path.join(dir, 'state', 'plugin-registries');
	await mkdir(configDir, { recursive: true });
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const market = (
	repos: Repos,
	o: {
		known?: () => Promise<{ id: string; repository: string | null }[]>;
		now?: () => number;
		fetch?: Fetcher;
	} = {}
) => {
	const git = fakeGit(repos);
	const m = new Marketplace({
		configDir,
		cacheDir,
		known: o.known ?? (async () => []),
		git,
		gitUrl: (repo) => `test:${repo}`,
		now: o.now,
		fetch: o.fetch
	});
	return { m, git };
};

const config = (registries: unknown[]) =>
	writeFile(path.join(configDir, REGISTRIES_FILE), JSON.stringify({ registries }));
const readConfig = async () =>
	JSON.parse(await readFile(path.join(configDir, REGISTRIES_FILE), 'utf8')) as {
		registries: unknown[];
	};

describe('the registries configuration', () => {
	it('is the official registry alone when there is no file', async () => {
		expect(await readRegistries(configDir)).toEqual({
			file: path.join(configDir, REGISTRIES_FILE),
			sources: [
				{
					id: OFFICIAL_ID,
					source: OFFICIAL_REGISTRY_REPO,
					url: OFFICIAL_URL,
					official: true,
					repo: OFFICIAL_REGISTRY_REPO,
					ref: null,
					file: 'wheelhouse-registry.json'
				}
			],
			error: null
		});
	});

	it('names GitHub repositories (at a ref and path), in order', () => {
		const r = parseRegistriesConfig(
			JSON.stringify({
				registries: [
					OFFICIAL_REGISTRY_REPO,
					{ repo: 'acme/plugins', ref: 'stable', path: 'reg/wheelhouse-registry.json' },
					'acme/plugins',
					'https://github.com/acme/plugins.git'
				]
			})
		);
		expect(r.ok && r.sources.map((s) => [s.source, s.url, s.official, s.ref, s.file])).toEqual([
			[OFFICIAL_REGISTRY_REPO, OFFICIAL_URL, true, null, 'wheelhouse-registry.json'],
			[
				'acme/plugins@stable',
				'https://github.com/acme/plugins/blob/stable/reg/wheelhouse-registry.json',
				false,
				'stable',
				'reg/wheelhouse-registry.json'
			],
			[
				'acme/plugins',
				'https://github.com/acme/plugins/blob/HEAD/wheelhouse-registry.json',
				false,
				null,
				'wheelhouse-registry.json'
			]
		]);
	});

	it('gives each registry a stable id, its clone’s directory', () => {
		const id = registryId('Acme/Plugins', null, 'wheelhouse-registry.json');
		expect(id).toMatch(/^acme--plugins-[0-9a-f]{10}$/);
		expect(registryId('acme/plugins', null, 'wheelhouse-registry.json')).toBe(id);
		expect(registryId('acme/plugins', 'v2', 'wheelhouse-registry.json')).not.toBe(id);
		expect(registryId('acme/plugins', null, 'x/wheelhouse-registry.json')).not.toBe(id);
	});

	it('may list no registries at all', () => {
		expect(parseRegistriesConfig('{"registries":[]}')).toEqual({ ok: true, sources: [] });
	});

	it('refuses an entry it cannot use, and then reads the official registry meanwhile', async () => {
		for (const [body, why] of [
			['nope', /not valid JSON/],
			['{}', /"registries" must be a list/],
			['{"registries":[3]}', /registries\[0\] must be/],
			['{"registries":[{"repo":"no"}]}', /registries\[0\] needs "repo"/],
			['{"registries":[{"url":"https://plugins.acme.test/r.json"}]}', /registries\[0\].*not "url"/],
			['{"registries":[{"url":"http://127.0.0.1:9000/r.json"}]}', /registries\[0\].*not "url"/],
			['{"registries":[{"repo":"a/b","path":"../x.json"}]}', /registries\[0\]\.path/],
			['{"registries":[{"repo":"a/b","ref":"-x"}]}', /registries\[0\]\.ref/]
		] as const) {
			expect(parseRegistriesConfig(body)).toMatchObject({
				ok: false,
				error: expect.stringMatching(why)
			});
		}
		await config([3]);
		const r = await readRegistries(configDir);
		expect(r.sources.map((s) => s.source)).toEqual([OFFICIAL_REGISTRY_REPO]);
		expect(r.error).toMatch(/^It is not valid: registries\[0\]/);
	});
});

describe('reading a registry from its clone', () => {
	const src = parseRegistriesConfig('{"registries":["acme/plugins"]}');
	const acme = src.ok ? src.sources[0] : (null as never);
	const official = {
		...acme,
		id: OFFICIAL_ID,
		source: OFFICIAL_REGISTRY_REPO,
		repo: OFFICIAL_REGISTRY_REPO,
		url: OFFICIAL_URL,
		official: true
	};
	const clone = async (files: Record<string, string>) => {
		const d = path.join(dir, 'clone');
		await mkdir(path.join(d, '.git'), { recursive: true });
		for (const [f, body] of Object.entries(files)) await writeFile(path.join(d, f), body);
		return d;
	};
	const synced = { ...NO_RECORD, syncedAt: 1_000, attemptedAt: 1_000 };

	it('lists its plugins and says what it is, and when it was synced', async () => {
		const d = await clone({ 'wheelhouse-registry.json': manifest('Acme', ['a', 'b']) });
		const r = await readRegistry(acme, d, synced);
		expect(r.view).toMatchObject({
			name: 'Acme',
			error: null,
			count: 2,
			skipped: [],
			syncedAt: new Date(1_000).toISOString(),
			syncError: null
		});
		expect(r.plugins.map((p) => p.name)).toEqual(['a', 'b']);
	});

	it('says why, without throwing, when it has no manifest or not a registry', async () => {
		const cases: [Record<string, string>, RegExp][] = [
			[{}, /no registry there: the repository has no wheelhouse-registry.json/],
			[{ 'wheelhouse-registry.json': '<html>' }, /not valid JSON/],
			[{ 'wheelhouse-registry.json': 'x'.repeat(1024 * 1024 + 1) }, /larger than 1 MB/]
		];
		for (const [files, why] of cases) {
			await rm(path.join(dir, 'clone'), { recursive: true, force: true });
			const r = await readRegistry(acme, await clone(files), synced);
			expect(r.plugins).toEqual([]);
			expect(r.view.error).toMatch(why);
		}
	});

	it('refuses a manifest that is a link out of the clone', async () => {
		const outside = path.join(dir, 'secret.json');
		await writeFile(outside, manifest('Secret', ['s']));
		const d = await clone({});
		await symlink(outside, path.join(d, 'wheelhouse-registry.json'));
		const r = await readRegistry(acme, d, synced);
		expect(r.view.error).toMatch(/leads out of the registry/);
	});

	it('is the sync’s failure when there is no clone', async () => {
		const r = await readRegistry(acme, path.join(dir, 'none'), {
			...NO_RECORD,
			attemptedAt: 1,
			error: 'It could not be fetched: Could not resolve host: github.com.'
		});
		expect(r.view).toMatchObject({ error: expect.stringMatching(/Could not resolve host/) });
	});

	it('shows the official registry as not published yet when it is not found', async () => {
		const notFound = { ...NO_RECORD, attemptedAt: 1, error: 'gone', notFound: true };
		const r = await readRegistry(official, path.join(dir, 'none'), notFound);
		expect(r.view).toMatchObject({ unpublished: true, error: null, count: 0 });
		const noFile = await readRegistry(official, await clone({}), synced);
		expect(noFile.view).toMatchObject({ unpublished: true, error: null });
		// Another failure of the official registry is a failure like any other's.
		const down = await readRegistry(official, path.join(dir, 'none'), {
			...notFound,
			notFound: false
		});
		expect(down.view).toMatchObject({ unpublished: false, error: 'gone' });
		// And another registry not found is a failure.
		expect((await readRegistry(acme, path.join(dir, 'none'), notFound)).view.error).toBe('gone');
	});
});

describe('fetching an icon', () => {
	it('is the image its extension says, or nothing when it fails or is too big', async () => {
		const f =
			(table: Record<string, string | number>): Fetcher =>
			async (url) => {
				const v = table[url];
				if (typeof v === 'number') return new Response('x', { status: v });
				return v === undefined ? new Response('', { status: 404 }) : new Response(v);
			};
		const png = 'https://i.test/a.png';
		expect(await fetchIcon(png, f({ [png]: 'PNG' }))).toMatchObject({ type: 'image/png' });
		expect(await fetchIcon(png, f({ [png]: 404 }))).toBeNull();
		expect(
			await fetchIcon(png, async () => {
				throw new Error('down');
			})
		).toBeNull();
		expect(await fetchIcon(png, f({ [png]: 'x'.repeat(256 * 1024 + 1) }))).toBeNull();
		expect(await fetchIcon('https://i.test/a.gif', f({}))).toBeNull();
	});
});

describe('the marketplace', () => {
	const reg = (name: string, plugins: string[]) => ({
		'wheelhouse-registry.json': manifest(name, plugins)
	});

	it('searches every registry, says which each plugin is from, and leaves out installed ones', async () => {
		await config([OFFICIAL_REGISTRY_REPO, 'acme/plugins', 'acme/broken']);
		const { m } = market(
			{
				[OFFICIAL_REGISTRY_REPO]: reg('Wheelhouse plugins', ['docket', 'improve']),
				'acme/plugins': reg('Acme', ['board', 'improve'])
			},
			{ known: async () => [{ id: 'docket', repository: 'chrisjowen/docket' }] }
		);
		const v = await m.view();
		expect(v.plugins.map((p) => [p.name, p.registry])).toEqual([
			['improve', OFFICIAL_REGISTRY_REPO],
			['board', 'acme/plugins']
		]);
		expect(v.installed).toBe(1);
		expect(v.registries.map((r) => [r.source, r.count, !!r.error])).toEqual([
			[OFFICIAL_REGISTRY_REPO, 2, false],
			['acme/plugins', 2, false],
			['acme/broken', 0, true]
		]);
		expect(v.registries[2].error).toMatch(/no such repository/);
		expect(v.config.error).toBeNull();
	});

	it('resyncs a registry once it is an hour old, at once on Resync, and not in between', async () => {
		let now = 1_000_000;
		const repos: Repos = { [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) };
		let known = [] as { id: string; repository: string | null }[];
		const { m, git } = market(repos, { known: async () => known, now: () => now });
		const first = await m.view();
		expect(first.plugins).toHaveLength(1);
		expect(first.registries[0].syncedAt).toBe(new Date(now).toISOString());
		known = [{ id: 'a', repository: 'acme/a' }];
		// An install shows at once, from the clone.
		expect((await m.view()).plugins).toHaveLength(0);
		expect(git.fetches).toHaveLength(1);
		known = [];
		repos[OFFICIAL_REGISTRY_REPO] = reg('W', ['a', 'b']);
		now += SYNC_INTERVAL_MS - 1;
		expect((await m.view()).plugins).toHaveLength(1);
		expect(git.fetches).toHaveLength(1);
		const resynced = await m.view({ refresh: true });
		expect(resynced.plugins).toHaveLength(2);
		expect(git.fetches).toHaveLength(2);
		now += SYNC_INTERVAL_MS;
		await m.view();
		await vi.waitFor(() => expect(git.fetches).toHaveLength(3));
	});

	it('keeps the last good copy when a resync fails, says why, and tries again sooner', async () => {
		let now = 1_000_000;
		const repos: Repos = { [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) };
		const { m, git } = market(repos, { now: () => now });
		await m.view();
		repos[OFFICIAL_REGISTRY_REPO] = {
			fail: 'fatal: unable to access: Could not resolve host: github.com\n'
		};
		now += 1000;
		const v = await m.view({ refresh: true });
		expect(v.plugins.map((p) => p.name)).toEqual(['a']);
		expect(v.registries[0]).toMatchObject({
			error: null,
			syncedAt: new Date(1_000_000).toISOString(),
			syncError: expect.stringMatching(/Could not resolve host/)
		});
		now += RETRY_INTERVAL_MS;
		await m.view();
		await vi.waitFor(() => expect(git.fetches).toHaveLength(3));
	});

	it('answers from the clone while a due resync runs in the background, one at a time', async () => {
		let now = 1_000_000;
		const repos: Repos = { [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) };
		const { m, git } = market(repos, { now: () => now });
		await m.view();
		repos[OFFICIAL_REGISTRY_REPO] = reg('W', ['a', 'b']);
		now += SYNC_INTERVAL_MS;
		const release = git.hold();
		const v = await m.view();
		expect(v.plugins.map((p) => p.name)).toEqual(['a']);
		expect(v.registries[0]).toMatchObject({
			syncing: true,
			syncedAt: new Date(1_000_000).toISOString()
		});
		await vi.waitFor(() => expect(git.fetches).toHaveLength(2));
		expect((await m.view()).registries[0].syncing).toBe(true);
		expect(git.fetches).toHaveLength(2);
		release();
		await vi.waitFor(async () => expect((await m.view()).registries[0].syncing).toBe(false));
		const after = await m.view();
		expect(after.plugins.map((p) => p.name)).toEqual(['a', 'b']);
		expect(after.registries[0].syncedAt).toBe(new Date(now).toISOString());
		expect(git.fetches).toHaveLength(2);
	});

	it('waits for the first clone, and for Resync', async () => {
		let now = 1_000_000;
		const repos: Repos = { [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) };
		const { m, git } = market(repos, { now: () => now });
		const answered = async (p: Promise<unknown>) => {
			let done = false;
			void p.then(() => (done = true));
			await new Promise((r) => setTimeout(r, 20));
			return done;
		};
		let release = git.hold();
		const first = m.view();
		expect(await answered(first)).toBe(false);
		release();
		expect((await first).registries[0]).toMatchObject({ syncing: false, count: 1 });

		repos[OFFICIAL_REGISTRY_REPO] = reg('W', ['a', 'b']);
		now += 1000;
		release = git.hold();
		const resync = m.view({ refresh: true });
		expect(await answered(resync)).toBe(false);
		release();
		const v = await resync;
		expect(v.plugins.map((p) => p.name)).toEqual(['a', 'b']);
		expect(v.registries[0]).toMatchObject({
			syncing: false,
			syncedAt: new Date(now).toISOString()
		});
	});

	it('remembers when each registry was synced across restarts', async () => {
		const now = 5_000_000;
		const repos: Repos = { [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) };
		await market(repos, { now: () => now }).m.view();
		const again = market(repos, { now: () => now + 60_000 });
		const v = await again.m.view();
		expect(again.git.fetches).toHaveLength(0);
		expect(v.registries[0].syncedAt).toBe(new Date(now).toISOString());
	});

	it('serves a listed plugin’s icon from the registry’s clone, and no file outside it', async () => {
		const body = JSON.stringify({
			schema: REGISTRY_SCHEMA,
			name: 'W',
			plugins: [
				{ name: 'a', description: 'A.', repository: 'acme/a', icon: 'icons/a.svg' },
				{ name: 'b', description: 'B.', repository: 'acme/b' },
				{ name: 'c', description: 'C.', repository: 'acme/c', icon: 'icons/c.png' }
			]
		});
		const { m } = market({
			[OFFICIAL_REGISTRY_REPO]: { 'wheelhouse-registry.json': body, 'icons/a.svg': '<svg/>' }
		});
		const v = await m.view();
		expect(v.plugins.map((p) => p.icon)).toEqual([
			'/api/plugins/marketplace/icon/a',
			null,
			'/api/plugins/marketplace/icon/c'
		]);
		const icon = await m.icon('a');
		expect(icon?.type).toBe('image/svg+xml');
		expect(new TextDecoder().decode(icon!.body)).toBe('<svg/>');
		expect(await m.icon('b')).toBeNull();
		expect(await m.icon('nope')).toBeNull();
		// An icon that is a link to a file elsewhere on this computer is no icon.
		const secret = path.join(dir, 'secret.png');
		await writeFile(secret, 'private');
		await symlink(secret, path.join(cacheDir, OFFICIAL_ID, 'icons', 'c.png'));
		expect(await m.icon('c')).toBeNull();
	});

	it('fetches an icon a registry names by an https address', async () => {
		const body = JSON.stringify({
			schema: REGISTRY_SCHEMA,
			name: 'W',
			plugins: [
				{ name: 'a', description: 'A.', repository: 'acme/a', icon: 'https://i.test/a.png' }
			]
		});
		const calls: string[] = [];
		const { m } = market(
			{ [OFFICIAL_REGISTRY_REPO]: { 'wheelhouse-registry.json': body } },
			{
				fetch: async (url) => {
					calls.push(url);
					return new Response('PNG');
				}
			}
		);
		await m.view();
		expect((await m.icon('a'))?.type).toBe('image/png');
		await m.icon('a');
		expect(calls).toEqual(['https://i.test/a.png']);
	});

	it('syncs once for requests that arrive together', async () => {
		const { m, git } = market({ [OFFICIAL_REGISTRY_REPO]: reg('W', ['a']) });
		await Promise.all([m.view(), m.view(), m.view()]);
		expect(git.fetches).toHaveLength(1);
	});
});

describe('changing the registries', () => {
	const repos: Repos = {
		[OFFICIAL_REGISTRY_REPO]: { 'wheelhouse-registry.json': manifest('Wheelhouse plugins', ['a']) },
		'acme/plugins': { 'wheelhouse-registry.json': manifest('Acme', ['board']) },
		'acme/empty': { 'README.md': 'nothing here' }
	};

	it('adds a registry by org/repo or its GitHub address, after the official one', async () => {
		const { m } = market(repos);
		expect(await m.addRegistry('https://github.com/acme/plugins')).toEqual({
			ok: true,
			source: 'acme/plugins'
		});
		expect((await readConfig()).registries).toEqual([OFFICIAL_REGISTRY_REPO, 'acme/plugins']);
		expect(
			existsSync(path.join(cacheDir, registryId('acme/plugins', null, 'wheelhouse-registry.json')))
		).toBe(true);
		const v = await m.view();
		expect(v.registries.map((r) => r.source)).toEqual([OFFICIAL_REGISTRY_REPO, 'acme/plugins']);
		expect(v.plugins.map((p) => [p.name, p.registry])).toEqual([
			['a', OFFICIAL_REGISTRY_REPO],
			['board', 'acme/plugins']
		]);
	});

	it('keeps the configuration’s other entries as they were', async () => {
		await writeFile(
			path.join(configDir, REGISTRIES_FILE),
			JSON.stringify({ note: 'mine', registries: [{ repo: OFFICIAL_REGISTRY_REPO }] })
		);
		const { m } = market(repos);
		expect((await m.addRegistry('acme/plugins')).ok).toBe(true);
		expect(await readConfig()).toEqual({
			note: 'mine',
			registries: [{ repo: OFFICIAL_REGISTRY_REPO }, 'acme/plugins']
		});
	});

	it('adds a branch named in the address as the registry’s ref', async () => {
		const { m } = market({ ...repos });
		expect(await m.addRegistry('github.com/acme/plugins/tree/stable')).toEqual({
			ok: true,
			source: 'acme/plugins@stable'
		});
		expect((await readConfig()).registries).toEqual([
			OFFICIAL_REGISTRY_REPO,
			{ repo: 'acme/plugins', ref: 'stable' }
		]);
	});

	it('refuses what is not a GitHub registry, and keeps nothing of it', async () => {
		const { m } = market(repos);
		for (const [input, why] of [
			['https://gitlab.com/acme/plugins', /gitlab\.com is not GitHub/],
			['not a repo', /Give a GitHub repository/],
			['', /Give a GitHub repository/],
			['acme/missing', /could not be added\. There is no such repository/],
			['acme/empty', /could not be added\. There is no registry there/],
			[OFFICIAL_REGISTRY_REPO, /already one of the registries/]
		] as const) {
			expect(await m.addRegistry(input)).toMatchObject({
				ok: false,
				error: expect.stringMatching(why)
			});
		}
		expect(existsSync(path.join(configDir, REGISTRIES_FILE))).toBe(false);
		expect(
			existsSync(path.join(cacheDir, registryId('acme/empty', null, 'wheelhouse-registry.json')))
		).toBe(false);
	});

	it('refuses to change a configuration that is not valid', async () => {
		await config([3]);
		const { m } = market(repos);
		expect(await m.addRegistry('acme/plugins')).toMatchObject({
			ok: false,
			error: expect.stringMatching(/is not valid .*fix it first/)
		});
		expect(await m.removeRegistry(OFFICIAL_ID)).toMatchObject({ ok: false });
	});

	it('removes a registry, the official one too, and forgets its clone', async () => {
		await config([OFFICIAL_REGISTRY_REPO, { repo: 'acme/plugins' }]);
		const { m } = market(repos);
		const v = await m.view();
		const acme = v.registries.find((r) => r.source === 'acme/plugins')!;
		expect(existsSync(path.join(cacheDir, acme.id))).toBe(true);
		expect(await m.removeRegistry(acme.id)).toEqual({ ok: true, source: 'acme/plugins' });
		expect((await readConfig()).registries).toEqual([OFFICIAL_REGISTRY_REPO]);
		expect(existsSync(path.join(cacheDir, acme.id))).toBe(false);
		expect(existsSync(path.join(cacheDir, `${acme.id}.json`))).toBe(false);
		expect(await m.removeRegistry(OFFICIAL_ID)).toEqual({
			ok: true,
			source: OFFICIAL_REGISTRY_REPO
		});
		expect((await readConfig()).registries).toEqual([]);
		expect((await m.view()).registries).toEqual([]);
		expect(await m.removeRegistry(OFFICIAL_ID)).toMatchObject({ ok: false });
		// And the official registry can be added back.
		expect((await m.addRegistry(OFFICIAL_REGISTRY_REPO)).ok).toBe(true);
	});

	it('waits for a registry’s running sync before forgetting its clone', async () => {
		await config([OFFICIAL_REGISTRY_REPO, 'acme/plugins']);
		let now = 1_000_000;
		const { m, git } = market(repos, { now: () => now });
		const acme = (await m.view()).registries[1];
		now += SYNC_INTERVAL_MS;
		const release = git.hold();
		await m.view();
		await vi.waitFor(() => expect(git.fetches).toContain('acme/plugins'));
		const removing = m.removeRegistry(acme.id);
		setTimeout(release, 20);
		expect(await removing).toEqual({ ok: true, source: 'acme/plugins' });
		expect(existsSync(path.join(cacheDir, acme.id))).toBe(false);
		expect(existsSync(path.join(cacheDir, `${acme.id}.json`))).toBe(false);
	});

	it('removes from the default (no file) by writing the configuration', async () => {
		const { m } = market(repos);
		expect((await m.removeRegistry(OFFICIAL_ID)).ok).toBe(true);
		expect(await readConfig()).toEqual({ registries: [] });
	});
});
