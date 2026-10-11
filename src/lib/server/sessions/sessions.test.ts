import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { RunResult } from '../firstmate/exec';
import { sessionToken } from '../session';
import {
	TERMINAL_CLOSE,
	TERMINAL_PROTOCOL,
	TOKEN_PROTOCOL_PREFIX,
	terminalPath
} from '../../sessions';
import {
	attachHint,
	claudeArgv,
	newSessionId,
	SESSION_ID,
	SessionManager,
	shellLine,
	tmuxLaunchArgv,
	validateLaunch,
	which,
	type Run,
	type SessionRecord
} from './sessions';
import { TerminalServer } from './terminal';

const TMUX = '/opt/bin/tmux';
const SOCKET = 'wh-test';
const CLAUDE = '/opt/bin/claude';
const PROJECT = { id: 'wheelhouse', name: 'wheelhouse', path: '/work/wheelhouse' };

let root: string;
let dir: string;
let calls: { file: string; args: readonly string[] }[];
let live: Set<string> | 'no-server' | 'broken';
let launchFails: string | null;
let trustStore: string;
let clock: number;

const ok = (stdout = ''): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 1 });
const fail = (stderr: string): RunResult => ({
	ok: false,
	kind: 'exit',
	code: 1,
	signal: null,
	stdout: '',
	stderr,
	message: 'exited with code 1',
	durationMs: 1
});

/** A fake tmux: records every call and answers from `live`; only Wheelhouse's socket exists. */
const run: Run = async (file, all) => {
	calls.push({ file, args: all });
	if (all[0] !== '-L' || all[1] !== SOCKET) return fail('not on the Wheelhouse socket');
	const args = all.slice(2);
	if (args[0] === 'list-sessions') {
		if (live === 'no-server') return fail('no server running on /tmp/tmux-501/default');
		if (live === 'broken') return fail('protocol version mismatch');
		return ok([...live, 'other'].join('\n') + '\n');
	}
	if (args[0] === 'new-session') {
		if (launchFails) return fail(launchFails);
		live = live instanceof Set ? live : new Set();
		live.add(args[3]);
		return ok();
	}
	if (args[0] === 'set-option') return ok();
	return fail(`unexpected ${args[0]}`);
};

function manager(
	opts: {
		missing?: string[];
		tmuxSocket?: string | null;
		trustStore?: string | null;
	} = {}
) {
	return new SessionManager({
		dir,
		forbidden: [path.join(root, 'fm-home')],
		find: (name) =>
			opts.missing?.includes(name)
				? null
				: name === 'tmux'
					? TMUX
					: name === 'claude'
						? CLAUDE
						: null,
		run,
		tmuxSocket: opts.tmuxSocket === undefined ? SOCKET : opts.tmuxSocket,
		trustStore: opts.trustStore === undefined ? trustStore : opts.trustStore,
		env: {},
		now: () => clock,
		newId: (n) => newSessionId(n, () => 'abcd')
	});
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-sessions-'));
	dir = path.join(root, 'state', 'sessions');
	calls = [];
	live = 'no-server';
	launchFails = null;
	// Claude Code's config store is a temporary file, never the real ~/.claude.json.
	trustStore = path.join(root, 'claude-config', '.claude.json');
	mkdirSync(path.dirname(trustStore));
	clock = Date.parse('2026-10-11T14:05:09Z');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
	schema: 'wheelhouse-session.v1',
	id: '20261011-140509-abcd',
	createdAt: '2026-10-11T14:05:09.000Z',
	project: null,
	prompt: null,
	dir: '/state/sessions/20261011-140509-abcd',
	...over
});

