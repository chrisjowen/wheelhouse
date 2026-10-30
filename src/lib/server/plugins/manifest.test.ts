import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	fromExport,
	MANIFEST_FIELDS,
	parseManifest,
	WHEELHOUSE_FIELDS,
	type PluginManifest
} from './manifest';

const base = () => ({
	name: 'acme-links',
	displayName: 'Acme links',
	version: '1.2.0',
	description: 'Links.',
	author: { name: 'Acme', url: 'https://acme.test' },
	repository: 'https://github.com/acme/links',
	wheelhouse: {
		apiVersion: 1,
		server: 'wheelhouse/server/index.js',
		ui: 'wheelhouse/ui/index.js',
		enabledWhenFile: '.acme.yaml',
		contributions: [
			{ id: 'links', slot: 'project.tab' },
			{ id: 'card', slot: 'harbour.card' }
		],
		services: [{ id: 'viewer', scope: 'project' }]
	}
});

const parse = (v: unknown) => parseManifest(JSON.stringify(v));
const manifest = (v: unknown = base()): PluginManifest => {
	const r = parse(v);
	if (!r.ok) throw new Error(r.error);
	return r.manifest;
};
const error = (v: unknown) => {
	const r = parse(v);
	return r.ok ? null : r.error;
};
const edit = (f: (m: ReturnType<typeof base>) => void) => {
	const m = base();
	f(m);
	return m;
};

