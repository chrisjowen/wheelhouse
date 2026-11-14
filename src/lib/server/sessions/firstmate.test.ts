import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunOptions, RunResult } from '../firstmate/exec';
import type { BackendResult, LaunchSpec, SessionBackend, SessionKey } from './backend';
import {
	claudeArgv,
	codexArgv,
	FirstmateSession,
	HERDR_RECORD,
	INPUT_MAX_BYTES,
	launchSpec,
	sessionSettings,
	type LaunchOptions,
	type LockState
} from './firstmate';
import { FIRSTMATE_TMUX, launchArgv as tmuxLaunchArgv, TmuxBackend, type Run } from './tmux';
import { HerdrBackend } from './herdr';
import { fakeHerdr, type FakeHerdr } from '../../../../tests/helpers/fake-herdr';

/** The tmux arguments that start a primary launched with `options`. */
const launchArgv = (options: LaunchOptions) => tmuxLaunchArgv(launchSpec(options), '/env');

const TMUX = '/opt/bin/tmux';
const CLAUDE = '/opt/bin/claude';
const SOCKET = 'wh-test';

let root: string;
let firstmateDir: string;
let stateDir: string;
let trustStore: string;
let calls: { file: string; args: readonly string[]; opts: RunOptions }[];
let live: Set<string> | 'no-server' | 'broken';
let lock: LockState;
let launchFails: string | null;
let screen: string;
let savedHarness: string;
let savedRecorder: string;
let savedNonce: string;
/** What a key pressed into the fake session does to its screen. */
let onKey: ((key: string) => void) | null;

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

/** A fake tmux that answers only on Wheelhouse's socket and records every call. */
const run: Run = async (file, all, opts) => {
	calls.push({ file, args: all, opts });
	if (all[0] !== '-L' || all[1] !== SOCKET) return fail('not on the Wheelhouse socket');
	const args = all.slice(2);
	if (args[0] === 'list-sessions') {
		if (live === 'no-server') return fail('no server running on /tmp/tmux-501/wh-test');
		if (live === 'broken') return fail('protocol version mismatch');
		return ok([...live, 'other'].join('\n') + '\n');
	}
	if (args[0] === 'capture-pane') return ok(screen);
	if (args[0] === 'show-environment')
		return ok(
			args[3] === 'WH_SESSION_RECORD'
				? savedRecorder
				: args[3] === 'WH_SESSION_NONCE'
					? savedNonce
					: savedHarness
		);
	if (args[0] === 'send-keys') onKey?.(args[3]);
	if (args[0] === 'new-session') {
		if (launchFails) return fail(launchFails);
		live = live instanceof Set ? live : new Set();
		live.add(args[3]);
		savedHarness = args.find((arg) => arg.startsWith('WHEELHOUSE_HARNESS=')) ?? '';
		savedRecorder = args.find((arg) => arg.startsWith('WH_SESSION_RECORD=')) ?? '';
		savedNonce = args.find((arg) => arg.startsWith('WH_SESSION_NONCE=')) ?? '';
	}
	return ok();
};

const tmuxCalls = () => calls.map((c) => c.args.slice(2));

function session(extra: Partial<ConstructorParameters<typeof FirstmateSession>[0]> = {}) {
	return new FirstmateSession({
		firstmateDir,
		homeDir: firstmateDir,
		stateDir,
		lock: async () => lock,
		tmuxSocket: SOCKET,
		env: { PATH: '/opt/bin', HOME: root, TMUX: 'outer', CLAUDECODE: '1', FM_HOME: '/x' },
		find: (name) => (name === 'tmux' ? TMUX : name === 'claude' ? CLAUDE : null),
		run,
		trustStore,
		sleep: async () => {},
		...extra
	});
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-firstmate-')));
	firstmateDir = path.join(root, 'firstmate');
	stateDir = path.join(root, 'state');
	mkdirSync(firstmateDir);
	trustStore = path.join(root, '.claude.json');
	writeFileSync(trustStore, '{}\n');
	calls = [];
	live = new Set();
	lock = 'free';
	launchFails = null;
	screen = '';
	savedHarness = '';
	savedRecorder = '';
	savedNonce = '';
	onKey = null;
});