describe('launch argv', () => {
	it('starts a blank idea with the opening note and no project access', () => {
		const argv = claudeArgv(CLAUDE, record());
		expect(argv[0]).toBe(CLAUDE);
		expect(argv).not.toContain('--add-dir');
		expect(argv[1]).toBe('--append-system-prompt');
		expect(argv[2]).toMatch(/new idea/);
		expect(argv[2]).toContain('/state/sessions/20261011-140509-abcd');
		expect(argv).toHaveLength(3);
	});

	it('gives a project session read access to the project and says not to edit it', () => {
		const argv = claudeArgv(CLAUDE, record({ project: PROJECT }));
		expect(argv.slice(0, 3)).toEqual([CLAUDE, '--add-dir', '/work/wheelhouse']);
		const note = argv[argv.indexOf('--append-system-prompt') + 1];
		expect(note).toMatch(/reading and brainstorming only/);
		expect(note).toMatch(/Do not edit/);
	});

	it('does not attach a project whose path is unknown', () => {
		const argv = claudeArgv(CLAUDE, record({ project: { ...PROJECT, path: null } }));
		expect(argv).not.toContain('--add-dir');
		expect(argv[argv.indexOf('--append-system-prompt') + 1]).toMatch(/does not know where/);
	});

	it('passes the prompt as one argument after --, untouched', () => {
		const prompt = `--dangerously-skip-permissions "$(rm -rf ~)"; echo 'hi' \`x\`\nline two`;
		const argv = claudeArgv(CLAUDE, record({ prompt }));
		expect(argv.slice(-2)).toEqual(['--', prompt]);
	});

	it('runs claude directly in a detached tmux session in the scratch directory', () => {
		const r = record({ project: PROJECT, prompt: 'hello' });
		const argv = tmuxLaunchArgv(r, CLAUDE);
		expect(argv.slice(0, 7)).toEqual([
			'new-session',
			'-d',
			'-s',
			'wh-session-20261011-140509-abcd',
			'-c',
			r.dir,
			'--'
		]);
		expect(argv.slice(7)).toEqual(claudeArgv(CLAUDE, r));
		// More than one command argument: tmux executes it without a shell.
		expect(argv.slice(7).length).toBeGreaterThan(1);
	});

	it('makes time-ordered ids that are safe in a tmux name and a path', () => {
		const id = newSessionId(clock, () => '0f3a9c');
		expect(id).toBe('20261011-140509-0f3a9c');
		expect(SESSION_ID.test(id)).toBe(true);
		expect(SESSION_ID.test('../x')).toBe(false);
	});
});

describe('attach hint', () => {
	it('is a short tmux attach on Wheelhouse’s own socket, quoted only where needed', () => {
		expect(attachHint('wheelhouse', '20261011-140509-abcd')).toBe(
			'tmux -L wheelhouse attach -t wh-session-20261011-140509-abcd'
		);
		expect(shellLine(['a', 'b c', "it's"])).toBe(`a 'b c' 'it'\\''s'`);
	});
});

