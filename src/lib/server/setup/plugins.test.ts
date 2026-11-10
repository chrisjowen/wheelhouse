import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPlugins, switchPlugin } from './plugins';

let dir: string;
const bundledDir = path.resolve('plugins');
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-setup-plugins-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const opts = () => ({
	bundledDir,
	configDir: path.join(dir, 'config'),
	pluginsDir: path.join(dir, 'plugins'),
	homeDir: null
});

describe('the plugins step', () => {
	it('lists the bundled plugins from their manifests, then the ones to install', async () => {
		const list = await setupPlugins(opts());
		const bundled = list.filter((p) => p.source === 'bundled').map((p) => [p.id, p.on]);
		expect(bundled).toEqual(
			expect.arrayContaining([
				['vault', true],
				['shared-review', false],
				['github-issues', false],
				['project-links', false]
			])
		);
		const installable = list.filter((p) => p.source === 'installable');
		expect(installable.map((p) => p.repository)).toEqual([
			'chrisjowen/docket',
			'chrisjowen/improve'
		]);
		expect(installable.every((p) => !p.on)).toBe(true);
	});

	it('turns a bundled plugin on for every project in the plugins file', async () => {
		expect(await switchPlugin(opts(), 'project-links', true)).toEqual({ ok: true });
		const file = JSON.parse(readFileSync(path.join(dir, 'config', 'plugins.json'), 'utf8'));
		expect(file.plugins['project-links']).toEqual({ enabled: true });
		expect((await setupPlugins(opts())).find((p) => p.id === 'project-links')?.on).toBe(true);
		expect(await switchPlugin(opts(), 'docket', true)).toMatchObject({ ok: false });
	});

	it('shows an installed suggestion as installed', async () => {
		mkdirSync(path.join(dir, 'plugins'), { recursive: true });
		writeFileSync(
			path.join(dir, 'plugins', 'installed.json'),
			JSON.stringify({
				schema: 'wheelhouse-installed-plugins.v1',
				plugins: {
					docket: {
						repository: 'chrisjowen/docket',
						ref: null,
						commit: 'abc',
						version: '1.0.0',
						installedAt: '2026-01-01T00:00:00Z',
						enabled: true
					}
				}
			})
		);
		expect((await setupPlugins(opts())).find((p) => p.id === 'docket')?.on).toBe(true);
	});
});