describe('the plugin manifest', () => {
	it('reads a full manifest', () => {
		expect(manifest()).toMatchObject({
			name: 'acme-links',
			displayName: 'Acme links',
			version: '1.2.0',
			author: { name: 'Acme', url: 'https://acme.test' },
			wheelhouse: {
				apiVersion: 1,
				server: 'wheelhouse/server/index.js',
				ui: 'wheelhouse/ui/index.js',
				enabledWhenFile: '.acme.yaml',
				contributions: [
					{ id: 'links', slot: 'project.tab' },
					{ id: 'card', slot: 'harbour.card' }
				],
				services: [{ id: 'viewer', scope: 'project' }]
			}
		});
	});

	it('defaults the display name to the id, and the ui bundle and services to none', () => {
		const m = manifest({
			name: 'tiny',
			version: '0.1.0',
			wheelhouse: { apiVersion: 1, server: 'server.mjs', contributions: [] }
		});
		expect(m).toMatchObject({
			displayName: 'tiny',
			author: null,
			wheelhouse: { ui: null, services: [] }
		});
	});

	it('refuses a contract version this Wheelhouse does not load', () => {
		expect(error(edit((m) => (m.wheelhouse.apiVersion = 2)))).toMatch(
			/written for plugin contract 2; this Wheelhouse supports 1/
		);
		expect(error(edit((m) => (m.wheelhouse.apiVersion = 0)))).toMatch(/plugin contract 0/);
	});

	it('refuses unknown fields, at the top and under wheelhouse', () => {
		expect(error({ ...base(), hooks: [] })).toBe('unknown field "hooks"');
		expect(error(edit((m) => Object.assign(m.wheelhouse, { permissions: ['write'] })))).toBe(
			'unknown field "wheelhouse.permissions"'
		);
		expect(error(edit((m) => Object.assign(m.wheelhouse.contributions[0], { render: 'x' })))).toBe(
			'unknown field "wheelhouse.contributions[0].render"'
		);
	});

	it('refuses bad ids, versions, slots and duplicates', () => {
		expect(error({ ...base(), name: 'Acme Links' })).toMatch(/^name must be lower-case/);
		expect(error({ ...base(), version: 'v1' })).toMatch(/^version must be a semantic version/);
		expect(error(edit((m) => (m.wheelhouse.contributions[1].slot = 'sidebar')))).toMatch(
			/slot must be one of project.tab/
		);
		expect(error(edit((m) => (m.wheelhouse.contributions[1].id = 'links')))).toBe(
			'it declares contribution "links" twice'
		);
		expect(error(edit((m) => (m.wheelhouse.services[0].scope = 'task')))).toMatch(
			/scope must be "fleet" or "project"/
		);
	});

	it('keeps entry paths inside the plugin, and to JavaScript modules', () => {
		for (const server of ['/abs/index.js', '../escape.js', 'a/../../b.js', './index.js']) {
			expect(error(edit((m) => (m.wheelhouse.server = server))), server).toMatch(
				/plain path inside the plugin/
			);
		}
		expect(error(edit((m) => (m.wheelhouse.ui = 'ui/index.ts')))).toMatch(/JavaScript module/);
		expect(error(edit((m) => (m.wheelhouse.enabledWhenFile = '../x')))).toMatch(
			/plain relative path/
		);
	});

	it('reads declared settings in order, with their defaults', () => {
		const m = manifest(
			edit((m) =>
				Object.assign(m.wheelhouse, {
					settings: {
						board: { title: 'Board URL', description: 'Where it lives.', required: true },
						timeoutMs: { type: 'number', default: 8000 },
						verbose: { type: 'boolean', default: false }
					}
				})
			)
		);
		expect(m.wheelhouse.settings).toEqual([
			{
				key: 'board',
				title: 'Board URL',
				description: 'Where it lives.',
				type: 'text',
				required: true
			},
			{
				key: 'timeoutMs',
				title: 'timeoutMs',
				description: null,
				type: 'number',
				required: false,
				default: 8000
			},
			{
				key: 'verbose',
				title: 'verbose',
				description: null,
				type: 'boolean',
				required: false,
				default: false
			}
		]);
		expect(manifest().wheelhouse.settings).toEqual([]);
	});

	it('refuses settings it could not ask for', () => {
		const withSettings = (settings: unknown) =>
			error(edit((m) => Object.assign(m.wheelhouse, { settings })));
		expect(withSettings([])).toBe('wheelhouse.settings must be an object of settings by key');
		expect(withSettings({ 'my-key': {} })).toMatch(/key "my-key" must start with a letter/);
		expect(withSettings({ a: { type: 'list' } })).toBe(
			'wheelhouse.settings.a.type must be one of text, number, boolean'
		);
		expect(withSettings({ a: { type: 'number', default: '5' } })).toBe(
			'wheelhouse.settings.a.default must be a number'
		);
		expect(withSettings({ a: { default: 5 } })).toBe('wheelhouse.settings.a.default must be text');
		expect(withSettings({ a: { required: 'yes' } })).toBe(
			'wheelhouse.settings.a.required must be true or false'
		);
		expect(withSettings({ a: { secret: true } })).toBe(
			'unknown field "wheelhouse.settings.a.secret"'
		);
		const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`s${i}`, {}]));
		expect(withSettings(many)).toBe('wheelhouse.settings declares more than 20 settings');
	});

	it('says plainly when it is not a manifest at all', () => {
		expect(parseManifest('{')).toMatchObject({
			ok: false,
			error: expect.stringMatching(/^not valid JSON/)
		});
		expect(error([])).toBe('expected a JSON object');
		expect(error({ name: 'x', version: '1.0.0' })).toMatch(/"wheelhouse" is missing/);
	});

	it('lists the same fields as the SDK’s JSON Schema', () => {
		const schema = JSON.parse(
			readFileSync(path.resolve('packages/plugin-sdk/plugin.schema.json'), 'utf8')
		);
		expect(Object.keys(schema.properties).sort()).toEqual([...MANIFEST_FIELDS].sort());
		expect(Object.keys(schema.properties.wheelhouse.properties).sort()).toEqual(
			[...WHEELHOUSE_FIELDS].sort()
		);
	});

	it('accepts the bundled Project links manifest', () => {
		const text = readFileSync(
			path.resolve('plugins/project-links/.wheelhouse-plugin/plugin.json'),
			'utf8'
		);
		expect(parseManifest(text)).toMatchObject({ ok: true, manifest: { name: 'project-links' } });
	});
});

