import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunResult } from '../firstmate/exec';
import {
	claudeArgv,
	newSessionId,
	SESSION_ID,
	SessionManager,
	shellLine,
	terminalArgv,
	tmuxLaunchArgv,
	validateLaunch,
	which,
	type Run,
	type SessionRecord
} from './sessions';

const TMUX = '/opt/bin/tmux';
const SOCKET = 'wh-test';
const CLAUDE = '/opt/bin/claude';
const PROJECT = { id: 'wheelhouse', name: 'wheelhouse', path: '/work/wheelhouse' };

let root: string;
let dir: string;
let calls: { file: string; args: readonly string[] }[];
let opened: string[][];
let live: Set<string> | 'no-server' | 'broken';
let launchFails: string | null;
let terminalFails: string | null;
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
	if (args[0] === 'capture-pane') return ok('line 1\nline 2\nline 3\n\n\n');
	return fail(`unexpected ${args[0]}`);
};

function manager(
	opts: {
		missing?: string[];
		terminal?: string | null;
		platform?: NodeJS.Platform;
		tmuxSocket?: string | null;
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
		openTerminal: async (argv) => {
			opened.push(argv);
			return terminalFails;
		},
		terminal: opts.terminal ?? null,
		tmuxSocket: opts.tmuxSocket === undefined ? SOCKET : opts.tmuxSocket,
		platform: opts.platform ?? 'darwin',
		env: {},
		now: () => clock,
		newId: (n) => newSessionId(n, () => 'abcd')
	});
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-sessions-'));
	dir = path.join(root, 'state', 'sessions');
	calls = [];
	opened = [];
	live = 'no-server';
	launchFails = null;
	terminalFails = null;
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

describe('terminal command', () => {
	const attach = [TMUX, 'attach-session', '-t', '=wh-session-x'];

	it('uses Terminal through osascript on macOS by default', () => {
		const argv = terminalArgv(null, 'darwin', attach);
		expect(argv?.[0]).toBe('osascript');
		expect(argv?.[2]).toBe(
			`tell application "Terminal" to do script "${TMUX} attach-session -t =wh-session-x"`
		);
	});

	it('needs a configured terminal elsewhere', () => {
		expect(terminalArgv(null, 'linux', attach)).toBeNull();
	});

	it('expands {attach} into separate arguments and {command} into one', () => {
		expect(terminalArgv('wezterm start -- {attach}', 'linux', attach)).toEqual([
			'wezterm',
			'start',
			'--',
			...attach
		]);
		expect(terminalArgv('kitty sh -c {command}', 'darwin', attach)).toEqual([
			'kitty',
			'sh',
			'-c',
			shellLine(attach)
		]);
		expect(terminalArgv('alacritty -e', 'linux', attach)).toEqual(['alacritty', '-e', ...attach]);
	});

	it('quotes for display only what needs it', () => {
		expect(shellLine(['a', 'b c', "it's"])).toBe(`a 'b c' 'it'\\''s'`);
	});
});

