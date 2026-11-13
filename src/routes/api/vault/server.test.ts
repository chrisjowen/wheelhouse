import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_HEADER, sessionToken } from '$lib/server/session';
import { VaultService } from '$lib/server/vault';

/**
 * POST and GET /api/vault, as the chat's Add a secret popup and the Vault page
 * call them: through hooks.server.ts (Origin and session token), then the
 * route, with a stand-in for the bundled wh-vault that keeps names and grants
 * in a JSON file. The value is plainly fake, and the tests check it never
 * comes back in an answer or reaches the console.
 */

const FAKE_VALUE = 'not-a-real-value-7f3a';

const FAKE_CLI = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const [, dir, cmd, name, ...projects] = process.argv.slice(2);
const file = dir + '/state.json';
const vault = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
let stdin = '';
if (cmd === 'set') for await (const c of process.stdin) stdin += c;
if (cmd === 'set') writeFileSync(dir + '/stdin', stdin);
const at = '2026-11-09T12:00:00.000Z';
if (cmd === 'backend') {
	console.log(readFileSync(dir + '/backend.json', 'utf8'));
} else if (cmd === 'list') {
	const secrets = Object.entries(vault).map(([n, s]) => ({ name: n, ...s, lastUsedAt: null }));
	console.log(JSON.stringify({ schema: 'wh-vault.list.v1', secrets }));
} else if (cmd === 'set') {
	vault[name] = vault[name] ? { ...vault[name], updatedAt: at } : { projects: [], updatedAt: at };
} else if (cmd === 'grant') {
	vault[name].projects = [...new Set([...vault[name].projects, ...projects])].sort();
}
writeFileSync(file, JSON.stringify(vault));
`;

let root: string;
let dir: string;
let platform: NodeJS.Platform;
const forget = vi.fn();

vi.mock('$lib/server/runtime', () => ({
	getRuntime: async () => ({
		configured: true,
		collector: { getFleet: () => ({ projects: [{ id: 'lumen' }, { id: 'atlas' }] }) },
		vault: new VaultService({
			cli: path.join(root, 'wh-vault.mjs'),
			configDir: dir,
			env: { PATH: process.env.PATH, HOME: dir },
			platform
		}),
		plugins: { forget }
	})
}));

const { handle } = await import('../../../hooks.server');
const { GET, POST } = await import('./+server');

const ORIGIN = 'http://127.0.0.1:4310';
const said: string[] = [];

beforeEach(() => {
	root ??= mkdtempSync(path.join(tmpdir(), 'wh-vault-route-'));
	dir = mkdtempSync(path.join(root, 'config-'));
	writeFileSync(path.join(root, 'wh-vault.mjs'), FAKE_CLI);
	platform = 'darwin';
	said.length = 0;
	for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
	}
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A POST to /api/vault through the session guard, then the route. */
function post(body: object, headers: Record<string, string> = {}): Promise<Response> {
	const request = new Request(`${ORIGIN}/api/vault`, {
		method: 'POST',
		headers: { host: '127.0.0.1:4310', 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	const event = { request, url: new URL(request.url) } as unknown as RequestEvent;
	return handle({
		event,
		resolve: () => POST(event as unknown as Parameters<typeof POST>[0]) as Promise<Response>
	}) as Promise<Response>;
}
const trusted = () => ({ origin: ORIGIN, [SESSION_HEADER]: sessionToken() });
const set = (o: object = {}) => ({
	action: 'set',
	name: 'VERCEL_TOKEN',
	value: FAKE_VALUE,
	projects: ['lumen'],
	...o
});
const stored = () => {
	try {
		return JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as Record<
			string,
			unknown
		>;
	} catch {
		return {};
	}
};

describe('POST /api/vault', () => {
	it('stores nothing without this launch’s session token, or from another site', async () => {
		const refused: Record<string, string>[] = [
			{ origin: ORIGIN },
			{ origin: ORIGIN, [SESSION_HEADER]: 'nope' },
			{ origin: 'http://evil.example', [SESSION_HEADER]: sessionToken() }
		];
		for (const headers of refused) {
			const r = await post(set(), headers);
			expect(r.status).toBe(403);
			expect(await r.text()).not.toContain(FAKE_VALUE);
		}
		expect(stored()).toEqual({});
	});

	it('stores the value and grants, answering names only, and logs nothing of it', async () => {
		const r = await post(set({ replace: false }), trusted());
		expect(r.status).toBe(200);
		expect(r.headers.get('cache-control')).toBe('no-store');
		const text = await r.text();
		expect(text).not.toContain(FAKE_VALUE);
		expect(JSON.parse(text)).toMatchObject({
			message: 'Stored VERCEL_TOKEN in your Mac’s login Keychain. lumen can use it.',
			secrets: [{ name: 'VERCEL_TOKEN', projects: ['lumen'] }]
		});
		expect(readFileSync(path.join(dir, 'stdin'), 'utf8')).toBe(FAKE_VALUE);
		expect(said.join('\n')).not.toContain(FAKE_VALUE);
		expect(forget).toHaveBeenCalledWith('vault');
	});

	it('asks first for a name already stored: 409, value untouched and not repeated', async () => {
		await post(set(), trusted());
		const before = stored();
		const r = await post(set({ value: 'a-second-fake-value', replace: false }), trusted());
		expect(r.status).toBe(409);
		const text = await r.text();
		expect(text).not.toContain('a-second-fake-value');
		expect(JSON.parse(text).message).toMatch(/already has a secret named VERCEL_TOKEN/);
		expect(stored()).toEqual(before);
		expect(readFileSync(path.join(dir, 'stdin'), 'utf8')).toBe(FAKE_VALUE);
		// Confirmed, it replaces.
		const again = await post(set({ value: 'a-second-fake-value', replace: true }), trusted());
		expect(again.status).toBe(200);
		expect(await again.text()).not.toContain('a-second-fake-value');
		expect(said.join('\n')).not.toMatch(/fake-value/);
	});

	it('refuses an invalid name without repeating the value', async () => {
		const r = await post(set({ name: '1-bad name' }), trusted());
		expect(r.status).toBe(400);
		const text = await r.text();
		expect(text).not.toContain(FAKE_VALUE);
		expect(JSON.parse(text).message).toMatch(/environment variable name/);
		expect(stored()).toEqual({});
	});

	it('says the vault cannot store here on a computer that is neither a Mac nor Linux', async () => {
		platform = 'win32';
		const r = await post(set(), trusted());
		expect(r.status).toBe(503);
		const text = await r.text();
		expect(text).not.toContain(FAKE_VALUE);
		expect(JSON.parse(text).message).toMatch(/not a Mac/);
		expect(stored()).toEqual({});
		expect(said.join('\n')).not.toContain(FAKE_VALUE);
	});
});

describe('GET /api/vault', () => {
	const get = async () =>
		(await (GET({} as Parameters<typeof GET>[0]) as Promise<Response>)).json();

	it('says whether a value can be stored here, naming no secret', async () => {
		await post(set(), trusted());
		const ok = await get();
		expect(ok).toEqual({ canStore: true, reason: null, where: 'your Mac’s login Keychain' });
		platform = 'win32';
		const no = await get();
		expect(no).toEqual({
			canStore: false,
			reason: expect.stringMatching(/not a Mac/),
			where: null
		});
		expect(JSON.stringify([ok, no])).not.toContain('VERCEL_TOKEN');
	});

	it('on Linux, says what wh-vault backend says about this computer', async () => {
		platform = 'linux';
		writeFileSync(
			path.join(dir, 'backend.json'),
			JSON.stringify({
				schema: 'wh-vault.backend.v1',
				backend: 'secret-service',
				where: 'the login keyring (Secret Service)',
				canStore: false,
				reason: 'secret-tool is not installed; opt in with `wh-vault backend env-file`',
				choices: ['secret-service', 'env-file']
			})
		);
		expect(await get()).toEqual({
			canStore: false,
			reason:
				'This computer cannot store a secret now: secret-tool is not installed; opt in with `wh-vault backend env-file`.',
			where: 'the login keyring (Secret Service)'
		});
		const r = await post(set(), trusted());
		expect(r.status).toBe(503);
		expect(await r.text()).not.toContain(FAKE_VALUE);
		expect(stored()).toEqual({});
	});
});