const MENU = ['Which colour?', '❯ 1. Red', '  2. Green', 'Enter to select · Esc to cancel'].join(
	'\n'
);
const OVERLINE = '▔'.repeat(40);
const MCP = [
	OVERLINE,
	'   Manage MCP servers',
	'   ❯ notes · ✔ connected',
	'   ↑/↓ to navigate · Enter to confirm · Esc to cancel'
].join('\n');
const MCP_SERVER = [
	OVERLINE,
	'   Notes MCP Server',
	'   ❯ 1. View tools',
	'     2. Disable',
	'   ↑/↓ to navigate · Enter to select · Esc to back'
].join('\n');
const PROMPT = ['─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏵⏵ bypass permissions on'].join('\n');
const escapes = () => tmuxCalls().filter((a) => a[0] === 'send-keys' && a[3] === 'Escape').length;

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('launch command', () => {
	it('keeps OpenCode API credentials out of process arguments', () => {
		const argv = launchArgv({
			binary: '/bin/opencode',
			firstmateDir: '/work/firstmate',
			hookFile: '/state/session.json',
			fmHome: null,
			harness: 'opencode',
			connectionFile: '/state/opencode.json'
		});
		expect(argv.join(' ')).not.toContain('OPENCODE_SERVER_PASSWORD=');
		expect(argv).toContain('WH_OPENCODE_CONNECTION=/state/opencode.json');
	});
	it('runs the bounded Codex hook recorder and stamps its launch nonce without altering native payload fields', () => {
		const record = {
			session_id: 'native-id',
			cwd: firstmateDir,
			transcript_path: '/native/rollout.jsonl'
		};
		const file = path.join(stateDir, 'native.json');
		mkdirSync(stateDir, { recursive: true });
		const option = codexArgv('/bin/codex')[2];
		const match = /command=(.*),timeout=10/.exec(option);
		if (!match) throw new Error('missing hook command');
		const command: unknown = JSON.parse(match[1]);
		if (typeof command !== 'string') throw new Error('invalid hook command');
		execFileSync('bash', ['-c', command], {
			env: { ...process.env, WH_SESSION_RECORD: file, WH_SESSION_NONCE: 'launch-one' },
			input: JSON.stringify(record)
		});
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
			...record,
			wheelhouse_nonce: 'launch-one'
		});
		expect(() =>
			execFileSync('bash', ['-c', command], {
				env: { ...process.env, WH_SESSION_RECORD: file, WH_SESSION_NONCE: 'launch-two' },
				input: 'x'.repeat(70_000),
				stdio: ['pipe', 'pipe', 'pipe']
			})
		).toThrow();
		expect(JSON.parse(readFileSync(file, 'utf8')).wheelhouse_nonce).toBe('launch-one');
	});
	it.each(['codex', 'pi'] as const)(
		'runs %s with its own defaults, without Claude hooks or trust changes',
		async (harness) => {
			const s = session({
				harness,
				find: (name) => (name === 'tmux' ? TMUX : name === harness ? `/opt/bin/${harness}` : null)
			});
			expect(await s.ensure()).toMatchObject({ state: 'ours', harness, skipPermissions: false });
			const argv = tmuxCalls().find((args) => args[0] === 'new-session')!;
			expect(argv.slice(argv.indexOf(`/opt/bin/${harness}`))).toEqual(
				harness === 'codex'
					? codexArgv('/opt/bin/codex')
					: ['/opt/bin/pi', '--extension', path.join(stateDir, 'firstmate', 'pi-extension.mjs')]
			);
			expect(argv).toContain(`WHEELHOUSE_HARNESS=${harness}`);
			expect(readFileSync(trustStore, 'utf8')).toBe('{}\n');
			if (harness === 'codex') screen = '› Ask Codex to do anything\n\n  ? for shortcuts';
			if (harness === 'pi')
				screen =
					'────────────────────────\n\n────────────────────────\n/tmp/project\n0 tokens (no model)';
			expect(await s.status()).toMatchObject({ harness, picker: null, menu: null });
			screen = 'Unknown startup screen';
			expect(await s.send('hello')).toMatchObject({ ok: false, status: 409 });
			expect((await s.terminal()).ok).toBe(true);
			expect(tmuxCalls().some((args) => args[0] === 'load-buffer')).toBe(false);
		}
	);

	it('starts Pi with the provider chosen when it starts, not when Wheelhouse did', async () => {
		let provider: string | null = 'openai-codex';
		const s = session({
			harness: 'pi',
			piProvider: () => provider,
			find: (name) => (name === 'tmux' ? TMUX : name === 'pi' ? '/opt/bin/pi' : null)
		});
		const launched = () => {
			const argv = tmuxCalls().findLast((args) => args[0] === 'new-session')!;
			return argv.slice(argv.indexOf('--') + 1);
		};
		await s.ensure();
		expect(launched().slice(-2)).toEqual(['--provider', 'openai-codex']);
		live = new Set();
		provider = 'openai';
		await s.ensure();
		expect(launched().slice(-2)).toEqual(['--provider', 'openai']);
	});

	it('recognizes the running harness after a restart even if another harness was requested or is missing', async () => {
		live = new Set([FIRSTMATE_TMUX]);
		savedHarness = 'WHEELHOUSE_HARNESS=codex';
		const s = session({ find: (name) => (name === 'tmux' ? TMUX : null) });
		expect(await s.status()).toMatchObject({ state: 'ours', harness: 'codex' });
		expect(await s.ensure()).toMatchObject({ state: 'ours', harness: 'codex' });
		expect((await s.terminal()).ok).toBe(true);
		expect(tmuxCalls().some((args) => args[0] === 'new-session')).toBe(false);
	});

	it('refuses an unrecognized running harness', async () => {
		live = new Set([FIRSTMATE_TMUX]);
		savedHarness = 'WHEELHOUSE_HARNESS=unknown';
		expect((await session().status()).state).toBe('unavailable');
		expect((await session().terminal()).ok).toBe(false);
	});

	it('keeps an older Codex session accessible in the drawer but blocks untracked chat input', async () => {
		live = new Set([FIRSTMATE_TMUX]);
		savedHarness = 'WHEELHOUSE_HARNESS=codex';
		const s = session();
		expect(await s.status()).toMatchObject({
			state: 'ours',
			canSend: false,
			reason: expect.stringContaining('predates chat integration')
		});
		expect((await s.terminal()).ok).toBe(true);
		expect(await s.send('hello')).toMatchObject({ ok: false, status: 409 });
	});

	it('sends a Codex chat message only at a proven composer and rejects stale choices', async () => {
		const s = session({
			harness: 'codex',
			find: (name) => (name === 'tmux' ? TMUX : name === 'codex' ? '/opt/bin/codex' : null)
		});
		await s.ensure();
		screen = '› Ask Codex to do anything\n\n  ? for shortcuts';
		expect(await s.send('hello\nthere')).toEqual({ ok: true });
		const before = tmuxCalls().filter((args) => args[0] === 'load-buffer').length;
		screen = 'Allow command printf ok?\n› 1. Yes\n  2. No\nenter confirm · esc cancel';
		expect(await s.send('this must not approve')).toMatchObject({ ok: false, status: 409 });
		expect(tmuxCalls().filter((args) => args[0] === 'load-buffer')).toHaveLength(before);
		const picker = await s.picker();
		if (!picker) throw new Error('missing native picker');
		screen = screen.replace('printf ok', 'rm sensitive');
		expect(await s.pick(picker.signature, { press: 1 })).toMatchObject({ ok: false, status: 409 });
		const current = await s.picker();
		if (!current) throw new Error('missing native picker');
		expect(await s.pick(current.signature, { press: 2 })).toEqual({ ok: true });
		expect(
			tmuxCalls()
				.filter((args) => args[0] === 'send-keys')
				.slice(-2)
				.map((args) => args[3])
		).toEqual(['Down', 'Enter']);
	});

	it('runs claude with --dangerously-skip-permissions and Wheelhouse’s hook by default', () => {
		const hook = '/state dir/firstmate/session-start.json';
		const argv = claudeArgv(CLAUDE, hook, true);
		expect(argv.slice(0, 3)).toEqual([CLAUDE, '--dangerously-skip-permissions', '--settings']);
		const settings = JSON.parse(argv[3]);
		expect(settings.skipDangerousModePermissionPrompt).toBe(true);
		const command = settings.hooks.SessionStart[0].hooks[0].command;
		expect(command).toBe(
			"cat > '/state dir/firstmate/session-start.json.tmp' && mv -f '/state dir/firstmate/session-start.json.tmp' '/state dir/firstmate/session-start.json'"
		);
	});

	it('leaves permissions alone when the captain turned skipping off', () => {
		const argv = claudeArgv(CLAUDE, '/s/h.json', false);
		expect(argv).not.toContain('--dangerously-skip-permissions');
		expect(
			JSON.parse(sessionSettings('/s/h.json', false)).skipDangerousModePermissionPrompt
		).toBeUndefined();
	});

	it('starts detached in Firstmate’s checkout, passing FM_HOME only when the home differs', () => {
		const argv = launchArgv({
			binary: CLAUDE,
			firstmateDir: '/work/firstmate',
			hookFile: '/s/h.json',
			harness: 'claude',
			skipPermissions: true,
			fmHome: null
		});
		expect(argv.slice(0, 4)).toEqual(['new-session', '-d', '-s', FIRSTMATE_TMUX]);
		expect(argv).toContain('/work/firstmate');
		expect(argv).toContain('WHEELHOUSE_HARNESS=claude');
		expect(argv.some((arg) => arg.startsWith('FM_HOME='))).toBe(false);
		expect(argv.indexOf(CLAUDE)).toBeGreaterThan(argv.indexOf('--'));
		const withHome = launchArgv({
			binary: CLAUDE,
			firstmateDir: '/work/firstmate',
			hookFile: '/s/h.json',
			harness: 'claude',
			skipPermissions: true,
			fmHome: '/ops/home'
		});
		expect(withHome).toContain('FM_HOME=/ops/home');
	});
});

