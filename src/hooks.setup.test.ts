import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWERS_SCHEMA, answersFile } from '$lib/server/setup/answers';
import { markSignedIn } from '$lib/server/setup/cloud';
import { handle } from './hooks.server';

const runtime = vi.hoisted(() => ({ current: { configured: true } as Record<string, unknown> }));
vi.mock('$lib/server/runtime', () => ({ getRuntime: async () => runtime.current }));

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-hooks-setup-'));
	mkdirSync(path.join(root, 'config'));
	vi.stubEnv('WHEELHOUSE_CONFIG_DIR', path.join(root, 'config'));
	vi.stubEnv('WHEELHOUSE_STATE_DIR', path.join(root, 'state'));
	runtime.current = { configured: true };
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

async function open(pathname: string): Promise<Response> {
	const url = new URL(`http://127.0.0.1:4310${pathname}`);
	const headers = new Headers({ host: '127.0.0.1:4310', accept: 'text/html' });
	const event = { request: new Request(url, { headers }), url } as unknown as RequestEvent;
	return handle({ event, resolve: async () => new Response('ok') });
}

const answer = () =>
	writeFileSync(
		answersFile(path.join(root, 'config')),
		JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' })
	);

describe('the first page', () => {
	it('is the page asked for once Firstmate is there, on an install of the captain’s own', async () => {
		expect((await open('/')).status).toBe(200);
	});

	it('opens the setup wizard with no Firstmate yet', async () => {
		runtime.current = { configured: false };
		const res = await open('/');
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('/setup');
	});

	it('opens the setup wizard on a cloud machine until its agent is signed in', async () => {
		answer();
		const res = await open('/projects/x');
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('/setup');
		expect((await open('/setup')).status).toBe(200);
		markSignedIn(path.join(root, 'state'), 'claude');
		expect((await open('/')).status).toBe(200);
	});
});
