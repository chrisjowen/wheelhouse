import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfigDir, isEnabled, parsePluginConfig, PluginConfigFile } from './config';

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
});