describe('status', () => {
	it('is ours when Wheelhouse’s tmux session is running, whatever the lock says', async () => {
		live = new Set([FIRSTMATE_TMUX]);
		lock = 'held';
		const v = await session().status();
		expect(v).toMatchObject({
			state: 'ours',
			canSend: true,
			attach: `tmux -L ${SOCKET} attach -t wh-firstmate`
		});
	});

	it('is external, read-only, when another session holds Firstmate’s lock', async () => {
		lock = 'held';
		const v = await session().status();
		expect(v).toMatchObject({ state: 'external', canSend: false, attach: null });
		expect(v.reason).toMatch(/another terminal/);
	});

	it('is none when nothing runs, including when tmux has no server yet', async () => {
		live = 'no-server';
		expect((await session().status()).state).toBe('none');
	});

	it('is unavailable when tmux or claude is missing, or the state directory is in the home', async () => {
		expect((await session({ find: () => null }).status()).state).toBe('unavailable');
		const inside = session({ stateDir: path.join(firstmateDir, 'state') });
		expect((await inside.status()).reason).toMatch(/inside the Firstmate home/);
		live = 'broken';
		expect((await session().status()).state).toBe('unavailable');
	});
});

describe('ensure', () => {
	it('starts the session when the lock is free, on Wheelhouse’s socket only', async () => {
		const s = session();
		const v = await s.ensure();
		expect(v.state).toBe('ours');
		const launch = calls.find((c) => c.args[2] === 'new-session');
		expect(launch?.file).toBe(TMUX);
		expect(launch?.args.slice(0, 2)).toEqual(['-L', SOCKET]);
		expect(launch?.opts.cwd).toBe(firstmateDir);
		expect(launch?.opts.env).not.toHaveProperty('TMUX');
		expect(launch?.opts.env).not.toHaveProperty('CLAUDECODE');
		expect(launch?.opts.env).not.toHaveProperty('FM_HOME');
		expect(
			tmuxCalls()
				.filter((a) => a[0] === 'set-option')
				.map((a) => a[3])
		).toEqual(['mouse', 'status', 'history-limit']);
		expect(calls.every((c) => c.args[0] === '-L' && c.args[1] === SOCKET)).toBe(true);
		const trust = JSON.parse(readFileSync(trustStore, 'utf8'));
		expect(trust.projects[firstmateDir].hasTrustDialogAccepted).toBe(true);
	});

	it('never starts a second session when another holds the lock', async () => {
		lock = 'held';
		expect((await session().ensure()).state).toBe('external');
		expect(tmuxCalls().some((a) => a[0] === 'new-session')).toBe(false);
	});

	it('does not start when the lock cannot be read', async () => {
		lock = 'unknown';
		const v = await session().ensure();
		expect(v.state).toBe('unavailable');
		expect(v.reason).toMatch(/session lock/);
		expect(tmuxCalls().some((a) => a[0] === 'new-session')).toBe(false);
	});

	it('leaves a running session alone and starts only once when asked twice at once', async () => {
		const s = session();
		await Promise.all([s.ensure(), s.ensure()]);
		expect(tmuxCalls().filter((a) => a[0] === 'new-session')).toHaveLength(1);
		await s.ensure();
		expect(tmuxCalls().filter((a) => a[0] === 'new-session')).toHaveLength(1);
	});

	it('reports what tmux said when it cannot start', async () => {
		launchFails = 'duplicate session';
		const v = await session().ensure();
		expect(v).toMatchObject({
			state: 'unavailable',
			reason: 'tmux could not start Firstmate: duplicate session'
		});
	});
});

