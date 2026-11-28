import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveFeatureSettings } from '$lib/server/features';
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
		'/api/firstmate/signin',
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

describe('hosts allowed for a cloud IDE (WHEELHOUSE_ALLOWED_HOSTS)', () => {
	const FORWARD = '4310--x.example.dev';
	const prior = process.env.WHEELHOUSE_ALLOWED_HOSTS;
	beforeEach(() => {
		process.env.WHEELHOUSE_ALLOWED_HOSTS = '*.example.dev';
	});
	afterEach(() => {
		if (prior === undefined) delete process.env.WHEELHOUSE_ALLOWED_HOSTS;
		else process.env.WHEELHOUSE_ALLOWED_HOSTS = prior;
	});
	const post = (headers: Record<string, string>) =>
		request(FORWARD, { method: 'POST', headers, path: '/api/firstmate/messages' });

	it('serves the forward’s Host, and still refuses any other with 421', async () => {
		expect((await request(FORWARD)).status).toBe(200);
		expect((await request('127.0.0.1:4310')).status).toBe(200);
		for (const host of ['evil.com', 'example.dev', 'evilexample.dev', `${FORWARD}.evil.com`]) {
			expect((await request(host)).status, host).toBe(421);
		}
	});

	it('accepts a change from https://<Host> with the session token, and nothing less', async () => {
		const token = { [SESSION_HEADER]: sessionToken() };
		expect((await post({ origin: `https://${FORWARD}`, ...token })).status).toBe(200);
		expect((await post({ origin: `https://${FORWARD}` })).status).toBe(403);
		expect((await post({ origin: `http://${FORWARD}`, ...token })).status).toBe(403);
		expect((await post({ origin: 'https://y.example.dev', ...token })).status).toBe(403);
		expect((await post({ origin: 'http://127.0.0.1:4310', ...token })).status).toBe(403);
	});

	it('honours X-Forwarded-Proto for the forward’s origin', async () => {
		const headers = { [SESSION_HEADER]: sessionToken(), 'x-forwarded-proto': 'http' };
		expect((await post({ ...headers, origin: `http://${FORWARD}` })).status).toBe(200);
		expect((await post({ ...headers, origin: `https://${FORWARD}` })).status).toBe(403);
	});
});

describe('with no allowed hosts (the default)', () => {
	it('refuses a cloud IDE’s Host as any foreign Host, exactly as before', async () => {
		const prior = process.env.WHEELHOUSE_ALLOWED_HOSTS;
		delete process.env.WHEELHOUSE_ALLOWED_HOSTS;
		try {
			expect((await request('4310--x.example.dev')).status).toBe(421);
			const res = await request('4310--x.example.dev', {
				method: 'POST',
				headers: { origin: 'https://4310--x.example.dev', [SESSION_HEADER]: sessionToken() },
				path: '/api/firstmate/messages'
			});
			expect(res.status).toBe(421);
		} finally {
			if (prior !== undefined) process.env.WHEELHOUSE_ALLOWED_HOSTS = prior;
		}
	});
});

