import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	githubRegistryUrl,
	notInstalled,
	parseRegistry,
	REGISTRY_SCHEMA,
	resolveIcon,
	searchPlugins,
	type MarketplacePlugin
} from './marketplace';

const URL_ = 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json';

const registry = (plugins: unknown[], extra: Record<string, unknown> = {}) =>
	JSON.stringify({ schema: REGISTRY_SCHEMA, name: 'Acme plugins', plugins, ...extra });

const entry = (over: Record<string, unknown> = {}) => ({
	name: 'docket',
	displayName: 'Docket',
	description: 'A chart of a project’s docket.',
	repository: 'chrisjowen/docket',
	...over
});

const parse = (body: string) => parseRegistry(body, URL_, 'acme/plugins');

describe('reading a registry manifest', () => {
	it('reads its name and each plugin, with the icon beside the manifest', () => {
		const r = parse(
			registry(
				[entry({ icon: 'icons/docket.svg', keywords: ['chart'], author: { name: 'Chris' } })],
				{
					description: 'Plugins for Acme.'
				}
			)
		);
		expect(r).toMatchObject({ ok: true, name: 'Acme plugins', description: 'Plugins for Acme.' });
		if (!r.ok) return;
		expect(r.skipped).toEqual([]);
		expect(r.plugins).toEqual([
			{
				name: 'docket',
				displayName: 'Docket',
				description: 'A chart of a project’s docket.',
				icon: 'https://raw.githubusercontent.com/acme/plugins/HEAD/icons/docket.svg',
				repository: 'chrisjowen/docket',
				ref: null,
				author: 'Chris',
				homepage: null,
				keywords: ['chart'],
				registry: 'acme/plugins'
			}
		]);
	});

	it('names a plugin by its id when it has no display name, and keeps a pinned ref', () => {
		const r = parse(
			registry([
				entry({ displayName: undefined, ref: 'v1.2.0', repository: 'https://github.com/a/b.git' })
			])
		);
		expect(r.ok && r.plugins[0]).toMatchObject({
			displayName: 'docket',
			ref: 'v1.2.0',
			repository: 'a/b'
		});
	});

	it('refuses what is not a registry, or one of a schema it cannot read', () => {
		expect(parse('{nope')).toMatchObject({
			ok: false,
			error: expect.stringMatching(/not valid JSON/)
		});
		expect(parse('[]')).toEqual({ ok: false, error: 'It is not a JSON object.' });
		expect(parse(JSON.stringify({ name: 'x', plugins: [] }))).toMatchObject({
			ok: false,
			error: expect.stringMatching(/not a Wheelhouse plugin registry/)
		});
		expect(
			parse(JSON.stringify({ schema: 'wheelhouse-plugin-registry.v2', name: 'x', plugins: [] }))
		).toMatchObject({ ok: false, error: expect.stringMatching(/v2 registry.*update Wheelhouse/) });
		expect(parse(registry([], { name: '' }))).toEqual({ ok: false, error: 'It has no "name".' });
		expect(parse(JSON.stringify({ schema: REGISTRY_SCHEMA, name: 'x', plugins: {} }))).toEqual({
			ok: false,
			error: '"plugins" must be a list.'
		});
	});

	it('leaves out each entry that breaks the rules, saying why, and keeps the rest', () => {
		const r = parse(
			registry([
				entry(),
				'docket',
				entry({ name: 'Bad Name' }),
				entry({ name: 'no-desc', description: ' ' }),
				entry({ name: 'no-repo', repository: 'not a repo' }),
				entry({ name: 'bad-ref', ref: '--upload-pack=x' }),
				entry({ name: 'bad-icon', icon: 3 }),
				entry({ description: 'A second docket.' }),
				entry({ name: 'vault-lite', repository: 'acme/vault-lite' })
			])
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.plugins.map((p) => p.name)).toEqual(['docket', 'vault-lite']);
		expect(r.skipped.map((s) => [s.index, s.name])).toEqual([
			[1, null],
			[2, 'Bad Name'],
			[3, 'no-desc'],
			[4, 'no-repo'],
			[5, 'bad-ref'],
			[6, 'bad-icon'],
			[7, 'docket']
		]);
		expect(r.skipped.at(-1)!.reason).toBe('an earlier entry has this name');
	});

	it('ignores fields it does not know, so a registry can grow within its version', () => {
		const r = parse(registry([entry({ stars: 5 })], { maintainers: ['x'] }));
		expect(r.ok && r.plugins).toHaveLength(1);
	});
});

