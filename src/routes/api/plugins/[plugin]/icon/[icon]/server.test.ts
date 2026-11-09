import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

/** A plugin's menu icon route, with the runtime's one named icon file stood in. */

const dir = mkdtempSync(path.join(tmpdir(), 'wh-plugin-icon-'));
const svg = path.join(dir, 'icon.svg');
writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
const rt = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock('$lib/server/runtime', () => ({
	pluginIconFile: async (plugin: string, contribution: string) =>
		rt.files[`${plugin}/${contribution}`] ?? null
}));
rt.files['vault/overview'] = svg;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const get = (plugin: string, icon: string) =>
	(GET as (e: unknown) => Promise<Response>)({ params: { plugin, icon } });
const status = (p: Promise<Response>) =>
	p.then(
		(r) => r.status,
		(e: { status: number }) => e.status
	);

describe('a plugin’s menu icon', () => {
	it('serves the file its manifest names, as an image that runs nothing', async () => {
		const res = await get('vault', 'overview.svg');
		expect(res.headers.get('content-type')).toBe('image/svg+xml');
		expect(res.headers.get('content-security-policy')).toContain('sandbox');
		expect(await res.text()).toContain('<svg');
	});

	it('serves nothing for another contribution, plugin or extension', async () => {
		expect(await status(get('vault', 'secrets.svg'))).toBe(404);
		expect(await status(get('other', 'overview.svg'))).toBe(404);
		expect(await status(get('vault', 'overview.png'))).toBe(404);
		expect(await status(get('vault', 'overview'))).toBe(404);
	});
});