describe('input', () => {
	beforeEach(() => {
		live = new Set([FIRSTMATE_TMUX]);
	});

	it('pastes the message as one bracketed paste, then presses Enter', async () => {
		const r = await session().send('Line one\r\nline two\n');
		expect(r).toEqual({ ok: true });
		const load = calls.find((c) => c.args[2] === 'load-buffer');
		expect(load?.args.slice(2)).toEqual(['load-buffer', '-b', 'wh-firstmate-input', '-']);
		expect(load?.opts.input).toBe('Line one\nline two');
		const rest = tmuxCalls().filter((a) => a[0] === 'paste-buffer' || a[0] === 'send-keys');
		expect(rest).toEqual([
			['paste-buffer', '-d', '-p', '-b', 'wh-firstmate-input', '-t', '=wh-firstmate:'],
			['send-keys', '-t', '=wh-firstmate:', 'Enter']
		]);
	});

	it('refuses empty, oversized or binary messages without touching tmux', async () => {
		const s = session();
		expect(await s.send('  ')).toMatchObject({ ok: false, status: 400 });
		expect(await s.send('a\0b')).toMatchObject({ ok: false, status: 400 });
		expect(await s.send('x'.repeat(INPUT_MAX_BYTES + 1))).toMatchObject({ ok: false, status: 413 });
		expect(tmuxCalls().some((a) => a[0] === 'load-buffer')).toBe(false);
	});

	it('refuses to type into a session that is not Wheelhouse’s', async () => {
		live = new Set();
		expect(await session().send('hello')).toMatchObject({ ok: false, status: 409 });
		expect(await session().interrupt()).toMatchObject({ ok: false, status: 409 });
	});

	it('sends messages one at a time, in order', async () => {
		const s = session();
		await Promise.all([s.send('first'), s.send('second')]);
		const loads = calls.filter((c) => c.args[2] === 'load-buffer').map((c) => c.opts.input);
		expect(loads).toEqual(['first', 'second']);
		const kinds = tmuxCalls()
			.map((a) => a[0])
			.filter((k) => k !== 'list-sessions' && k !== 'show-environment');
		expect(kinds).toEqual([
			'capture-pane',
			'load-buffer',
			'paste-buffer',
			'send-keys',
			'capture-pane',
			'load-buffer',
			'paste-buffer',
			'send-keys'
		]);
	});

	it('never types into a menu, where Enter would choose for the captain', async () => {
		for (const open of [MCP, MENU]) {
			screen = open;
			const r = await session().send('hello');
			expect(r).toMatchObject({ ok: false, status: 409 });
			expect(r.ok || r.error).toMatch(/menu is open/);
		}
		expect(tmuxCalls().some((a) => a[0] === 'load-buffer' || a[0] === 'send-keys')).toBe(false);
		screen = PROMPT;
		expect(await session().send('hello')).toEqual({ ok: true });
	});

	it('interrupts with Escape', async () => {
		await session().interrupt();
		expect(tmuxCalls().filter((a) => a[0] === 'send-keys')).toEqual([
			['send-keys', '-t', '=wh-firstmate:', 'Escape']
		]);
	});
});

