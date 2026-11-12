import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL_REGISTRY_REPO, REGISTRY_SCHEMA } from '../../plugins/marketplace';
import {
	fetchIcon,
	Marketplace,
	MARKETPLACE_TTL_MS,
	parseRegistriesConfig,
	readRegistries,
	readRegistry,
	REGISTRIES_FILE,
	type Fetcher
} from './marketplace';

const OFFICIAL_URL = `https://raw.githubusercontent.com/${OFFICIAL_REGISTRY_REPO}/HEAD/wheelhouse-registry.json`;

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

/** A fetch that answers each address from a table: a body, a status, or a thrown error. */
function fetcher(table: Record<string, string | number | Error>): Fetcher & { calls: string[] } {
	const calls: string[] = [];
	const f = Object.assign(
		async (url: string) => {
			calls.push(url);
			const v = table[url];
			if (v instanceof Error) throw v;
			if (typeof v === 'number') return new Response('nope', { status: v });
			if (v === undefined) return new Response('missing', { status: 404 });
			return new Response(v, { status: 200 });
		},
		{ calls }
	);
	return f;
}

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-marketplace-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('the registries configuration', () => {
	it('is the official registry alone when there is no file', async () => {
		expect(await readRegistries(dir)).toEqual({
			file: path.join(dir, REGISTRIES_FILE),
			sources: [{ source: OFFICIAL_REGISTRY_REPO, url: OFFICIAL_URL, official: true }],
			error: null
		});
	});

	it('names GitHub repositories (at a ref and path), in order', () => {
		const r = parseRegistriesConfig(
			JSON.stringify({
				registries: [
					OFFICIAL_REGISTRY_REPO,
					{ repo: 'acme/plugins', ref: 'stable', path: 'reg/wheelhouse-registry.json' },
					'acme/plugins'
				]
			})
		);
		expect(r).toEqual({
			ok: true,
			sources: [
				{ source: OFFICIAL_REGISTRY_REPO, url: OFFICIAL_URL, official: true },
				{
					source: 'acme/plugins@stable',
					url: 'https://raw.githubusercontent.com/acme/plugins/stable/reg/wheelhouse-registry.json',
					official: false
				},
				{
					source: 'acme/plugins',
					url: 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json',
					official: false
				}
			]
		});
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
		await writeFile(path.join(dir, REGISTRIES_FILE), '{"registries":[3]}');
		const r = await readRegistries(dir);
		expect(r.sources.map((s) => s.source)).toEqual([OFFICIAL_REGISTRY_REPO]);
		expect(r.error).toMatch(/^It is not valid: registries\[0\]/);
	});
});

describe('reading a registry', () => {
	const src = {
		source: 'acme/plugins',
		url: 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json',
		official: false
	};

	it('lists its plugins and says what it is', async () => {
		const r = await readRegistry(src, fetcher({ [src.url]: manifest('Acme', ['a', 'b']) }));
		expect(r.view).toMatchObject({ name: 'Acme', error: null, count: 2, skipped: [] });
		expect(r.plugins.map((p) => p.name)).toEqual(['a', 'b']);
	});

	it('says why, without throwing, when it is missing, failing, unreachable or not a registry', async () => {
		const cases: [string | number | Error, RegExp][] = [
			[404, /no registry there \(404\)/],
			[500, /answered 500/],
			[
				new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com'),
				/could not be reached: getaddrinfo/
			],
			[Object.assign(new Error('timed out'), { name: 'TimeoutError' }), /did not answer within/],
			['<html>', /not valid JSON/],
			['x'.repeat(1024 * 1024 + 1), /larger than 1 MB/]
		];
		for (const [answer, why] of cases) {
			const r = await readRegistry(src, fetcher({ [src.url]: answer }));
			expect(r.plugins).toEqual([]);
			expect(r.view.error).toMatch(why);
		}
	});
});

describe('the official registry before it is published', () => {
	const official = { source: OFFICIAL_REGISTRY_REPO, url: OFFICIAL_URL, official: true };

	it('is not published yet, not a failure, when it is not found', async () => {
		const r = await readRegistry(official, fetcher({ [OFFICIAL_URL]: 404 }));
		expect(r.plugins).toEqual([]);
		expect(r.view).toMatchObject({ unpublished: true, error: null, count: 0 });
	});

	it('is still a failure when it answers anything else, or is not a registry', async () => {
		for (const answer of [500, new Error('getaddrinfo ENOTFOUND'), '<html>'] as const) {
			const r = await readRegistry(official, fetcher({ [OFFICIAL_URL]: answer }));
			expect(r.view.unpublished).toBe(false);
			expect(r.view.error).not.toBeNull();
		}
	});

	it('is only the official one: another registry not found is a failure', async () => {
		const r = await readRegistry(
			{
				source: 'acme/plugins',
				url: 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json',
				official: false
			},
			fetcher({})
		);
		expect(r.view).toMatchObject({ unpublished: false, error: expect.stringMatching(/404/) });
	});
});