describe('a server entry checked against its manifest', () => {
	const fetch = async () => ({ available: false as const, reason: 'none' });
	const exported = () => ({
		providers: [{ id: 'p', scope: 'project', ttlMs: 1000, fetch }],
		contributions: [
			{ slot: 'project.tab', id: 'links', title: 'Links', provider: 'p', render: { blocks: true } },
			{
				slot: 'harbour.card',
				id: 'card',
				title: 'Card',
				provider: 'p',
				render: { element: 'acme-links-card' }
			}
		],
		services: [{ id: 'viewer', title: 'Viewer', scope: 'project', resolve: async () => null }]
	});

	it('takes its identity and enablement from the manifest', () => {
		const r = fromExport(manifest(), { default: { ...exported(), enabledByDefault: true } });
		expect(r).toMatchObject({
			ok: true,
			plugin: {
				id: 'acme-links',
				name: 'Acme links',
				version: '1.2.0',
				apiVersion: 1,
				enabledWhenFile: '.acme.yaml'
			}
		});
		expect(r.ok && r.plugin.enabledByDefault).toBeUndefined();
	});

	it('refuses an export that disagrees with the manifest', () => {
		const err = (x: unknown, m = manifest()) => {
			const r = fromExport(m, { default: x });
			return r.ok ? null : r.error;
		};
		expect(err({ ...exported(), id: 'other' })).toMatch(
			/says id "other", but its manifest says "acme-links"/
		);
		expect(err({ ...exported(), contributions: exported().contributions.slice(0, 1) })).toMatch(
			/contributes links:project.tab, but its manifest declares card:harbour.card, links:project.tab/
		);
		expect(err({ ...exported(), services: [] })).toMatch(
			/services none, but its manifest declares viewer:project/
		);
		expect(err(null)).toMatch(/does not default-export a plugin object/);
		expect(err({ ...exported(), providers: [{ id: 'p', scope: 'project', ttlMs: 1 }] })).toMatch(
			/fetch function/
		);
		const panel = exported();
		panel.contributions[1].render = { component: 'acme/card' } as never;
		expect(err(panel)).toMatch(/names a compiled-in panel/);
		// A plugin bundled with Wheelhouse ships in its package, so it may name one of its panels.
		expect(fromExport(manifest(), { default: panel }, { panels: true })).toMatchObject({
			ok: true
		});
		const noUi = manifest(edit((m) => delete (m.wheelhouse as { ui?: string }).ui));
		expect(err(exported(), noUi)).toMatch(
			/drawn by a custom element, but the manifest names no ui bundle/
		);
	});
});

describe('a manifest’s MCP servers', () => {
	const withServer = (servers: unknown) =>
		edit((m) => Object.assign(m.wheelhouse, { mcpServers: servers }));

	it('reads each MCP server and the service it is served by', () => {
		expect(manifest(withServer([{ id: 'docs', service: 'viewer' }])).wheelhouse.mcpServers).toEqual(
			[{ id: 'docs', service: 'viewer' }]
		);
		expect(manifest().wheelhouse.mcpServers).toEqual([]);
	});

	it('refuses one on a service it does not declare, a bad id, a duplicate or an unknown field', () => {
		expect(error(withServer([{ id: 'docs', service: 'other' }]))).toMatch(
			/mcpServers\[0\]\.service must be one of the services it declares/
		);
		expect(error(withServer([{ id: 'Docs', service: 'viewer' }]))).toMatch(/\.id must be/);
		expect(
			error(
				withServer([
					{ id: 'docs', service: 'viewer' },
					{ id: 'docs', service: 'viewer' }
				])
			)
		).toBe('it declares MCP server "docs" twice');
		expect(error(withServer([{ id: 'docs', service: 'viewer', url: 'http://x' }]))).toBe(
			'unknown field "wheelhouse.mcpServers[0].url"'
		);
		expect(error(withServer({}))).toBe('wheelhouse.mcpServers must be a list');
	});

	it('must be exactly the MCP servers the server entry exports', () => {
		const fetch = async () => ({ available: false as const, reason: 'none' });
		const m = manifest(withServer([{ id: 'docs', service: 'viewer' }]));
		const x = (mcpServers: unknown) => ({
			providers: [{ id: 'p', scope: 'project', ttlMs: 1000, fetch }],
			contributions: [
				{
					slot: 'project.tab',
					id: 'links',
					title: 'Links',
					provider: 'p',
					render: { blocks: true }
				},
				{
					slot: 'harbour.card',
					id: 'card',
					title: 'Card',
					provider: 'p',
					render: { app: { server: 'docs', tool: 'show' } }
				}
			],
			services: [{ id: 'viewer', title: 'Viewer', scope: 'project', resolve: async () => null }],
			mcpServers
		});
		const r = fromExport(m, {
			default: x([{ id: 'docs', title: 'Docs', service: 'viewer', path: '/mcp' }])
		});
		expect(r).toMatchObject({ ok: true, plugin: { mcpServers: [{ id: 'docs', path: '/mcp' }] } });
		const err = (v: unknown) => {
			const res = fromExport(m, { default: x(v) });
			return res.ok ? null : res.error;
		};
		expect(err(undefined)).toMatch(/MCP servers none, but its manifest declares docs:viewer/);
		expect(err([{ id: 'docs', service: 'viewer' }])).toMatch(/needs a title and a path/);
	});
});