describe('menus on screen', () => {
	beforeEach(() => {
		live = new Set([FIRSTMATE_TMUX]);
	});

	it('shows the menu Claude Code is waiting on in the session’s status', async () => {
		screen = MENU;
		const v = await session().status();
		expect(v.picker).toMatchObject({
			title: 'Which colour?',
			options: [{ label: 'Red' }, { label: 'Green' }]
		});
		screen = 'nothing here';
		expect((await session().status()).picker).toBeNull();
	});

	it('shows any menu open in the session, numbered or not', async () => {
		screen = MCP;
		expect(await session().status()).toMatchObject({
			picker: null,
			menu: { title: 'Manage MCP servers' }
		});
		screen = MENU;
		expect((await session().status()).menu).toEqual({ title: null });
		screen = PROMPT;
		expect((await session().status()).menu).toBeNull();
	});

	it('says Firstmate is busy while its screen offers to interrupt', async () => {
		screen = '✻ Brewing… (3s · esc to interrupt)';
		expect((await session().status()).busy).toBe(true);
		screen = '❯ ';
		expect((await session().status()).busy).toBe(false);
	});

	it('presses a choice only into the menu the page showed', async () => {
		screen = MENU;
		const s = session();
		const signature = (await s.status()).picker!.signature;
		expect(await s.pick(signature, { press: 2 })).toEqual({ ok: true });
		expect(await s.pick('stale', { press: 1 })).toMatchObject({ ok: false, status: 409 });
		expect(await s.pick(signature, { press: 7 })).toMatchObject({ ok: false, status: 400 });
		screen = '';
		expect(await s.pick(signature, { press: 1 })).toMatchObject({ ok: false, status: 409 });
		const keys = tmuxCalls()
			.filter((a) => a[0] === 'send-keys')
			.map((a) => a[3]);
		expect(keys).toEqual(['2']);
	});
});

