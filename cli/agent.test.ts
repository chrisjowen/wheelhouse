import { afterEach, describe, expect, it } from 'vitest';
import { Client, CliError, EXIT, findInstance, waitBack, type AgentDeps } from './agent';
import { upgradeRunning } from './upgrade';
import type { RunningRecord } from './running';

/**
 * The agent CLI's plumbing without a server: which Wheelhouse it talks to and
 * with what token, how the server's answers become exit codes, and an
 * upgrade driven through the running server's update source.
 */

const TOKEN = 'f'.repeat(48);
const rec = (port: number, token = TOKEN): RunningRecord => ({
	pid: port,
	url: `http://127.0.0.1:${port}/`,
	token
});
const finder = (records: RunningRecord[], env: NodeJS.ProcessEnv = {}) => ({
	env,
	readRunning: async () => records
});

afterEach(() => {
	process.exitCode = undefined;
});

describe('findInstance', () => {
	it('uses the one running Wheelhouse, and none when nothing runs', async () => {
		expect(await findInstance({ pluginsDir: '/p' }, finder([rec(4310)]))).toEqual({
			url: 'http://127.0.0.1:4310/',
			token: TOKEN
		});
		expect(await findInstance({ pluginsDir: '/p' }, finder([]))).toBeNull();
	});

	it('asks for --url when several run', async () => {
		await expect(
			findInstance({ pluginsDir: '/p' }, finder([rec(4310), rec(4311)]))
		).rejects.toMatchObject({ code: EXIT.usage });
	});

	it('takes the token only from a record for the same port, by --url or $WHEELHOUSE_URL', async () => {
		const records = [rec(4310, 'a'.repeat(48)), rec(4311, 'b'.repeat(48))];
		expect(
			await findInstance({ url: 'http://localhost:4311', pluginsDir: '/p' }, finder(records))
		).toEqual({ url: 'http://localhost:4311/', token: 'b'.repeat(48) });
		expect(
			await findInstance(
				{ pluginsDir: '/p' },
				finder(records, { WHEELHOUSE_URL: 'http://127.0.0.1:4310' })
			)
		).toEqual({ url: 'http://127.0.0.1:4310/', token: 'a'.repeat(48) });
		expect(
			await findInstance({ url: 'http://127.0.0.1:5000', pluginsDir: '/p' }, finder(records))
		).toEqual({ url: 'http://127.0.0.1:5000/', token: null });
	});

	it('refuses an address that is not on this computer', async () => {
		for (const url of ['http://example.com:4310', 'https://127.0.0.1:4310', 'nonsense']) {
			await expect(
				findInstance({ url, pluginsDir: '/p' }, finder([rec(4310)]))
			).rejects.toMatchObject({ code: EXIT.usage });
		}
	});
});