describe('fetching an icon', () => {
	it('is the image its extension says, or nothing when it fails or is too big', async () => {
		const png = 'https://i.test/a.png';
		expect(await fetchIcon(png, fetcher({ [png]: 'PNG' }))).toMatchObject({ type: 'image/png' });
		expect(await fetchIcon(png, fetcher({ [png]: 404 }))).toBeNull();
		expect(await fetchIcon(png, fetcher({ [png]: new Error('down') }))).toBeNull();
		expect(await fetchIcon(png, fetcher({ [png]: 'x'.repeat(256 * 1024 + 1) }))).toBeNull();
		expect(await fetchIcon('https://i.test/a.gif', fetcher({}))).toBeNull();
	});
});

describe('the marketplace', () => {
	const other = 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json';

	it('lists what every registry offers that is not installed, even when one fails', async () => {
		await writeFile(
			path.join(dir, REGISTRIES_FILE),
			JSON.stringify({ registries: [OFFICIAL_REGISTRY_REPO, 'acme/plugins', 'acme/broken'] })
		);
		const m = new Marketplace({
			configDir: dir,
			known: async () => [{ id: 'docket', repository: 'chrisjowen/docket' }],
			fetch: fetcher({
				[OFFICIAL_URL]: manifest('Wheelhouse plugins', ['docket', 'improve']),
				[other]: manifest('Acme', ['board', 'improve'])
			})
		});
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
		expect(v.config.error).toBeNull();
	});

	it('keeps what it read for a while, and reads again on refresh or once it is old', async () => {
		let now = 1_000_000;
		const f = fetcher({ [OFFICIAL_URL]: manifest('W', ['a']) });
		let known = [] as { id: string; repository: string | null }[];
		const m = new Marketplace({
			configDir: dir,
			known: async () => known,
			fetch: f,
			now: () => now
		});
		expect((await m.view()).plugins).toHaveLength(1);
		known = [{ id: 'a', repository: 'acme/a' }];
		// An install shows at once, from what was read.
		expect((await m.view()).plugins).toHaveLength(0);
		expect(f.calls).toHaveLength(1);
		await m.view({ refresh: true });
		expect(f.calls).toHaveLength(2);
		now += MARKETPLACE_TTL_MS;
		await m.view();
		expect(f.calls).toHaveLength(3);
	});

	it('serves a listed plugin’s icon through Wheelhouse, fetched from where its registry says', async () => {
		const reg = JSON.stringify({
			schema: REGISTRY_SCHEMA,
			name: 'W',
			plugins: [
				{ name: 'a', description: 'A.', repository: 'acme/a', icon: 'icons/a.svg' },
				{ name: 'b', description: 'B.', repository: 'acme/b' }
			]
		});
		const iconUrl = `https://raw.githubusercontent.com/${OFFICIAL_REGISTRY_REPO}/HEAD/icons/a.svg`;
		const f = fetcher({ [OFFICIAL_URL]: reg, [iconUrl]: '<svg/>' });
		const m = new Marketplace({ configDir: dir, known: async () => [], fetch: f });
		const v = await m.view();
		expect(v.plugins.map((p) => p.icon)).toEqual(['/api/plugins/marketplace/icon/a', null]);
		const icon = await m.icon('a');
		expect(icon?.type).toBe('image/svg+xml');
		expect(new TextDecoder().decode(icon!.body)).toBe('<svg/>');
		await m.icon('a');
		expect(f.calls.filter((u) => u === iconUrl)).toHaveLength(1);
		expect(await m.icon('b')).toBeNull();
		expect(await m.icon('nope')).toBeNull();
	});

	it('reads once for requests that arrive together', async () => {
		const f = vi.fn(async () => new Response(manifest('W', ['a'])));
		const m = new Marketplace({ configDir: dir, known: async () => [], fetch: f });
		await Promise.all([m.view(), m.view(), m.view()]);
		expect(f).toHaveBeenCalledTimes(1);
	});
});