describe('closing a menu', () => {
	beforeEach(() => {
		live = new Set([FIRSTMATE_TMUX]);
	});

	it('presses Escape until the menu has closed, backing out of nested screens', async () => {
		const back = [MCP, PROMPT];
		screen = MCP_SERVER;
		onKey = (key) => {
			if (key === 'Escape') screen = back.shift() ?? screen;
		};
		expect(await session().dismiss()).toEqual({ ok: true });
		expect(escapes()).toBe(2);
		expect(screen).toBe(PROMPT);
	});

	it('never presses Escape at the prompt, where it would stop Firstmate or open rewind', async () => {
		screen = PROMPT;
		expect(await session().dismiss()).toEqual({ ok: true });
		screen = '';
		expect(await session().dismiss()).toEqual({ ok: true });
		expect(escapes()).toBe(0);
	});

	it('leaves Firstmate’s own question or permission prompt alone', async () => {
		screen = MENU;
		expect(await session().dismiss()).toMatchObject({ ok: false, status: 409 });
		expect(escapes()).toBe(0);
	});

	it('waits for a slow redraw rather than pressing Escape again at the prompt', async () => {
		screen = MCP;
		let naps = 0;
		const s = session({
			sleep: async () => {
				if (++naps === 2) screen = PROMPT;
			}
		});
		expect(await s.dismiss()).toEqual({ ok: true });
		expect(escapes()).toBe(1);
	});

	it('gives up, saying so, when the menu will not close', async () => {
		screen = MCP;
		const r = await session().dismiss();
		expect(r).toMatchObject({ ok: false, status: 409 });
		expect(r.ok || r.error).toMatch(/terminal/);
		expect(escapes()).toBe(1);
	});

	it('refuses a session that is not Wheelhouse’s', async () => {
		live = new Set();
		screen = MCP;
		expect(await session().dismiss()).toMatchObject({ ok: false, status: 409 });
		expect(escapes()).toBe(0);
	});
});

describe('terminal drawer', () => {
	it('attaches only to Wheelhouse’s own running session', async () => {
		const s = session();
		expect(await s.terminal()).toMatchObject({ ok: false, status: 409 });
		live = new Set([FIRSTMATE_TMUX]);
		const r = await s.terminal();
		expect(r.ok && r.target.argv).toEqual([
			TMUX,
			'-L',
			SOCKET,
			'attach-session',
			'-t',
			'=wh-firstmate'
		]);
	});
});