describe('an icon', () => {
	it('is an https address, or a path inside the registry beside its manifest', () => {
		expect(resolveIcon('https://cdn.acme.test/i.png', URL_)).toBe('https://cdn.acme.test/i.png');
		expect(resolveIcon('docket.svg', URL_)).toBe(
			'https://raw.githubusercontent.com/acme/plugins/HEAD/docket.svg'
		);
	});

	it('is none for another scheme or a path out of the registry', () => {
		for (const bad of [
			'http://cdn.acme.test/i.png',
			'javascript:alert(1)',
			'data:image/svg+xml,<svg/>',
			'../other/repo/HEAD/x.svg',
			'/abs.svg',
			'https://cdn.acme.test/i.gif',
			'docket.html',
			'',
			3
		]) {
			expect(resolveIcon(bad, URL_)).toBeNull();
		}
	});

	it('resolves within a GitHub registry at its ref', () => {
		expect(githubRegistryUrl('acme/plugins', 'v2', 'reg/wheelhouse-registry.json')).toBe(
			'https://raw.githubusercontent.com/acme/plugins/v2/reg/wheelhouse-registry.json'
		);
	});
});

const plugin = (name: string, over: Partial<MarketplacePlugin> = {}): MarketplacePlugin => ({
	name,
	displayName: name,
	description: `The ${name} plugin.`,
	icon: null,
	repository: `acme/${name}`,
	ref: null,
	author: null,
	homepage: null,
	keywords: [],
	registry: 'acme/plugins',
	...over
});

describe('leaving out installed plugins', () => {
	it('hides one Wheelhouse knows by id, or whose repository is installed, and counts them', () => {
		const r = notInstalled(
			[
				plugin('docket'),
				plugin('improve'),
				plugin('board', { repository: 'Acme/Board-Plugin' }),
				plugin('new')
			],
			[
				{ id: 'docket', repository: 'chrisjowen/docket' },
				{ id: 'project-links', repository: null },
				{ id: 'board-renamed', repository: 'acme/board-plugin' },
				{ id: 'improve', repository: null }
			]
		);
		expect(r.plugins.map((p) => p.name)).toEqual(['new']);
		expect(r.installed).toBe(3);
	});

	it('shows a plugin two registries list once, from the first', () => {
		const r = notInstalled(
			[plugin('a', { registry: 'one' }), plugin('a', { registry: 'two' }), plugin('b')],
			[]
		);
		expect(r.plugins.map((p) => [p.name, p.registry])).toEqual([
			['a', 'one'],
			['b', 'acme/plugins']
		]);
		expect(r.installed).toBe(0);
	});
});

describe('searching', () => {
	const all = [
		plugin('github-issues', {
			displayName: 'GitHub issues',
			description: 'Issues on the Harbour.'
		}),
		plugin('docket', {
			displayName: 'Docket',
			description: 'A chart of a project’s libraries.',
			keywords: ['graph']
		}),
		plugin('board', { displayName: 'Board', description: 'Shows your GitHub project board.' }),
		plugin('cafe', { displayName: 'Café', description: 'Coffee.' })
	];
	const names = (q: string) => searchPlugins(all, q).map((p) => p.name);

	it('finds every plugin, in order, with no query', () => {
		expect(names('')).toEqual(['github-issues', 'docket', 'board', 'cafe']);
		expect(names('   ')).toEqual(['github-issues', 'docket', 'board', 'cafe']);
	});

	it('matches the name or the description, any case, ranking the name first', () => {
		expect(names('github')).toEqual(['github-issues', 'board']);
		expect(names('DOCK')).toEqual(['docket']);
		expect(names('libraries')).toEqual(['docket']);
		expect(names('graph')).toEqual(['docket']);
	});

	it('needs every word to match, and ignores accents', () => {
		expect(names('github board')).toEqual(['board']);
		expect(names('github nothing')).toEqual([]);
		expect(names('cafe')).toEqual(['cafe']);
	});
});

describe('the example registry in the docs', () => {
	it('is a valid registry with no entry left out', async () => {
		const file = path.resolve(
			import.meta.dirname,
			'../../../docs/examples/wheelhouse-registry.json'
		);
		const r = parse(await readFile(file, 'utf8'));
		expect(r).toMatchObject({ ok: true, skipped: [] });
		expect(r.ok && r.plugins.length).toBeGreaterThan(0);
	});
});
