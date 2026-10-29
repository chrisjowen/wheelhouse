import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';
import { SESSION_HEADER, sessionToken } from '$lib/server/session';

async function request(
	host: string | null,
	init: { method?: string; headers?: Record<string, string>; path?: string } = {}
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (host !== null) headers.set('host', host);
	// The served URL is always loopback; only the Host header varies.
	const url = new URL(`http://127.0.0.1:4310${init.path ?? '/api/fleet'}`);
	const event = {
		request: new Request(url, { method: init.method ?? 'GET', headers }),
		url
	} as unknown as RequestEvent;
	return handle({ event, resolve: async () => new Response('ok') });
}

describe('handle', () => {
	it.each(['127.0.0.1:4310', 'localhost:4310', '[::1]:4310', 'LOCALHOST:5173'])(
		'serves requests addressed to %s',
		async (host) => {
			const res = await request(host);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('ok');
		}
	);

	it.each([
		'evil.example:4310',
		'127.0.0.1.evil.example:4310',
		'localhost.evil.example',
		'127.0.0.1:4310@evil.example',
		'0.0.0.0:4310',
		''
	])('rejects requests addressed to %j with 421', async (host) => {
		expect((await request(host)).status).toBe(421);
	});

	it('rejects requests without a Host header', async () => {
		expect((await request(null)).status).toBe(421);
	});
});

describe('mutating requests', () => {
	const HOST = '127.0.0.1:4310';
	const post = (headers: Record<string, string>, method = 'POST') =>
		request(HOST, { method, headers, path: '/api/firstmate/messages' });
	const good = () => ({ origin: `http://${HOST}`, [SESSION_HEADER]: sessionToken() });

	it('accepts the served origin with this launch’s session token', async () => {
		expect((await post(good())).status).toBe(200);
	});

	it('rejects a missing Origin', async () => {
		const res = await post({ [SESSION_HEADER]: sessionToken() });
		expect(res.status).toBe(403);
		expect((await res.json()).message).toMatch(/Origin/);
	});

	it.each([
		'http://evil.example',
		'http://localhost:4310',
		'http://127.0.0.1:4311',
		'https://127.0.0.1:4310',
		'null'
	])('rejects Origin %s', async (origin) => {
		expect((await post({ ...good(), origin })).status).toBe(403);
	});

	it('rejects a missing or wrong session token', async () => {
		const { origin } = good();
		expect((await post({ origin })).status).toBe(403);
		expect((await post({ origin, [SESSION_HEADER]: 'guess' })).status).toBe(403);
		expect((await post({ origin, [SESSION_HEADER]: `${sessionToken()}x` })).status).toBe(403);
		const res = await post({ origin, [SESSION_HEADER]: '' });
		expect((await res.json()).message).toMatch(/session token/);
	});

	it.each(['PUT', 'PATCH', 'DELETE'])('protects %s the same way', async (method) => {
		expect((await post({ origin: good().origin }, method)).status).toBe(403);
		expect((await post(good(), method)).status).toBe(200);
	});

	it('takes the served origin from the loopback Host the page was loaded from', async () => {
		const headers = { origin: 'http://localhost:4310', [SESSION_HEADER]: sessionToken() };
		const at = (host: string) =>
			request(host, { method: 'POST', headers, path: '/api/firstmate/messages' });
		expect((await at('localhost:4310')).status).toBe(200);
		expect((await at('LOCALHOST:4310')).status).toBe(200);
		expect((await at('127.0.0.1:4310')).status).toBe(403);
	});

	it.each([
		'/api/firstmate/input',
		'/api/firstmate/interrupt',
		'/api/firstmate/dismiss',
		'/api/firstmate/pick',
		'/api/firstmate/start'
	])('guards everything that types into or starts the Firstmate session (%s)', async (path) => {
		const at = (headers: Record<string, string>) =>
			request(HOST, { method: 'POST', headers, path });
		expect((await at({ [SESSION_HEADER]: sessionToken() })).status).toBe(403);
		expect(
			(await at({ origin: 'http://evil.example', [SESSION_HEADER]: sessionToken() })).status
		).toBe(403);
		expect((await at({ origin: `http://${HOST}` })).status).toBe(403);
		expect((await at(good())).status).toBe(200);
		const foreign = await request('evil.example:4310', { method: 'POST', headers: good(), path });
		expect(foreign.status).toBe(421);
	});

	it('leaves reads alone', async () => {
		expect((await request(HOST, { path: '/api/firstmate/messages' })).status).toBe(200);
	});

	it('issues one token per launch', () => {
		expect(sessionToken()).toBe(sessionToken());
		expect(sessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

describe('upgrade and plugin changes', () => {
	const HOST = '127.0.0.1:4310';
	it.each([
		'/api/wheelhouse/update',
		'/api/wheelhouse/upgrade',
		'/api/plugins/updates',
		'/api/plugins/inspect',
		'/api/plugins/install',
		'/api/plugins/links/update'
	])('POST %s needs the served origin and the session token', async (path) => {
		const origin = `http://${HOST}`;
		expect((await request(HOST, { method: 'POST', path })).status).toBe(403);
		expect((await request(HOST, { method: 'POST', path, headers: { origin } })).status).toBe(403);
		const ok = await request(HOST, {
			method: 'POST',
			path,
			headers: { origin, [SESSION_HEADER]: sessionToken() }
		});
		expect(ok.status).toBe(200);
	});
});
