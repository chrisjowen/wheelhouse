import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWERS_SCHEMA, answersFile } from '$lib/server/setup/answers';

/**
 * Who /api/setup and the /setup page answer: a browser on this computer, and
 * one relayed through Wheelhouse Cloud only on a cloud machine (usable setup
 * answers). The session token is hooks.server.ts's, tested with it.
 */

vi.mock('$lib/server/setup/service', () => ({
	setupService: () => ({ view: async () => ({ schema: 'wheelhouse-setup.v1' }) })
}));

const { GET, POST } = await import('./+server');
const { load } = await import('../../setup/+page.server');

const ORIGIN = 'http://127.0.0.1:4310';
type Event = Parameters<typeof GET>[0];
type LoadEvent = Parameters<typeof load>[0];

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-api-setup-'));
	mkdirSync(path.join(root, 'config'));
	vi.stubEnv('WHEELHOUSE_CONFIG_DIR', path.join(root, 'config'));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

const event = (address: string, relayed: boolean, method = 'GET') => {
	const request = new Request(`${ORIGIN}/api/setup`, {
		method,
		headers: {
			'content-type': 'application/json',
			...(relayed ? { 'x-wheelhouse-remote': '1' } : {})
		},
		body: method === 'POST' ? JSON.stringify({ action: 'nothing' }) : undefined
	});
	return { request, getClientAddress: () => address } as unknown as Event;
};
const answer = (text: string) => writeFileSync(answersFile(path.join(root, 'config')), text);
const statusOf = async (p: unknown) => ((await p) as Response).status;
const pageStatus = async (address: string, relayed: boolean) => {
	try {
		await load(event(address, relayed) as unknown as LoadEvent);
		return 200;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

describe('who setup answers', () => {
	it('answers a browser on this computer', async () => {
		expect(await statusOf(GET(event('127.0.0.1', false)))).toBe(200);
		expect(await pageStatus('127.0.0.1', false)).toBe(200);
	});

	it('refuses one relayed through Wheelhouse Cloud on an install of the captain’s own', async () => {
		expect(await statusOf(GET(event('127.0.0.1', true)))).toBe(403);
		expect(await statusOf(POST(event('127.0.0.1', true, 'POST')))).toBe(403);
		expect(await pageStatus('127.0.0.1', true)).toBe(403);
		answer('{"agent":"claude"}');
		expect(await statusOf(GET(event('127.0.0.1', true)))).toBe(403);
	});

	it('answers one relayed to a cloud machine, still only through the connector', async () => {
		answer(JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' }));
		expect(await statusOf(GET(event('127.0.0.1', true)))).toBe(200);
		expect(await statusOf(POST(event('127.0.0.1', true, 'POST')))).toBe(400);
		expect(await pageStatus('127.0.0.1', true)).toBe(200);
		expect(await statusOf(GET(event('10.0.0.2', true)))).toBe(403);
		expect(await pageStatus('10.0.0.2', false)).toBe(403);
	});
});
