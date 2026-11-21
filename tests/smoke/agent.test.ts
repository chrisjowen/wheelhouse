import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { CAPTAIN_ONLY } from '../../src/lib/server/agentauth';
import {
	backlogRow,
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../helpers/fake-firstmate';

/**
 * The agent CLI (`wheelhouse status`, `doctor`, `plugin config|role`,
 * `passage …`, `preview check`, `inbox`, `restart`) against the built
 * `wheelhouse open` with a fake Firstmate, and the agent token at the server:
 * every captain-only route refuses it, a wrong or missing token is refused,
 * and a foreign Host is still 421. No output ever holds the token.
 * Requires `npm run build` first (`npm run test:smoke` does that).
 */

const CLI = path.resolve('dist/cli.js');
let fm: FakeFirstmate;
let server: ChildProcess;
let output = '';
let base = '';
let stateDir: string;
let pluginsDir: string;
let env: NodeJS.ProcessEnv;
const printed: string[] = [];
const tokens = new Set<string>();

async function waitFor<T>(
	fn: () => T | undefined | Promise<T | undefined>,
	ms = 30_000
): Promise<T> {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn();
		if (v !== undefined) return v;
		if (Date.now() > end) throw new Error(`timed out; server output:\n${output}`);
		await new Promise((r) => setTimeout(r, 100));
	}
}

/** Run the CLI as an agent would: no terminal, the plugins directory the server records itself in. */
function wh(
	args: string[],
	input?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = execFile(
			process.execPath,
			[CLI, ...args],
			{ env: { ...env, WHEELHOUSE_URL: '' }, timeout: 90_000 },
			(err, stdout, stderr) => {
				printed.push(stdout, stderr);
				resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
			}
		);
		child.stdin?.end(input ?? '');
	});
}
const json = async (args: string[]) => {
	const r = await wh([...args, '--json']);
	expect(r.code, r.stderr).toBe(0);
	return JSON.parse(r.stdout);
};

/** The token the running server wrote for itself, as an agent's CLI reads it. */
function token(): string {
	const dir = path.join(pluginsDir, '.running');
	const [file] = readdirSync(dir);
	const t = JSON.parse(readFileSync(path.join(dir, file), 'utf8')).token as string;
	tokens.add(t);
	return t;
}

function raw(
	method: string,
	pathname: string,
	headers: Record<string, string>
): Promise<{ status: number; body: string }> {
	const u = new URL(base);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: u.hostname,
				port: u.port,
				path: pathname,
				method,
				headers: { 'content-type': 'application/json', ...headers }
			},
			(res) => {
				let body = '';
				res.on('data', (d) => (body += d));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
			}
		);
		req.on('error', reject);
		req.end('{}');
	});
}

beforeAll(async () => {
	if (!existsSync(CLI) || !existsSync(path.resolve('build/handler.js'))) {
		throw new Error('Run `npm run build` before the smoke test (or use `npm run test:smoke`).');
	}
	fm = createFakeFirstmate();
	stateDir = mkdtempSync(path.join(tmpdir(), 'wh-agent-state-'));
	pluginsDir = path.join(stateDir, 'plugins');
	mkdirSync(pluginsDir, { recursive: true });
	fm.set(
		'snapshot.json',
		snapshotFixture(
			{
				tasks: [taskRow({ id: 'wh-1', state: 'done', pr: 'https://github.com/o/r/pull/7' })],
				backlog: { present: true, records: [backlogRow('wh-2', 'queued')] }
			},
			fm.root
		)
	);
	mkdirSync(path.join(fm.root, 'state'), { recursive: true });
	const bin = path.join(stateDir, 'bin');
	mkdirSync(bin);
	writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
	env = {
		...process.env,
		PATH: `${bin}${path.delimiter}${process.env.PATH}`,
		WHEELHOUSE_NO_GH: '1',
		WHEELHOUSE_CONFIG_DIR: stateDir,
		WHEELHOUSE_STATE_DIR: stateDir,
		WHEELHOUSE_PLUGINS_DIR: pluginsDir,
		WHEELHOUSE_NM_EVIDENCE_DIR: path.join(fm.root, 'none'),
		WHEELHOUSE_NM_LOGS_DIR: path.join(fm.root, 'none'),
		WHEELHOUSE_NO_USAGE: '1',
		CLAUDE_CONFIG_DIR: path.join(stateDir, 'claude'),
		TMUX: '',
		TMUX_TMPDIR: stateDir,
		WHEELHOUSE_TMUX_SOCKET: `wh-agent-${process.pid}`
	};
	server = spawn(
		process.execPath,
		[CLI, 'open', '--firstmate', fm.root, '--home', fm.root, '--port', '0', '--no-browser'],
		{ env }
	);
	server.stdout?.on('data', (d) => (output += d));
	server.stderr?.on('data', (d) => (output += d));
	base = await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1]);
	await waitFor(() => (existsSync(path.join(pluginsDir, '.running')) ? true : undefined));
});

