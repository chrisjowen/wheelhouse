import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentDecision, AGENT_ROUTES, CAPTAIN_ONLY, setAgentToken } from './agentauth';

/**
 * The agent token's allowlist: what it may change, what stays the captain's,
 * and that every entry names a route Wheelhouse has, with that method.
 */

const TOKEN = 'a'.repeat(48);
const ORIGIN = 'http://127.0.0.1:4310';

const ask = (method: string, pathname: string, headers: Record<string, string> = {}) =>
	agentDecision(new Request(`${ORIGIN}${pathname}`, { method, headers }), pathname, ORIGIN);
const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });
const concrete = (p: string) => p.replaceAll(':id', 'demo');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** The methods the route module for a table path exports as handlers (`:id` is its one `[param]` folder). */
async function routeMethods(p: string): Promise<string[]> {
	let dir = path.resolve('src/routes');
	for (const seg of p.split('/').filter(Boolean)) {
		const next = seg === ':id' ? readdirSync(dir).find((d) => /^\[[a-z]+\]$/.test(d)) : seg;
		if (!next) return [];
		dir = path.join(dir, next);
	}
	const url = pathToFileURL(path.join(dir, '+server.ts')).href;
	const mod: Record<string, unknown> = await import(/* @vite-ignore */ url);
	return HTTP_METHODS.filter((m) => typeof mod[m] === 'function');
}

beforeEach(() => setAgentToken(TOKEN));
afterEach(() => setAgentToken(null));

describe('the agent token allowlist', () => {
	it('opens exactly these routes to the agent token', () => {
		expect(AGENT_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
			'POST /api/plugins/:id/config',
			'POST /api/plugins/roles',
			'POST /api/plugins/inspect',
			'POST /api/plugins/install',
			'POST /api/plugins/:id/update',
			'POST /api/plugins/:id/load',
			'POST /api/services',
			'POST /api/projects/:id/passage/draft',
			'PUT /api/projects/:id/passage/file',
			'POST /api/wheelhouse/update',
			'POST /api/wheelhouse/upgrade',
			'POST /api/wheelhouse/source'
		]);
	});

	it('keeps these as the captain’s own calls', () => {
		expect(CAPTAIN_ONLY.map((r) => r.path)).toEqual([
			'/api/projects/:id/passage/consent',
			'/api/projects/:id/passage/commands',
			'/api/projects/:id/passage/test',
			'/api/cloud',
			'/api/fleet/membership',
			'/api/setup',
			'/api/vault',
			'/api/inbox',
			'/api/inbox/following',
			'/api/inbox/talk',
			'/api/firstmate/input',
			'/api/firstmate/pick',
			'/api/firstmate/dismiss',
			'/api/firstmate/interrupt',
			'/api/firstmate/messages',
			'/api/apps/:id',
			'/api/second-mate-setup',
			'/api/second-mates/:id/link'
		]);
	});

	it('names only routes Wheelhouse has, with the method each takes', async () => {
		for (const r of AGENT_ROUTES) {
			expect(await routeMethods(r.path), r.path).toContain(r.method);
		}
		for (const r of CAPTAIN_ONLY) {
			expect(
				(await routeMethods(r.path)).some((m) => m !== 'GET'),
				r.path
			).toBe(true);
		}
	});

	it('lets the token through to every allowlisted route', () => {
		for (const r of AGENT_ROUTES) {
			expect(ask(r.method, concrete(r.path), bearer()), r.path).toEqual({ ok: true });
		}
	});

	it('refuses the token on every captain-only route with 403 and the page to use', () => {
		for (const r of CAPTAIN_ONLY) {
			for (const method of ['POST', 'PUT', 'DELETE']) {
				const d = ask(method, concrete(r.path), bearer());
				expect(d, `${method} ${r.path}`).toMatchObject({ ok: false, status: 403 });
				expect(d && !d.ok && d.captain, r.path).toMatch(/^http:\/\/127\.0\.0\.1:4310\//);
				expect(d && !d.ok && d.message).toBe(`captain action: open ${d && !d.ok && d.captain}`);
			}
		}
		const consent = ask('POST', '/api/projects/web/passage/consent', bearer());
		expect(consent).toMatchObject({ captain: `${ORIGIN}/projects/web/passage` });
	});

	it('refuses the token on any route it does not list, and an allowed route by another method', () => {
		for (const [method, p] of [
			['POST', '/api/firstmate/start'],
			['POST', '/api/plugins/marketplace/registries'],
			['DELETE', '/api/plugins/roles'],
			['PUT', '/api/projects/demo/passage/draft'],
			['POST', '/api/plugins/roles/'],
			['POST', '/api/plugins/..%2Froles/config'],
			['POST', '/api/projects/%2e%2e/passage/draft']
		]) {
			expect(ask(method, p, bearer()), `${method} ${p}`).toMatchObject({ ok: false, status: 403 });
		}
	});

	it('refuses a wrong, malformed or unset token with 403', () => {
		expect(ask('POST', '/api/plugins/roles', bearer('b'.repeat(48)))).toMatchObject({
			ok: false,
			status: 403
		});
		expect(ask('POST', '/api/plugins/roles', bearer('short'))).toMatchObject({ status: 403 });
		expect(ask('POST', '/api/plugins/roles', { authorization: TOKEN })).toMatchObject({
			status: 403
		});
		expect(ask('POST', '/api/plugins/roles', { authorization: 'Bearer ' })).toMatchObject({
			status: 403
		});
		setAgentToken(null);
		expect(ask('POST', '/api/plugins/roles', bearer())).toMatchObject({ status: 403 });
	});

	it('leaves a request without the header, from a page, or through Wheelhouse Cloud to the page checks', () => {
		expect(ask('POST', '/api/plugins/roles')).toBeNull();
		expect(ask('POST', '/api/plugins/roles', { ...bearer(), origin: ORIGIN })).toBeNull();
		expect(
			ask('POST', '/api/plugins/roles', { ...bearer(), 'x-wheelhouse-remote': '1' })
		).toBeNull();
	});
});