describe('SessionManager', () => {
	it('launches: records the session, trusts its directory, starts tmux', async () => {
		const m = manager();
		const r = await m.launch({ project: PROJECT, prompt: 'think about X' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.warning).toBeNull();
		expect(r.session).toMatchObject({
			id: '20261011-140509-abcd',
			tmux: 'wh-session-20261011-140509-abcd',
			project: PROJECT,
			prompt: 'think about X',
			state: 'alive',
			dir: path.join(dir, '20261011-140509-abcd')
		});
		expect(existsSync(r.session.dir)).toBe(true);
		const saved = JSON.parse(readFileSync(path.join(dir, '20261011-140509-abcd.json'), 'utf8'));
		expect(saved).toMatchObject({ schema: 'wheelhouse-session.v1', prompt: 'think about X' });

		const launch = calls.find((c) => c.args[2] === 'new-session');
		expect(launch?.file).toBe(TMUX);
		expect(launch?.args).toEqual(['-L', SOCKET, ...tmuxLaunchArgv(saved, CLAUDE)]);
		// Shown in the browser: the wheel scrolls tmux's history, and no status bar.
		expect(calls.filter((c) => c.args[2] === 'set-option').map((c) => c.args.slice(2))).toEqual([
			['set-option', '-t', '=wh-session-20261011-140509-abcd:', 'mouse', 'on'],
			['set-option', '-t', '=wh-session-20261011-140509-abcd:', 'status', 'off']
		]);
		expect(r.session.attach).toBe(attachHint(SOCKET, '20261011-140509-abcd'));
		// Workspace trust is recorded for exactly the new scratch directory.
		const store = JSON.parse(readFileSync(trustStore, 'utf8'));
		expect(store.projects).toEqual({
			[realpathSync(r.session.dir)]: { hasTrustDialogAccepted: true }
		});
	});

	it('still starts the session when trust cannot be recorded, and says so', async () => {
		writeFileSync(trustStore, '[1, 2]');
		const r = await manager().launch({ project: null, prompt: null });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.warning).toMatch(/workspace trust .* not a JSON object/);
		expect(readFileSync(trustStore, 'utf8')).toBe('[1, 2]');
	});

	it('records no trust when there is no store', async () => {
		const r = await manager({ trustStore: null }).launch({ project: null, prompt: null });
		expect(r.ok && r.warning).toBeNull();
		expect(existsSync(trustStore)).toBe(false);
	});

	it('refuses honestly when tmux is missing, and starts nothing', async () => {
		const r = await manager({ missing: ['tmux'] }).launch({ project: null, prompt: null });
		expect(r).toMatchObject({ ok: false, status: 503 });
		if (!r.ok) expect(r.error).toMatch(/tmux is not installed/);
		expect(calls).toHaveLength(0);
		expect(existsSync(dir)).toBe(false);
	});

	it('refuses honestly when claude is missing', async () => {
		const m = manager({ missing: ['claude'] });
		const r = await m.launch({ project: null, prompt: null });
		expect(r).toMatchObject({ ok: false, status: 503 });
		if (!r.ok) expect(r.error).toMatch(/Claude Code .* not installed/);
		expect((await m.list()).available).toBe(false);
	});

	it('cleans up when tmux cannot start the session', async () => {
		launchFails = 'duplicate session';
		const r = await manager().launch({ project: null, prompt: null });
		expect(r).toMatchObject({ ok: false, status: 500 });
		if (!r.ok) expect(r.error).toMatch(/duplicate session/);
		expect(existsSync(path.join(dir, '20261011-140509-abcd'))).toBe(false);
		expect(existsSync(path.join(dir, '20261011-140509-abcd.json'))).toBe(false);
	});

	it('keeps every tmux call on its own socket, `wheelhouse` by default', async () => {
		const m = manager({ tmuxSocket: null });
		expect(m.tmuxSocket).toBe('wheelhouse');
		const r = await m.launch({ project: null, prompt: null });
		// The fake tmux only answers on SOCKET, so launching on the default fails...
		expect(r).toMatchObject({ ok: false, status: 500 });
		// ...but the call itself named the default socket, never the default server.
		expect(calls.map((c) => c.args.slice(0, 3))).toEqual([['-L', 'wheelhouse', 'new-session']]);
	});

	it('refuses a socket name that is a path, and starts nothing', async () => {
		for (const tmuxSocket of ['../default', '/tmp/tmux-501/default', '-S', 'a b']) {
			const m = manager({ tmuxSocket });
			expect(m.unavailable()).toMatch(/socket name/);
			expect(await m.launch({ project: null, prompt: null })).toMatchObject({ status: 503 });
			expect(await m.terminal('20261011-140509-abcd')).toMatchObject({ status: 503 });
		}
		expect(calls).toHaveLength(0);
	});

	it('never puts a scratch directory inside the Firstmate home or the project', async () => {
		dir = path.join(root, 'fm-home', 'sessions');
		expect((await manager().launch({ project: null, prompt: null })).ok).toBe(false);
		dir = path.join(root, 'state', 'sessions');
		const inside = { ...PROJECT, path: path.join(root, 'state') };
		const r = await manager().launch({ project: inside, prompt: null });
		expect(r).toMatchObject({ ok: false, status: 409 });
		expect(calls.some((c) => c.args[2] === 'new-session')).toBe(false);
	});

	it('lists newest first and tells running from ended', async () => {
		const m = manager();
		await m.launch({ project: null, prompt: 'first' });
		clock += 60_000;
		await m.launch({ project: PROJECT, prompt: 'second' });
		live = new Set(['wh-session-20261011-140609-abcd']);
		const v = await m.list();
		expect(v.available).toBe(true);
		expect(v.sessions.map((s) => [s.prompt, s.state])).toEqual([
			['second', 'alive'],
			['first', 'ended']
		]);

		live = 'no-server';
		expect((await m.list()).sessions.every((s) => s.state === 'ended')).toBe(true);
		live = 'broken';
		expect((await m.list()).sessions.every((s) => s.state === 'unknown')).toBe(true);
	});

	it('ignores files that are not session records', async () => {
		mkdirSync(dir, { recursive: true });
		const m = manager();
		await m.launch({ project: null, prompt: null });
		writeFileSync(path.join(dir, 'junk.json'), '{}');
		writeFileSync(path.join(dir, '20261011-000000-ffff.json'), 'not json');
		expect((await m.list()).sessions).toHaveLength(1);
	});

	it('attaches the live terminal only to its own running sessions, on its own socket', async () => {
		const m = manager();
		const r = await m.launch({ project: null, prompt: null });
		const id = r.ok ? r.session.id : '';
		const t = await m.terminal(id);
		expect(t).toMatchObject({
			ok: true,
			target: {
				argv: [TMUX, '-L', SOCKET, 'attach-session', '-t', `=wh-session-${id}`],
				cwd: path.join(dir, id)
			}
		});
		if (t.ok) expect(t.target.env.TERM).toBe('xterm-256color');
		// 'other' is live on the socket, but Wheelhouse has no record of launching it.
		expect(await m.terminal('20261011-140509-ffff')).toMatchObject({ ok: false, status: 404 });
		expect(await m.terminal('../../etc')).toMatchObject({ ok: false, status: 404 });
		expect(await m.terminal('other')).toMatchObject({ ok: false, status: 404 });
		live = 'broken';
		expect(await m.terminal(id)).toMatchObject({ ok: false, status: 503 });
		live = 'no-server';
		expect(await m.terminal(id)).toMatchObject({ ok: false, status: 409 });
		// Nothing but list, launch and options ever reaches tmux (no send-keys), and
		// only ever on Wheelhouse's own socket.
		expect(
			calls.every(
				(c) =>
					c.args[0] === '-L' &&
					c.args[1] === SOCKET &&
					['list-sessions', 'new-session', 'set-option'].includes(c.args[2] as string)
			)
		).toBe(true);
	});
});