describe('any session backend', () => {
	/** A backend in memory: what FirstmateSession asks of it, in order. */
	function fakeBackend(opts: { running?: boolean | null; fail?: string } = {}) {
		const did: (string | [string, unknown])[] = [];
		let running = opts.running === undefined ? false : opts.running;
		const variables: Record<string, string> = {};
		const result = (): BackendResult =>
			opts.fail ? { ok: false, error: opts.fail } : { ok: true };
		const backend: SessionBackend = {
			label: 'fakemux',
			unavailable: () => null,
			running: async () => running,
			start: async (spec: LaunchSpec) => {
				did.push(['start', spec]);
				if (!opts.fail) {
					running = true;
					Object.assign(variables, spec.env);
				}
				return result();
			},
			variable: async (name: string) => variables[name] ?? '',
			screen: async () => screen,
			paste: async (text: string) => {
				did.push(['paste', text]);
				return result();
			},
			key: async (key: SessionKey) => {
				did.push(['key', key]);
				return result();
			},
			attach: () => ({ argv: ['fakemux', 'attach'], env: { TERM: 'xterm-256color' } }),
			attachHint: () => 'fakemux attach'
		};
		return { backend, did };
	}

	it('starts, types, presses and attaches through the backend, never tmux', async () => {
		const { backend, did } = fakeBackend();
		const s = session({ backend, homeDir: path.join(root, 'ops') });
		expect(await s.ensure()).toMatchObject({ state: 'ours', attach: 'fakemux attach' });
		expect(did[0]).toEqual([
			'start',
			{
				cwd: firstmateDir,
				argv: claudeArgv(CLAUDE, s.hookFile, true),
				env: { WHEELHOUSE_HARNESS: 'claude', FM_HOME: path.join(root, 'ops') }
			}
		]);
		screen = PROMPT;
		expect(await s.send('one\ntwo')).toEqual({ ok: true });
		expect(await s.interrupt()).toEqual({ ok: true });
		screen = MENU;
		const signature = (await s.status()).picker!.signature;
		expect(await s.pick(signature, { press: 2 })).toEqual({ ok: true });
		expect(did.slice(1)).toEqual([
			['paste', 'one\ntwo'],
			['key', 'Enter'],
			['key', 'Escape'],
			['key', '2']
		]);
		const t = await s.terminal();
		expect(t.ok && t.target).toEqual({
			argv: ['fakemux', 'attach'],
			cwd: firstmateDir,
			env: { TERM: 'xterm-256color' }
		});
		expect(calls).toEqual([]);
	});

	it('reads the running harness back from the session’s launch variables', async () => {
		const { backend } = fakeBackend({ running: true });
		backend.variable = async (name) => (name === 'WHEELHOUSE_HARNESS' ? 'codex' : '');
		const v = await session({ backend }).status();
		expect(v).toMatchObject({ state: 'ours', harness: 'codex', canSend: false });
		backend.variable = async () => null;
		expect(await session({ backend }).status()).toMatchObject({
			state: 'unavailable',
			reason: 'Wheelhouse could not ask fakemux about the session.'
		});
	});

	it('names the backend when it cannot say whether the session runs', async () => {
		const { backend } = fakeBackend({ running: null });
		expect(await session({ backend }).status()).toMatchObject({
			state: 'unavailable',
			reason: 'Wheelhouse could not ask fakemux about the session.'
		});
		expect(await session({ backend }).send('hi')).toMatchObject({ ok: false, status: 503 });
	});

	it('shows what the backend said when it fails', async () => {
		const { backend } = fakeBackend({ fail: 'fakemux said no' });
		expect(await session({ backend }).ensure()).toMatchObject({
			state: 'unavailable',
			reason: 'fakemux said no'
		});
		const { backend: up } = fakeBackend({ running: true, fail: 'fakemux said no' });
		expect(await session({ backend: up }).send('hi')).toEqual({
			ok: false,
			status: 500,
			error: 'fakemux said no'
		});
		expect(await session({ backend: up }).interrupt()).toEqual({
			ok: false,
			status: 500,
			error: 'fakemux said no'
		});
	});
});

