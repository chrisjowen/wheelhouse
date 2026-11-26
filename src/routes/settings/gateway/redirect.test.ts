import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from './+page.server';

const request = (headers: Record<string, string> = {}) =>
	new Request('http://127.0.0.1/settings/gateway', { headers });

// remotesPage() reads this ship's real cloud settings dir; point it at a
// throwaway one so the relayed case below never touches the host's own.
let dir: string;
let prevConfigDir: string | undefined;
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-settings-gateway-'));
	prevConfigDir = process.env.WHEELHOUSE_CONFIG_DIR;
	process.env.WHEELHOUSE_CONFIG_DIR = dir;
});
afterEach(async () => {
	if (prevConfigDir === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
	else process.env.WHEELHOUSE_CONFIG_DIR = prevConfigDir;
	await rm(dir, { recursive: true, force: true });
});

describe('legacy Settings → Gateway route', () => {
	it('redirects to Settings → Fleet', () => {
		let caught: unknown;
		try {
			load({ request: request() } as never);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ status: 307, location: '/settings/fleet' });
	});

	it('shows the no-controls status for a request that came through the cloud, like every other relayed page', async () => {
		const data = await load({ request: request({ 'x-wheelhouse-remote': '1' }) } as never);
		expect(data).toMatchObject({ view: null });
	});
});