describe('validateLaunch', () => {
	const projects = [PROJECT];

	it('accepts a blank idea or a known project, with an optional prompt', () => {
		expect(validateLaunch({}, projects)).toEqual({
			ok: true,
			input: { project: null, prompt: null }
		});
		expect(validateLaunch({ projectId: null, prompt: '  ' }, projects)).toEqual({
			ok: true,
			input: { project: null, prompt: null }
		});
		expect(validateLaunch({ projectId: 'wheelhouse', prompt: ' go ' }, projects)).toEqual({
			ok: true,
			input: { project: PROJECT, prompt: 'go' }
		});
	});

	it('takes the project path from Wheelhouse, never from the request', () => {
		const r = validateLaunch({ projectId: 'wheelhouse', path: '/etc' }, projects);
		expect(r.ok && r.input.project?.path).toBe('/work/wheelhouse');
	});

	it('refuses unknown projects, bad types and oversized prompts', () => {
		expect(validateLaunch({ projectId: 'nope' }, projects)).toMatchObject({
			ok: false,
			status: 400
		});
		expect(validateLaunch({ projectId: 3 }, projects)).toMatchObject({ ok: false, status: 400 });
		expect(validateLaunch({ prompt: 3 }, projects)).toMatchObject({ ok: false, status: 400 });
		expect(validateLaunch({ prompt: 'a\0b' }, projects)).toMatchObject({ ok: false, status: 400 });
		expect(validateLaunch({ prompt: 'x'.repeat(9000) }, projects)).toMatchObject({
			ok: false,
			status: 413
		});
	});
});

describe('which', () => {
	it('finds an executable on PATH and nothing else', () => {
		expect(which('sh', '/nonexistent:/bin')).toBe('/bin/sh');
		expect(which('definitely-not-a-program', '/bin')).toBeNull();
		expect(which('sh', undefined)).toBeNull();
	});
});

