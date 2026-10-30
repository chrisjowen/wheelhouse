import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	changePlugin,
	defaultConfigDir,
	isEnabled,
	parsePluginConfig,
	PluginConfigFile
} from './config';

describe('plugins file', () => {
	it('parses enablement, strictly', () => {
		expect(parsePluginConfig('{"plugins":{"x":{"enabled":false,"projects":{"a":true}}}}')).toEqual({
			ok: true,
			config: { plugins: { x: { enabled: false, projects: { a: true } } } }
		});
		expect(parsePluginConfig('{}')).toEqual({ ok: true, config: { plugins: {} } });
		expect(parsePluginConfig('{"plugins":{"x":{"settings":{"bin":"/b","n":[1]}}}}')).toEqual({
			ok: true,
			config: { plugins: { x: { settings: { bin: '/b', n: [1] } } } }
		});
		for (const bad of [
			'nope',
			'[]',
			'{"plug":{}}',
			'{"plugins":{"x":{"enabled":"yes"}}}',
			'{"plugins":{"x":{"projects":{"a":1}}}}',
			'{"plugins":{"x":{"colour":"red"}}}',
			'{"plugins":{"x":{"settings":[]}}}'
		]) {
			expect(parsePluginConfig(bad).ok).toBe(false);
		}
	});

	it('decides per project, then per plugin, then by default', () => {
		const config = { plugins: { x: { enabled: false, projects: { a: true } } } };
		expect(isEnabled(config, { id: 'x', enabledByDefault: true }, 'a')).toBe(true);
		expect(isEnabled(config, { id: 'x', enabledByDefault: true }, 'b')).toBe(false);
		expect(isEnabled(config, { id: 'y', enabledByDefault: true }, 'b')).toBe(true);
		expect(isEnabled(config, { id: 'y' }, 'b')).toBe(false);
		// The host's per-project default stands in for the plugin's own.
		expect(isEnabled(config, { id: 'y', enabledByDefault: true }, 'b', false)).toBe(false);
		expect(isEnabled(config, { id: 'x' }, 'a', false)).toBe(true);
	});

	it('lives in Wheelhouse’s own config directory', () => {
		expect(defaultConfigDir({ WHEELHOUSE_CONFIG_DIR: '/c' })).toBe('/c');
		expect(defaultConfigDir({ XDG_CONFIG_HOME: '/x' })).toBe('/x/wheelhouse');
		expect(defaultConfigDir({})).toMatch(/\.config\/wheelhouse$/);
	});

	describe('PluginConfigFile', () => {
		let dir: string;
		beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), 'wh-plugins-config-'))));
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it('treats a missing file as defaults, reports a bad one, and re-reads on change', async () => {
			const file = path.join(dir, 'plugins.json');
			const f = new PluginConfigFile(file);
			expect(await f.current()).toEqual({ config: { plugins: {} }, error: null });
			writeFileSync(file, '{ nope');
			const bad = await f.current();
			expect(bad.config).toEqual({ plugins: {} });
			expect(bad.error).toContain('not valid JSON');
			writeFileSync(file, '{"plugins":{"x":{"enabled":true}}}');
			utimesSync(file, new Date(), new Date(Date.now() + 5000));
			expect(await f.current()).toEqual({
				config: { plugins: { x: { enabled: true } } },
				error: null
			});
		});

		it('gives calls that arrive during the first read the file, not the defaults', async () => {
			const file = path.join(dir, 'plugins.json');
			writeFileSync(file, '{"plugins":{"x":{"settings":{"a":1}}}}');
			const f = new PluginConfigFile(file);
			const all = await Promise.all([f.current(), f.current(), f.current()]);
			for (const r of all) expect(r.config.plugins.x).toEqual({ settings: { a: 1 } });
		});
	});

	describe('changing it from a plugin’s page', () => {
		let dir: string;
		const file = () => path.join(dir, 'conf', 'plugins.json');
		const read = () => JSON.parse(readFileSync(file(), 'utf8'));
		beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), 'wh-plugins-change-'))));
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it('makes the file when there is none, with only the change', async () => {
			expect(await changePlugin(path.join(dir, 'conf'), 'x', { enabled: true })).toEqual({
				ok: true
			});
			expect(read()).toEqual({ plugins: { x: { enabled: true } } });
		});

		it('keeps everything else in the file, and goes back to the default with null', async () => {
			const conf = path.join(dir, 'conf');
			await changePlugin(conf, 'other', { settings: { a: 1 } });
			await changePlugin(conf, 'x', {
				settings: { labels: ['a'], projects: { p: { mode: 'auto' } } }
			});
			await changePlugin(conf, 'x', { project: 'atlas', enabled: true });
			await changePlugin(conf, 'x', { enabled: false });
			await changePlugin(conf, 'x', { project: 'lumen', enabled: true });
			await changePlugin(conf, 'x', { settings: { labels: [], assignee: '', mode: undefined } });
			expect(read()).toEqual({
				plugins: {
					other: { settings: { a: 1 } },
					x: {
						enabled: false,
						projects: { lumen: true },
						settings: { labels: [], assignee: '', projects: { p: { mode: 'auto' } } }
					}
				}
			});
			await changePlugin(conf, 'x', { project: 'lumen', enabled: null });
			await changePlugin(conf, 'x', { enabled: null });
			expect(read().plugins.x).toEqual({
				settings: { labels: [], assignee: '', projects: { p: { mode: 'auto' } } }
			});
			expect(parsePluginConfig(readFileSync(file(), 'utf8')).ok).toBe(true);
		});

		it('turns it on or off for every project by replacing each project’s own choice', async () => {
			const conf = path.join(dir, 'conf');
			await changePlugin(conf, 'x', { project: 'lumen', enabled: true });
			await changePlugin(conf, 'x', { settings: { a: 1 } });
			await changePlugin(conf, 'x', { enabled: false });
			expect(read().plugins.x).toEqual({ enabled: false, settings: { a: 1 } });
		});

		it('leaves a file that is not valid alone', async () => {
			const conf = path.join(dir, 'conf');
			await changePlugin(conf, 'x', { enabled: true });
			writeFileSync(file(), '{ "plugins": { "x": { "enabled": "yes" } } }');
			const r = await changePlugin(conf, 'x', { enabled: false });
			expect(r).toMatchObject({ ok: false, error: expect.stringContaining('is not valid') });
			expect(readFileSync(file(), 'utf8')).toBe('{ "plugins": { "x": { "enabled": "yes" } } }');
		});

		it('makes changes that arrive together one after another, losing none', async () => {
			const conf = path.join(dir, 'conf');
			await Promise.all(
				['a', 'b', 'c', 'd'].map((p, i) =>
					changePlugin(conf, 'x', { project: p, enabled: i % 2 === 0 })
				)
			);
			expect(read().plugins.x.projects).toEqual({ a: true, b: false, c: true, d: false });
			expect(existsSync(`${file()}.${process.pid}.tmp`)).toBe(false);
		});
	});
});