afterAll(() => {
	server?.kill('SIGKILL');
	fm?.cleanup();
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

describe('the agent token at the server', () => {
	it('refuses it on every captain-only route with 403 and the page to use', async () => {
		const auth = { authorization: `Bearer ${token()}` };
		for (const r of CAPTAIN_ONLY) {
			const p = r.path.replaceAll(':id', 'wheelhouse');
			const res = await raw('POST', p, auth);
			expect(res.status, p).toBe(403);
			expect(JSON.parse(res.body).message, p).toMatch(
				/^captain action: open http:\/\/127\.0\.0\.1:\d+\//
			);
		}
	});

	it('refuses a wrong or missing token with 403, and a foreign Host with 421', async () => {
		const route = '/api/plugins/roles';
		expect((await raw('POST', route, { authorization: `Bearer ${'0'.repeat(48)}` })).status).toBe(
			403
		);
		expect((await raw('POST', route, { authorization: 'Bearer' })).status).toBe(403);
		expect((await raw('POST', route, {})).status).toBe(403);
		const foreign = await raw('POST', route, {
			authorization: `Bearer ${token()}`,
			host: 'evil.example'
		});
		expect(foreign.status).toBe(421);
		// A route not open to agents is refused even with the right token.
		expect(
			(await raw('POST', '/api/firstmate/start', { authorization: `Bearer ${token()}` })).status
		).toBe(403);
	});
});

describe('the agent CLI', () => {
	it('status --json says what is running, and that it can make changes', async () => {
		const s = await json(['status']);
		expect(s).toMatchObject({
			schema: 'wheelhouse.status.v1',
			url: `${base}/`,
			version,
			configured: true,
			canChange: true,
			firstmate: { compatible: true, home: fm.root },
			material: { state: expect.any(String) }
		});
		const text = await wh(['status']);
		expect(text.code).toBe(0);
		expect(text.stdout).toContain(`Wheelhouse ${version} at ${base}/`);
	});

	it('doctor --json lists its checks', async () => {
		const d = await json(['doctor']);
		expect(d).toMatchObject({ schema: 'wheelhouse.doctor.v1', ok: true });
		expect(d.checks).toContainEqual(expect.objectContaining({ id: 'token', state: 'ok' }));
		expect(d.checks).toContainEqual(expect.objectContaining({ id: 'firstmate', state: 'ok' }));
	});

	it('changes a plugin’s setting and the review surface role', async () => {
		const off = await json(['plugin', 'config', 'project-links', '--off']);
		expect(off).toMatchObject({
			schema: 'wheelhouse.plugin-config.v1',
			plugin: { on: false, enabled: false }
		});
		const back = await json(['plugin', 'config', 'project-links', '--default']);
		expect(back.plugin.enabled).toBeNull();
		const role = await json(['plugin', 'role', 'review.surface', 'builtin']);
		expect(role.schema).toBe('wheelhouse.plugin-role.v1');
		expect(role.roles).toContainEqual(expect.objectContaining({ role: 'review.surface' }));
		expect((await wh(['plugin', 'config', 'nope'])).code).toBe(1);
		expect((await wh(['plugin', 'config', 'project-links', '--on', '--off'])).code).toBe(2);
	});

	it('adds a Released step to the captain’s passage file, which applies', async () => {
		const shown = await json(['passage', 'show', 'wheelhouse']);
		expect(shown.schema).toBe('wheelhouse.passage-show.v1');
		const dry = await json(['passage', 'add-step', 'wheelhouse', 'released', '--dry-run']);
		expect(dry).toMatchObject({ added: ['check release', 'step released'], digest: null });
		expect(existsSync(path.join(stateDir, 'projects', 'wheelhouse.yaml'))).toBe(false);
		const added = await json(['passage', 'add-step', 'wheelhouse', 'released']);
		expect(added).toMatchObject({
			schema: 'wheelhouse.passage-add-step.v1',
			file: 'captain',
			added: ['check release', 'step released'],
			digest: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		expect(readFileSync(path.join(stateDir, 'projects', 'wheelhouse.yaml'), 'utf8')).toBe(
			readFileSync(path.resolve('src/lib/server/passages/testdata/add-step-released.yaml'), 'utf8')
		);
		const passage = await waitFor(async () => {
			const p = await json(['passage', 'show', 'wheelhouse']);
			const ship = p.passage.passages.find((x: { track: string }) => x.track === 'ship');
			return ship.steps.some((s: { id: string }) => s.id === 'released') ? p : undefined;
		});
		expect(passage).toBeTruthy();
		// Asking again changes nothing.
		const again = await wh(['passage', 'add-step', 'wheelhouse', 'released']);
		expect(again.stdout).toContain('already has the released step');
	});

	it('gets, checks and applies a passage file, refusing a stale base with exit 5', async () => {
		const got = await json(['passage', 'get', 'wheelhouse']);
		expect(got.file).toMatchObject({
			exists: true,
			digest: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		const text = `${got.file.text}# reviewed\n`;
		expect((await wh(['passage', 'check', 'wheelhouse', '-'], text)).code).toBe(0);
		const bad = await wh(
			['passage', 'check', 'wheelhouse', '-'],
			'version: 1\nstages:\n  - id: x\n'
		);
		expect(bad.code).toBe(1);
		expect(bad.stdout).toContain('problem:');
		const applied = await wh(
			['passage', 'apply', 'wheelhouse', '-', '--base', got.file.digest, '--json'],
			text
		);
		expect(applied.code, applied.stderr).toBe(0);
		const stale = await wh(
			['passage', 'apply', 'wheelhouse', '-', '--base', got.file.digest],
			text
		);
		expect(stale.code).toBe(5);
		expect((await wh(['passage', 'apply', 'wheelhouse', '-', '--base', 'nope'], text)).code).toBe(
			2
		);
		expect((await wh(['passage', 'apply', 'wheelhouse', '-'], text)).code).toBe(2);
	});

	it('checks a task’s preview and a service, and says what is waiting in the inbox', async () => {
		const p = await wh(['preview', 'check', '--task', 'wh-1', '--json']);
		expect(p.code).toBe(1);
		expect(JSON.parse(p.stdout)).toMatchObject({
			schema: 'wheelhouse.preview-check.v1',
			preview: { state: 'none' }
		});
		expect((await wh(['preview', 'check'])).code).toBe(2);
		const service = await wh(['service', 'status', 'nope', 'web']);
		expect(service.code).toBe(1);
		expect(service.stderr).toContain('No such service here');
		const inbox = await json(['inbox']);
		expect(inbox).toMatchObject({ schema: 'wheelhouse.inbox.v1', cards: expect.any(Array) });
	});

	it('exits 3 when no Wheelhouse is running there, and 2 for an address off this computer', async () => {
		const empty = path.join(stateDir, 'no-plugins');
		expect((await wh(['status', '--plugins-dir', empty])).code).toBe(3);
		const closed = await new Promise<number>((resolve) => {
			const s = createServer().listen(0, '127.0.0.1', () => {
				const port = (s.address() as AddressInfo).port;
				s.close(() => resolve(port));
			});
		});
		expect((await wh(['status', '--url', `http://127.0.0.1:${closed}`])).code).toBe(3);
		expect((await wh(['status', '--url', 'http://example.com:4310'])).code).toBe(2);
		expect((await wh(['upgrade', '--source', 'elsewhere'])).code).toBe(2);
		// Found by its address, with no record there to take a token from: changes are refused.
		const blind = await wh([
			'plugin',
			'role',
			'review.surface',
			'builtin',
			'--url',
			base,
			'--plugins-dir',
			empty
		]);
		expect(blind.code).toBe(1);
		expect(blind.stderr).toContain('cannot make changes');
	});

	it('restarts Wheelhouse and waits for it to come back', async () => {
		const r = await wh(['restart', '--yes']);
		expect(r.code, r.stderr).toBe(0);
		expect(r.stdout).toContain(`Wheelhouse ${version} is back at ${base}/`);
		const s = await json(['status']);
		expect(s.canChange).toBe(true);
	});

	it('never prints the token', () => {
		token();
		expect(tokens.size).toBe(2);
		for (const t of tokens) {
			expect(printed.join('\n')).not.toContain(t);
			expect(output).not.toContain(t);
		}
	});
});