describe('SessionManager', () => {
	it('launches: records the session, starts tmux, opens the terminal', async () => {
		const m = manager();
		const r = await m.launch({ project: PROJECT, prompt: 'think about X' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.terminalError).toBeNull();
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
		expect(opened).toHaveLength(1);
		expect(opened[0][0]).toBe('osascript');
		expect(opened[0][2]).toContain(
			`${TMUX} -L ${SOCKET} attach-session -t =wh-session-20261011-140509-abcd`
		);
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
		expect(opened).toHaveLength(0);
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
			expect(await m.open('20261011-140509-abcd')).toMatchObject({ status: 503 });
		}
		expect(calls).toHaveLength(0);
	});

	it('keeps a started session when the terminal cannot open, and says how to attach', async () => {
		terminalFails = 'osascript exited with code 1';
		const r = await manager().launch({ project: null, prompt: null });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.terminalError).toMatch(/could not open your terminal: osascript exited/);
			expect(r.session.attach).toBe(
				`${TMUX} -L ${SOCKET} attach-session -t =wh-session-20261011-140509-abcd`
			);
		}
	});

	it('says when it does not know how to open a terminal', async () => {
		const r = await manager({ platform: 'linux' }).launch({ project: null, prompt: null });
		expect(r.ok && r.terminalError).toMatch(/--terminal/);
		expect(opened).toHaveLength(0);
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

	it('re-opens the terminal only for a running session', async () => {
		const m = manager();
		const r = await m.launch({ project: null, prompt: null });
		const id = r.ok ? r.session.id : '';
		opened = [];
		expect(await m.open(id)).toEqual({ ok: true });
		expect(opened).toHaveLength(1);
		live = 'no-server';
		expect(await m.open(id)).toMatchObject({ ok: false, status: 409 });
		expect(await m.open('20990101-000000-0000')).toMatchObject({ ok: false, status: 404 });
		expect(await m.open('../../etc')).toMatchObject({ ok: false, status: 404 });
	});

	it('previews a bounded number of lines, read-only', async () => {
		const m = manager();
		const r = await m.launch({ project: null, prompt: null });
		const id = r.ok ? r.session.id : '';
		const out = await m.preview(id, 2);
		expect(out).toMatchObject({ available: true, lines: ['line 2', 'line 3'], requested: 2 });
		const capture = calls.find((c) => c.args[2] === 'capture-pane');
		expect(capture?.args).toEqual([
			'-L',
			SOCKET,
			'capture-pane',
			'-p',
			'-J',
			'-t',
			`=wh-session-${id}:`,
			'-S',
			'-2'
		]);
		expect((await m.preview(id, 10_000))?.requested).toBe(200);
		// Nothing but list, launch and capture ever reaches tmux (no send-keys), and
		// only ever on Wheelhouse's own socket.
		expect(
			calls.every(
				(c) =>
					c.args[0] === '-L' &&
					c.args[1] === SOCKET &&
					['list-sessions', 'new-session', 'capture-pane'].includes(c.args[2] as string)
			)
		).toBe(true);

		live = 'no-server';
		expect(await m.preview(id, 10)).toMatchObject({ available: false, reason: /ended/ });
		expect(await m.preview('20990101-000000-0000', 10)).toBeNull();
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
// with a stand-in for claude and a mocked terminal, so the captain's and
// Firstmate's tmux servers and the captain's terminal are never touched.
describe.skipIf(!which('tmux', process.env.PATH))('with a real tmux', () => {
	let env: NodeJS.ProcessEnv;
	let socket: string;
	let m: SessionManager;
	/** tmux on the throwaway socket only. */
	const tmux = (...args: string[]) =>
		spawnSync(which('tmux', process.env.PATH) as string, ['-L', socket, ...args], {
			env,
			encoding: 'utf8'
		});

	beforeEach(() => {
		const bin = path.join(root, 'bin');
		mkdirSync(bin);
		const claude = path.join(bin, 'claude');
		writeFileSync(claude, '#!/bin/sh\nfor a in "$@"; do echo "arg: $a"; done\nsleep 30\n');
		chmodSync(claude, 0o755);
		const sock = mkdtempSync(path.join(tmpdir(), 'wht-'));
		env = { PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, HOME: root };
		socket = `wh-test-${process.pid}-${path.basename(sock)}`;
		m = new SessionManager({
			dir,
			forbidden: [],
			tmuxSocket: socket,
			openTerminal: async (argv) => {
				opened.push(argv);
				return null;
			},
			env
		});
	});
	afterEach(() => {
		// Only ever the throwaway server this test started.
		tmux('kill-server');
		rmSync(env.TMUX_TMPDIR as string, { recursive: true, force: true });
	});

	it('starts the session, previews it read-only and sees it end', async () => {
		const prompt = `it's "quoted"; $(echo nope)`;
		const r = await m.launch({ project: null, prompt });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.session.state).toBe('alive');
		expect(opened).toHaveLength(1);

		let lines: string[] = [];
		for (let i = 0; i < 40 && !lines.includes(`arg: ${prompt}`); i++) {
			await new Promise((res) => setTimeout(res, 100));
			lines = (await m.preview(r.session.id, 50))?.lines ?? [];
		}
		expect(lines).toContain(`arg: ${prompt}`);
		expect(lines).toContain('arg: --');
		expect((await m.list()).sessions[0].state).toBe('alive');
		expect(tmux('list-sessions', '-F', '#{session_name}').stdout.trim()).toBe(r.session.tmux);

		tmux('kill-session', '-t', `=${r.session.tmux}`);
		expect((await m.list()).sessions[0].state).toBe('ended');
		expect(existsSync(r.session.dir)).toBe(true);
	});
});