describe('the herdr backend', () => {
	const HERDR = '/opt/bin/herdr';
	let fake: FakeHerdr;
	beforeEach(() => {
		fake = fakeHerdr('wh-test', HERDR);
	});
	const herdrSession = () =>
		session({
			sessionBackend: 'herdr',
			herdrSession: 'wh-test',
			run: fake.run,
			find: (name) =>
				name === 'herdr' ? HERDR : name === 'sh' ? '/bin/sh' : name === 'claude' ? CLAUDE : null
		});
	const pane = () => [...fake.state.panes.values()][0];
	const agentStarts = () => fake.args().filter((a) => a[0] === 'agent' && a[1] === 'start');

	it('is chosen only on request; tmux stays the default', () => {
		expect(session().backend).toBeInstanceOf(TmuxBackend);
		const s = herdrSession();
		expect(s.backend).toBeInstanceOf(HerdrBackend);
		expect((s.backend as HerdrBackend).session).toBe('wh-test');
		expect((s.backend as HerdrBackend).recordFile).toBe(path.join(stateDir, HERDR_RECORD));
		expect(
			(session({ sessionBackend: 'herdr', herdrSession: null }).backend as HerdrBackend).session
		).toBe('wheelhouse');
	});

	it('starts Claude Code in a herdr pane with the same command, hooks and permission setting', async () => {
		const s = herdrSession();
		expect(await s.ensure()).toMatchObject({
			state: 'ours',
			attach: 'herdr session attach wh-test',
			skipPermissions: true
		});
		expect(pane().argv.slice(pane().argv.indexOf(CLAUDE))).toEqual(
			claudeArgv(CLAUDE, s.hookFile, true)
		);
		expect(pane().env).toEqual({ WHEELHOUSE_HARNESS: 'claude' });
		expect(pane().cwd).toBe(firstmateDir);
		expect(fake.calls).not.toHaveLength(0);
		expect(calls).toEqual([]); // no tmux
	});

	it('never starts a second session', async () => {
		const s = herdrSession();
		await Promise.all([s.ensure(), s.ensure()]);
		await s.ensure();
		await herdrSession().ensure(); // a restarted Wheelhouse finds the recorded pane
		expect(agentStarts()).toHaveLength(1);
		fake.state.panes.clear();
		lock = 'held';
		expect(await herdrSession().ensure()).toMatchObject({ state: 'external' });
		expect(agentStarts()).toHaveLength(1);
	});

	it('types a multi-line message as one paste, then Enter, and nothing into a menu', async () => {
		const s = herdrSession();
		await s.ensure();
		pane().screen = PROMPT;
		expect(await s.send('one\ntwo')).toEqual({ ok: true });
		expect(pane().text).toEqual(['\x1b[200~one\ntwo\x1b[201~']);
		expect(pane().keys).toEqual(['Enter']);
		pane().screen = MENU;
		expect(await s.send('hello')).toMatchObject({ ok: false, status: 409 });
		expect(pane().text).toHaveLength(1);
		expect(pane().keys).toEqual(['Enter']);
	});

	it('stops, answers menus and closes them with send-keys', async () => {
		const s = herdrSession();
		await s.ensure();
		pane().screen = PROMPT;
		expect(await s.interrupt()).toEqual({ ok: true });
		pane().screen = MENU;
		const view = await s.status();
		expect(view.picker).not.toBeNull();
		expect(await s.pick(view.picker!.signature, { press: 2 })).toEqual({ ok: true });
		pane().screen = MCP;
		fake.state.onKey = (p, key) => {
			if (key === 'Escape') p.screen = PROMPT;
		};
		expect(await s.dismiss()).toEqual({ ok: true });
		expect(pane().keys).toEqual(['Escape', '2', 'Escape']);
		expect(fake.args().filter((a) => a[1] === 'send-keys')).toHaveLength(3);
	});

	it('shows busy and menus from the screen it reads with pane read', async () => {
		const s = herdrSession();
		await s.ensure();
		pane().screen = `${PROMPT}\n✻ Working… (esc to interrupt)`;
		expect(await s.status()).toMatchObject({ busy: true, picker: null });
		pane().screen = MCP;
		expect(await s.status()).toMatchObject({ menu: { title: 'Manage MCP servers' } });
	});

	it('does not type into the shell a herdr restart leaves in its pane, and can start afresh', async () => {
		const s = herdrSession();
		await s.ensure();
		fake.restart();
		expect(await s.status()).toMatchObject({ state: 'none' });
		expect(await s.send('hi')).toMatchObject({ ok: false, status: 409 });
		expect(await s.interrupt()).toMatchObject({ ok: false, status: 409 });
		expect(pane().text).toEqual([]);
		expect(pane().keys).toEqual([]);
		expect(await s.ensure()).toMatchObject({ state: 'ours' });
		expect(agentStarts()).toHaveLength(2);
		expect(fake.lifecycle()).toEqual([]);
	});

	it('says plainly when herdr is too old or does not match its server', async () => {
		fake.state.version = '0.6.0';
		expect(await herdrSession().status()).toMatchObject({
			state: 'unavailable',
			reason: 'herdr 0.6.0 is older than Wheelhouse supports. Update herdr to 0.7.4 or newer.'
		});
		expect(await herdrSession().ensure()).toMatchObject({ state: 'unavailable' });
		expect(agentStarts()).toHaveLength(0);
		fake.state.version = '0.7.4';
		fake.state.compatible = false;
		expect((await herdrSession().status()).reason).toMatch(/does not match this herdr/);
	});

	it('attaches the drawer with a herdr client only to its own running pane', async () => {
		const s = herdrSession();
		expect(await s.terminal()).toMatchObject({ ok: false, status: 409 });
		await s.ensure();
		const r = await s.terminal();
		expect(r.ok && r.target).toMatchObject({
			argv: [HERDR, 'session', 'attach', 'wh-test'],
			cwd: firstmateDir
		});
		// A restart leaves a shell under the same pane id: the drawer refuses it.
		fake.restart();
		expect(await s.terminal()).toMatchObject({ ok: false, status: 409 });
		expect(fake.lifecycle()).toEqual([]);
	});

	it('starts nothing and talks to nothing when the backend setting is unusable', async () => {
		const s = session({
			sessionBackend: 'tmux',
			backendProblem: 'Unknown session backend "screen".'
		});
		expect(await s.status()).toMatchObject({
			state: 'unavailable',
			reason: 'Unknown session backend "screen".'
		});
		expect(await s.ensure()).toMatchObject({ state: 'unavailable' });
		expect(await s.terminal()).toMatchObject({ ok: false, status: 503 });
		expect(await s.send('hi')).toMatchObject({ ok: false, status: 503 });
		expect(calls).toEqual([]);
	});
});