// A real tmux on a throwaway socket (its own -L name under a private TMUX_TMPDIR),
// a stand-in for claude and a real pty behind the live terminal, so the captain's
// and Firstmate's tmux servers are never touched.
describe.skipIf(!which('tmux', process.env.PATH))('with a real tmux', () => {
	let env: NodeJS.ProcessEnv;
	let socket: string;
	let m: SessionManager;
	let terminals: TerminalServer;
	let server: Server;
	let origin: string;
	/** tmux on the throwaway socket only. */
	const tmux = (...args: string[]) =>
		spawnSync(which('tmux', process.env.PATH) as string, ['-L', socket, ...args], {
			env,
			encoding: 'utf8'
		});

	beforeEach(async () => {
		const bin = path.join(root, 'bin');
		mkdirSync(bin);
		const claude = path.join(bin, 'claude');
		// Prints its arguments, then echoes each line it reads back as `got: <line>`.
		writeFileSync(
			claude,
			'#!/bin/sh\nfor a in "$@"; do echo "arg: $a"; done\nwhile read -r l; do echo "got: $l"; done\n'
		);
		chmodSync(claude, 0o755);
		const sock = mkdtempSync(path.join(tmpdir(), 'wht-'));
		env = { PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, HOME: root };
		socket = `wh-test-${process.pid}-${path.basename(sock)}`;
		m = new SessionManager({ dir, forbidden: [], tmuxSocket: socket, trustStore, env });
		terminals = new TerminalServer({ resolve: m.terminal });
		server = createServer((_req, res) => res.writeHead(404).end());
		server.on('upgrade', (req, sock, head) => terminals.handleUpgrade(req, sock, head));
		await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterEach(async () => {
		terminals.close();
		await new Promise((res) => server.close(res));
		// Only ever the throwaway server this test started.
		tmux('kill-server');
		rmSync(env.TMUX_TMPDIR as string, { recursive: true, force: true });
	});

	const connect = (id: string) =>
		new WebSocket(
			`${origin.replace('http', 'ws')}${terminalPath(id)}?cols=100&rows=30`,
			[TERMINAL_PROTOCOL, TOKEN_PROTOCOL_PREFIX + sessionToken()],
			{ origin }
		);

	it('starts the session, types into it from the browser and sees it end', async () => {
		const prompt = `it's "quoted"; $(echo nope)`;
		const r = await m.launch({ project: null, prompt });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.session.state).toBe('alive');
		expect(tmux('list-sessions', '-F', '#{session_name}').stdout.trim()).toBe(r.session.tmux);
		expect(tmux('show-options', '-t', r.session.tmux, '-v', 'mouse').stdout.trim()).toBe('on');

		const ws = connect(r.session.id);
		let screen = '';
		ws.on('message', (d: Buffer) => (screen += d.toString('utf8')));
		await new Promise((res, rej) => ws.once('open', res).once('error', rej));
		const until = async (re: RegExp) => {
			for (let i = 0; i < 50 && !re.test(screen); i++)
				await new Promise((res) => setTimeout(res, 100));
			expect(screen).toMatch(re);
		};
		await until(/arg: --/);
		expect(screen).toContain(`arg: ${prompt}`);
		ws.send(JSON.stringify({ type: 'input', data: 'hello from the browser\r' }));
		await until(/got: hello from the browser/);
		// The browser's size reaches the session.
		ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
		for (
			let i = 0;
			i < 20 &&
			tmux('display-message', '-p', '-t', r.session.tmux, '#{window_width}').stdout.trim() !==
				'120';
			i++
		)
			await new Promise((res) => setTimeout(res, 100));
		expect(
			tmux('display-message', '-p', '-t', r.session.tmux, '#{window_width}').stdout.trim()
		).toBe('120');

		// Closing the browser's terminal detaches; the session keeps running.
		const closed = new Promise((res) => ws.once('close', res));
		ws.close();
		await closed;
		expect((await m.list()).sessions[0].state).toBe('alive');

		// When the session ends, a connected terminal is told so.
		const again = connect(r.session.id);
		await new Promise((res, rej) => again.once('open', res).once('error', rej));
		const ended = new Promise<number>((res) => again.once('close', (code) => res(code)));
		tmux('kill-session', '-t', `=${r.session.tmux}`);
		expect(await ended).toBe(TERMINAL_CLOSE.detached);
		expect((await m.list()).sessions[0].state).toBe('ended');
		expect(existsSync(r.session.dir)).toBe(true);
	});

	it('never attaches to a session it did not launch, even on its own socket', async () => {
		// A session on the throwaway socket with a Wheelhouse-shaped name but no record.
		tmux('new-session', '-d', '-s', 'wh-session-20261011-140509-beef', 'sleep', '30');
		const ws = connect('20261011-140509-beef');
		const status = await new Promise<number>((res) =>
			ws.once('unexpected-response', (_req, resp) => res(resp.statusCode ?? 0))
		);
		expect(status).toBe(404);
		expect(terminals.connections).toBe(0);
	});
});