/** A fake Wheelhouse: answers by `METHOD path`, recording each request. */
function fakeFetch(routes: Record<string, (body: unknown) => [number, unknown]>) {
	const seen: { route: string; auth: string | null; body: unknown }[] = [];
	const fetch = (async (url: URL, init: RequestInit = {}) => {
		const route = `${init.method ?? 'GET'} ${url.pathname}`;
		const headers = new Headers(init.headers);
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		seen.push({ route, auth: headers.get('authorization'), body });
		const answer = routes[route];
		if (!answer)
			throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
		const [status, json] = answer(body);
		return new Response(JSON.stringify(json), { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, seen };
}

const client = (fetch: typeof globalThis.fetch, token: string | null = TOKEN) =>
	new Client({ url: 'http://127.0.0.1:4310/', token }, { fetch }, '/p');

describe('Client', () => {
	it('sends the token only on changes, and turns refusals into exit codes', async () => {
		const { fetch, seen } = fakeFetch({
			'GET /api/health': () => [200, { version: '1.0.0' }],
			'POST /api/projects/x/passage/consent': () => [
				403,
				{
					message: 'captain action: open http://127.0.0.1:4310/projects/x/passage',
					captain: 'http://127.0.0.1:4310/projects/x/passage'
				}
			],
			'PUT /api/projects/x/passage/file': () => [
				409,
				{ message: 'The file changed since it was loaded.' }
			],
			'POST /api/plugins/roles': () => [403, { message: 'Nope.' }]
		});
		const c = client(fetch);
		expect(await c.get('/api/health')).toEqual({ version: '1.0.0' });
		expect(seen[0].auth).toBeNull();
		await expect(c.post('/api/projects/x/passage/consent', {})).rejects.toMatchObject({
			code: EXIT.captain,
			message: 'captain action: open http://127.0.0.1:4310/projects/x/passage'
		});
		expect(seen[1].auth).toBe(`Bearer ${TOKEN}`);
		await expect(c.request('PUT', '/api/projects/x/passage/file', {})).rejects.toMatchObject({
			code: EXIT.conflict
		});
		await expect(c.post('/api/plugins/roles', {})).rejects.toMatchObject({ code: EXIT.failed });
		await expect(c.get('/api/nothing')).rejects.toMatchObject({ code: EXIT.notRunning });
	});

	it('refuses to make a change with no token, and never puts the token in a message', async () => {
		const { fetch, seen } = fakeFetch({});
		await expect(client(fetch, null).post('/api/plugins/roles', {})).rejects.toBeInstanceOf(
			CliError
		);
		expect(seen).toEqual([]);
		const e: unknown = await client(fetch)
			.post('/api/plugins/roles', {})
			.catch((x: unknown) => x);
		expect((e as CliError).message).not.toContain(TOKEN);
	});
});

describe('waitBack', () => {
	it('knows a restart too quick to see down by the new record it wrote, and takes its token', async () => {
		const { fetch } = fakeFetch({ 'GET /api/health': () => [200, { version: '1.0.0' }] });
		const c = client(fetch);
		let calls = 0;
		const renewed = 'e'.repeat(48);
		const version = await waitBack(c, {
			env: {},
			sleep: async () => {},
			readRunning: async () => [rec(4310, calls++ ? renewed : TOKEN)]
		});
		expect(version).toBe('1.0.0');
		expect(calls).toBe(2);
		expect(c.instance.token).toBe(renewed);
	});

	it('gives up when it never comes back', async () => {
		const { fetch } = fakeFetch({});
		const version = await waitBack(
			client(fetch),
			{ env: {}, sleep: async () => {}, readRunning: async () => [] },
			{ ms: 5 }
		);
		expect(version).toBeNull();
	});
});

describe('upgradeRunning', () => {
	const check = (state: string) => ({
		schema: 'wheelhouse-update.v1',
		state,
		reason: state === 'unsupported' ? 'not a clone' : null,
		branch: null,
		repository: null,
		current: { version: '1.0.0', commit: null },
		latest: { version: '1.1.0', commit: '' },
		commits: [],
		behind: 0,
		changes: []
	});
	const deps = (fetch: typeof globalThis.fetch, lines: string[], answer = true): AgentDeps => ({
		env: {},
		fetch,
		readRunning: async () => [],
		confirm: async () => answer,
		readText: async () => '',
		log: (l) => lines.push(l),
		error: (l) => lines.push(l),
		sleep: async () => {}
	});

	it('checks, upgrades from the source and waits for the new version', async () => {
		let restarted = false;
		let polls = 0;
		let down = 0;
		const view = (job: unknown) => ({
			source: 'published',
			installKind: 'npm',
			mismatch: false,
			check: check('available'),
			job,
			canRestart: true,
			busy: ['wh-1 is running']
		});
		const job = (state: string, step: string) => ({
			state,
			step,
			steps: [
				{ step: 'npm-install', label: 'Install from npm' },
				{ step: 'restart', label: 'Restart Wheelhouse' }
			],
			error: null,
			output: null
		});
		const { fetch, seen } = fakeFetch({
			'POST /api/wheelhouse/update': () => [200, view(null)],
			'POST /api/wheelhouse/upgrade': () => [202, view(job('running', 'npm-install'))],
			'GET /api/wheelhouse/update': () => {
				polls++;
				if (polls > 1) restarted = true;
				return [
					200,
					view(job(polls > 1 ? 'restarting' : 'running', polls > 1 ? 'restart' : 'npm-install'))
				];
			},
			// Down once while it restarts, then the new version.
			'GET /api/health': () => {
				if (!restarted) return [200, { version: '1.0.0' }];
				return down++ ? [200, { version: '1.1.0' }] : [503, {}];
			}
		});
		const lines: string[] = [];
		await upgradeRunning(client(fetch), deps(fetch, lines), { yes: true });
		expect(lines).toContain('npm has Wheelhouse 1.1.0 (this is 1.0.0).');
		expect(lines).toContain('  - wh-1 is running');
		expect(lines).toContain('Install from npm…');
		expect(lines.at(-1)).toBe('Wheelhouse 1.1.0 is running at http://127.0.0.1:4310/.');
		expect(seen.filter((s) => s.route.startsWith('POST')).map((s) => s.auth)).toEqual([
			`Bearer ${TOKEN}`,
			`Bearer ${TOKEN}`
		]);
	});

	it('only checks with --check, and stops when not agreed', async () => {
		const view = {
			source: 'github',
			installKind: 'clone',
			mismatch: false,
			check: check('available'),
			job: null,
			canRestart: true,
			busy: []
		};
		const { fetch, seen } = fakeFetch({ 'POST /api/wheelhouse/update': () => [200, view] });
		await upgradeRunning(client(fetch), deps(fetch, []), { check: true });
		await expect(upgradeRunning(client(fetch), deps(fetch, [], false), {})).rejects.toMatchObject({
			message: 'not upgraded'
		});
		expect(seen.map((s) => s.route)).toEqual([
			'POST /api/wheelhouse/update',
			'POST /api/wheelhouse/update'
		]);
	});

	it('says why it cannot upgrade, and switches the source with --source', async () => {
		const unsupported = {
			source: 'published',
			installKind: 'clone',
			mismatch: true,
			check: check('unsupported'),
			job: null,
			canRestart: true,
			busy: []
		};
		const { fetch } = fakeFetch({
			'POST /api/wheelhouse/update': () => [200, unsupported],
			'POST /api/wheelhouse/source': (b) => [
				200,
				{ ...unsupported, source: (b as { source: string }).source, job: null }
			]
		});
		await expect(upgradeRunning(client(fetch), deps(fetch, []), {})).rejects.toMatchObject({
			message: 'not a clone'
		});
		const lines: string[] = [];
		await upgradeRunning(client(fetch), deps(fetch, lines), { source: 'github' });
		expect(lines).toEqual(['The update source is github.']);
	});
});