describe('experimental feature routes', () => {
	it('returns 404 for disabled feature routes while shared APIs remain available', async () => {
		const prior = process.env.WHEELHOUSE_CONFIG_DIR;
		const priorEnabled = process.env.WHEELHOUSE_ENABLE_FEATURES;
		const config = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-hook-features-'));
		process.env.WHEELHOUSE_CONFIG_DIR = config;
		delete process.env.WHEELHOUSE_ENABLE_FEATURES;
		try {
			for (const path of [
				'/events',
				'/settings/events',
				'/api/wh-events',
				'/remotes',
				'/api/cloud'
			]) {
				expect((await request('127.0.0.1:4310', { path })).status, path).toBe(404);
			}
			for (const path of [
				'/api/events',
				'/api/fleet',
				'/settings/experimental',
				'/settings/fleet',
				'/settings/gateway',
				'/settings/cloud',
				'/api/fleet/membership'
			]) {
				expect((await request('127.0.0.1:4310', { path })).status, path).toBe(200);
			}
		} finally {
			if (prior === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
			else process.env.WHEELHOUSE_CONFIG_DIR = prior;
			if (priorEnabled === undefined) delete process.env.WHEELHOUSE_ENABLE_FEATURES;
			else process.env.WHEELHOUSE_ENABLE_FEATURES = priorEnabled;
			await rm(config, { recursive: true, force: true });
		}
	});

	it('restores the same routes when enabled', async () => {
		const prior = process.env.WHEELHOUSE_CONFIG_DIR;
		const priorEnabled = process.env.WHEELHOUSE_ENABLE_FEATURES;
		const config = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-hook-features-'));
		process.env.WHEELHOUSE_CONFIG_DIR = config;
		delete process.env.WHEELHOUSE_ENABLE_FEATURES;
		try {
			await saveFeatureSettings(config, {
				fleet: false,
				events: true,
				remotes: true,
				'hosted-second-mates': false,
				discussion: false,
				lanes: false,
				livereview: false,
				soundings: false,
				automaticProviderSwitching: true
			});
			for (const route of [
				'/events',
				'/settings/events',
				'/api/wh-events',
				'/remotes',
				'/api/cloud'
			]) {
				expect((await request('127.0.0.1:4310', { path: route })).status, route).toBe(200);
			}
		} finally {
			if (prior === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
			else process.env.WHEELHOUSE_CONFIG_DIR = prior;
			if (priorEnabled === undefined) delete process.env.WHEELHOUSE_ENABLE_FEATURES;
			else process.env.WHEELHOUSE_ENABLE_FEATURES = priorEnabled;
			await rm(config, { recursive: true, force: true });
		}
	});
});

describe('the Fleet area', () => {
	const HOST = '127.0.0.1:4310';
	let config: string;
	let prior: string | undefined;
	let priorEnabled: string | undefined;
	beforeEach(async () => {
		prior = process.env.WHEELHOUSE_CONFIG_DIR;
		priorEnabled = process.env.WHEELHOUSE_ENABLE_FEATURES;
		config = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-hook-fleet-'));
		process.env.WHEELHOUSE_CONFIG_DIR = config;
		delete process.env.WHEELHOUSE_ENABLE_FEATURES;
	});
	afterEach(async () => {
		if (prior === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
		else process.env.WHEELHOUSE_CONFIG_DIR = prior;
		if (priorEnabled === undefined) delete process.env.WHEELHOUSE_ENABLE_FEATURES;
		else process.env.WHEELHOUSE_ENABLE_FEATURES = priorEnabled;
		await rm(config, { recursive: true, force: true });
	});
	const flags = (fleet: boolean, remotes: boolean) =>
		saveFeatureSettings(config, {
			fleet,
			events: false,
			remotes,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
	const status = async (route: string) => (await request(HOST, { path: route })).status;

	it('is not there while its flag is off: Remotes stays where it was', async () => {
		await flags(false, true);
		expect(await status('/fleet')).toBe(404);
		expect(await status('/fleet/remotes')).toBe(404);
		expect(await status('/remotes')).toBe(200);
	});

	it('opens with its flag on, and /remotes goes to Fleet → Remotes, query and all', async () => {
		await flags(true, true);
		expect(await status('/fleet')).toBe(200);
		expect(await status('/fleet/remotes')).toBe(200);
		const moved = await request(HOST, { path: '/remotes?from=menu' });
		expect(moved.status).toBe(307);
		expect(moved.headers.get('location')).toBe('/fleet/remotes?from=menu');
		// The APIs it uses stay where they are.
		expect(await status('/api/fleet/membership')).toBe(200);
		expect(await status('/settings/fleet')).toBe(200);
	});

	it('keeps Fleet → Remotes behind remote access, which keeps its meaning', async () => {
		await flags(true, false);
		expect(await status('/fleet')).toBe(200);
		expect(await status('/fleet/remotes')).toBe(404);
		expect(await status('/remotes')).toBe(404);
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
