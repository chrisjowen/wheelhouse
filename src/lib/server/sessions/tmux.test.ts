import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunOptions, RunResult } from '../firstmate/exec';
import {
	attachHint,
	envFileContent,
	FIRSTMATE_TMUX,
	firstmateTmux,
	firstmateTmuxName,
	launchArgv,
	LEGACY_TMUX_SOCKET,
	TmuxBackend,
	type Run
} from './tmux';

const TMUX = '/opt/bin/tmux';
const SOCKET = 'wh-test';

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

/** A TmuxBackend on a fake tmux that answers each call with `answer` and records it. */
function backend(
	answer: (args: readonly string[], socket: string | null) => RunResult = () => ok(),
	socket: string | null = SOCKET,
	scope: { name?: string; cwd?: string } = {}
) {
	const calls: { file: string; args: readonly string[]; opts: RunOptions }[] = [];
	const run: Run = async (file, args, opts) => {
		calls.push({ file, args, opts });
		return args[0] === '-L' ? answer(args.slice(2), args[1]) : answer(args, null);
	};
	const env = { PATH: '/opt/bin', HOME: '/home/c' };
	const b = new TmuxBackend({
		socket,
		env,
		find: (n) => (n === 'tmux' ? TMUX : null),
		run,
		...scope
	});
	return {
		b,
		calls,
		args: () => calls.map((c) => (c.args[0] === '-L' ? c.args.slice(2) : c.args))
	};
}

describe('TmuxBackend', () => {
	it('talks only to the configured server, by socket name', async () => {
		const { b, calls } = backend(() => ok(`${FIRSTMATE_TMUX}\n`));
		await b.running();
		await b.screen();
		await b.key('Enter');
		await b.paste('hi');
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((c) => c.file === TMUX && c.args[0] === '-L' && c.args[1] === SOCKET)).toBe(
			true
		);
	});

	it('is unavailable without tmux or with a socket name that is a path', () => {
		expect(backend().b.unavailable()).toBeNull();
		expect(backend(undefined, '../x').b.unavailable()).toMatch(/socket name/);
		const none = new TmuxBackend({ env: {}, find: () => null });
		expect(none.unavailable()).toMatch(/tmux is not installed/);
		expect(none.socket).toBeNull();
	});

	it('runs on the default server, with no -L, when no socket is set', async () => {
		const { b, calls } = backend((a) => (a[0] === 'list-sessions' ? ok('') : ok()), null);
		expect(await b.running()).toBe(false);
		await b.start({ cwd: '/fm', argv: ['/c'], env: {} });
		await b.screen();
		await b.key('Enter');
		await b.paste('hi');
		const off = calls.filter((c) => !c.args.includes('list-sessions'));
		expect(off.length).toBeGreaterThan(0);
		expect(off.every((c) => !c.args.includes('-L'))).toBe(true);
		expect(b.attach().argv).toEqual([TMUX, 'attach-session', '-t', `=${FIRSTMATE_TMUX}`]);
		expect(b.attachHint()).toBe('tmux attach -t wh-firstmate');
	});

	it('keeps using a session an earlier Wheelhouse left on the legacy server until it ends', async () => {
		let legacy = true;
		const { b, calls } = backend((a, socket) => {
			if (a[0] !== 'list-sessions') return ok();
			if (socket === LEGACY_TMUX_SOCKET)
				return legacy ? ok(`${FIRSTMATE_TMUX}\n`) : fail('no server running on /tmp/x');
			return ok('other\n');
		}, null);
		expect(await b.running()).toBe(true);
		calls.length = 0;
		await b.screen();
		await b.key('Enter');
		await b.paste('hi');
		expect(calls.every((c) => c.args[0] === '-L' && c.args[1] === LEGACY_TMUX_SOCKET)).toBe(true);
		expect(b.attachHint()).toBe(`tmux -L ${LEGACY_TMUX_SOCKET} attach -t wh-firstmate`);
		legacy = false;
		expect(await b.running()).toBe(false);
		calls.length = 0;
		await b.start({ cwd: '/fm', argv: ['/c'], env: {} });
		expect(calls.every((c) => !c.args.includes('-L'))).toBe(true);
	});

	it('prefers a session on the default server, and never looks past a configured socket', async () => {
		const seen: (string | null)[] = [];
		const both = backend((a, socket) => {
			seen.push(socket);
			return ok(`${FIRSTMATE_TMUX}\n`);
		}, null);
		expect(await both.b.running()).toBe(true);
		expect(both.b.socket).toBeNull();
		expect(seen).toEqual([null]);
		const configured = backend(() => ok('other\n'));
		expect(await configured.b.running()).toBe(false);
		expect(configured.calls.map((c) => c.args.slice(0, 2))).toEqual([['-L', SOCKET]]);
	});

	it('still finds a default-server session when the legacy server cannot answer', async () => {
		const { b } = backend(
			(_a, socket) => (socket === null ? ok('') : fail('protocol version mismatch')),
			null
		);
		expect(await b.running()).toBe(false);
	});

	it('is running only while the wh-firstmate session is listed', async () => {
		expect(await backend(() => ok(`other\n${FIRSTMATE_TMUX}\n`)).b.running()).toBe(true);
		expect(await backend(() => ok('other\n')).b.running()).toBe(false);
		expect(await backend(() => fail('no server running on /tmp/tmux-501/x')).b.running()).toBe(
			false
		);
		expect(await backend(() => fail('protocol version mismatch')).b.running()).toBeNull();
		expect(await backend(undefined, '../x').b.running()).toBeNull();
	});

	it('starts the session detached, 160×48, with the spec’s env, then sets its options', async () => {
		const { b, calls, args } = backend();
		const spec = { cwd: '/fm', argv: ['/opt/bin/claude', '--x'], env: { FM_HOME: '/ops' } };
		expect(await b.start(spec)).toEqual({ ok: true });
		const envPath = args()[0][args()[0].indexOf('/opt/bin/claude') - 1];
		try {
			expect(args()[0]).toEqual(launchArgv(spec, envPath, FIRSTMATE_TMUX));
			// Wheelhouse's own environment plus the spec's, for the session's command to take.
			expect(readFileSync(envPath, 'utf8')).toBe(
				envFileContent({ PATH: '/opt/bin', HOME: '/home/c', FM_HOME: '/ops' })
			);
		} finally {
			rmSync(envPath, { force: true });
		}
		expect(calls[0].opts.cwd).toBe('/fm');
		expect(args().slice(1)).toEqual([
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'mouse', 'on'],
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'status', 'off'],
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'history-limit', '20000'],
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'allow-passthrough', 'on']
		]);
	});

	it('builds new-session arguments with the command after --', () => {
		const argv = launchArgv(
			{ cwd: '/work/firstmate', argv: ['/c', '-a'], env: {} },
			'/env',
			FIRSTMATE_TMUX
		);
		expect(argv.slice(0, argv.indexOf('--') + 1)).toEqual([
			'new-session',
			'-d',
			'-s',
			FIRSTMATE_TMUX,
			'-x',
			'160',
			'-y',
			'48',
			'-c',
			'/work/firstmate',
			'--'
		]);
		expect(argv.slice(-3)).toEqual(['/env', '/c', '-a']);
		const withHome = launchArgv(
			{ cwd: '/w', argv: ['/c'], env: { FM_HOME: '/ops/home' } },
			'/env',
			FIRSTMATE_TMUX
		);
		expect(withHome.slice(withHome.indexOf('-e'), withHome.indexOf('-e') + 2)).toEqual([
			'-e',
			'FM_HOME=/ops/home'
		]);
		expect(withHome.indexOf('-e')).toBeLessThan(withHome.indexOf('--'));
	});

	it('runs the command with exactly Wheelhouse’s environment, keeping the pane’s TMUX and TERM', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'wh-tmux-env-'));
		const envPath = path.join(dir, 'env');
		try {
			const wheelhouse = {
				PATH: process.env.PATH,
				HOME: '/home/c',
				WHEELHOUSE_HARNESS: 'claude',
				TERM: 'xterm-ghostty',
				TERM_PROGRAM: 'ghostty',
				QUOTED: "it's $HOME `x`\nnext"
			};
			writeFileSync(envPath, envFileContent(wheelhouse), { mode: 0o600 });
			const argv = launchArgv(
				{
					cwd: '/w',
					argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'],
					env: { WHEELHOUSE_HARNESS: 'claude' }
				},
				envPath,
				FIRSTMATE_TMUX
			);
			const [file, ...rest] = argv.slice(argv.indexOf('--') + 1);
			// The pane's environment as a server someone else started gives it.
			const r = spawnSync(file, rest, {
				encoding: 'utf8',
				env: {
					PATH: '/usr/bin:/bin',
					HOME: '/server/home',
					SERVER_ONLY: 'leak',
					CLAUDECODE: '1',
					CLAUDE_CODE_MESSAGING_SOCKET: '/x.sock',
					GROK_AGENT: '1',
					GROK_SESSION_ID: 'another-session',
					FM_HOME: '/stale',
					TMUX: '/tmp/tmux-501/default,1,0',
					TMUX_PANE: '%3',
					TERM: 'tmux-256color',
					TERM_PROGRAM: 'tmux'
				}
			});
			expect(r.status).toBe(0);
			const env = JSON.parse(r.stdout) as Record<string, string>;
			// sh sets PWD, SHLVL and _, and macOS __CF_USER_TEXT_ENCODING; nothing else comes from the server.
			const own = new Set(['PWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING']);
			expect(Object.fromEntries(Object.entries(env).filter(([k]) => !own.has(k)))).toEqual({
				...wheelhouse,
				TMUX: '/tmp/tmux-501/default,1,0',
				TMUX_PANE: '%3',
				TERM: 'tmux-256color',
				TERM_PROGRAM: 'tmux'
			});
			expect(existsSync(envPath)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('writes only variables sh can name to the environment file, never the pane’s TMUX or TERM', () => {
		expect(
			envFileContent({
				A: "x'y",
				'B.C': 'skip',
				'1D': 'skip',
				TMUX: 't',
				TMUX_PANE: '%1',
				TERM: 'xterm-ghostty'
			})
		).toBe("export A='x'\\''y'\n");
	});

	it('removes the environment file when tmux cannot start', async () => {
		const { b, args } = backend(() => fail('duplicate session'));
		await b.start({ cwd: '/fm', argv: ['c'], env: {} });
		expect(existsSync(args()[0][args()[0].length - 2])).toBe(false);
	});

	it('says what tmux said when it cannot start, and sets no options', async () => {
		const { b, args } = backend(() => fail('duplicate session'));
		expect(await b.start({ cwd: '/fm', argv: ['c'], env: {} })).toEqual({
			ok: false,
			error: 'tmux could not start Firstmate: duplicate session'
		});
		expect(args()).toHaveLength(1);
	});

	it('reads a launch variable back from the session, telling unset from unknown', async () => {
		const { b, args } = backend(() => ok('WHEELHOUSE_HARNESS=codex\n'));
		expect(await b.variable('WHEELHOUSE_HARNESS')).toBe('codex');
		expect(args()[0]).toEqual([
			'show-environment',
			'-t',
			`=${FIRSTMATE_TMUX}:`,
			'WHEELHOUSE_HARNESS'
		]);
		const unset = backend(() => fail('unknown variable: WH_SESSION_NONCE'));
		expect(await unset.b.variable('WH_SESSION_NONCE')).toBe('');
		expect(await backend(() => fail('no server running')).b.variable('X')).toBeNull();
	});

	it('reads the visible screen, or null when tmux cannot', async () => {
		expect(await backend(() => ok('❯ hello\n')).b.screen()).toBe('❯ hello\n');
		const { b, args } = backend(() => fail("can't find session"));
		expect(await b.screen()).toBeNull();
		expect(args()[0]).toEqual(['capture-pane', '-p', '-t', `=${FIRSTMATE_TMUX}:`]);
	});

	it('pastes through a buffer as a bracketed paste, deleting the buffer after', async () => {
		const { b, calls, args } = backend();
		expect(await b.paste('one\ntwo')).toEqual({ ok: true });
		expect(args()).toEqual([
			['load-buffer', '-b', 'wh-firstmate-input', '-'],
			['paste-buffer', '-d', '-p', '-b', 'wh-firstmate-input', '-t', `=${FIRSTMATE_TMUX}:`]
		]);
		expect(calls[0].opts.input).toBe('one\ntwo');
		expect(calls[0].opts.maxInputBytes).toBe(65 * 1024);
	});

	it('says which step failed when a paste does not go through', async () => {
		expect(await backend(() => fail('no space')).b.paste('x')).toEqual({
			ok: false,
			error: 'tmux could not take the message: no space'
		});
		const late = backend((a) => (a[0] === 'paste-buffer' ? fail('gone') : ok()));
		expect(await late.b.paste('x')).toEqual({
			ok: false,
			error: 'tmux could not paste the message: gone'
		});
	});

	it('presses keys by tmux’s names', async () => {
		const { b, args } = backend();
		for (const k of ['Enter', 'Escape', 'Up', 'Down', '3'] as const) await b.key(k);
		expect(args()).toEqual(
			['Enter', 'Escape', 'Up', 'Down', '3'].map((k) => [
				'send-keys',
				'-t',
				`=${FIRSTMATE_TMUX}:`,
				k
			])
		);
		expect(await backend(() => fail('lost')).b.key('Enter')).toEqual({
			ok: false,
			error: 'tmux could not send a key: lost'
		});
	});

	it('attaches the drawer to the exact session, and hints the same for a terminal', () => {
		const { b } = backend();
		expect(b.attach()).toEqual({
			argv: [TMUX, '-L', SOCKET, 'attach-session', '-t', `=${FIRSTMATE_TMUX}`],
			env: { PATH: '/opt/bin', HOME: '/home/c', TERM: 'xterm-256color' }
		});
		expect(b.attachHint()).toBe(`tmux -L ${SOCKET} attach -t wh-firstmate`);
		expect(attachHint(SOCKET, FIRSTMATE_TMUX)).toBe(b.attachHint());
		expect(b.label).toBe('tmux');
	});
});

describe('a session per Firstmate home', () => {
	const NAME = firstmateTmuxName('/homes/a');
	/** A fake tmux with `sessions` listed, the legacy one started in `legacyPath`. */
	const answer =
		(sessions: string[], legacyPath = '/fm-a') =>
		(a: readonly string[]) =>
			a[0] === 'list-sessions'
				? ok(sessions.join('\n') + '\n')
				: a[0] === 'display-message' && a.at(-1) === '#{session_path}'
					? a[3] === `=${FIRSTMATE_TMUX}:`
						? ok(`${legacyPath}\n`)
						: fail("can't find session")
					: ok();

	it('names the session for the home, like its message store, and uses that name throughout', async () => {
		expect(NAME).toMatch(/^wh-firstmate-[0-9a-f]{8}$/);
		expect(firstmateTmuxName('/homes/a')).toBe(NAME);
		expect(firstmateTmuxName('/homes/b')).not.toBe(NAME);
		const spec = { cwd: '/fm-a', argv: ['/c'], env: {} };
		expect(launchArgv(spec, '/env', NAME).slice(0, 4)).toEqual(['new-session', '-d', '-s', NAME]);
		expect(attachHint(SOCKET, NAME)).toBe(`tmux -L ${SOCKET} attach -t ${NAME}`);
		const { b, args } = backend(answer([]), SOCKET, { name: NAME, cwd: '/fm-a' });
		expect(await b.running()).toBe(false);
		await b.start(spec);
		const envFile = args()
			.find((a) => a[0] === 'new-session')!
			.at(-2)!;
		rmSync(envFile, { force: true });
		await b.screen();
		await b.paste('hi');
		await b.key('Enter');
		const targets = args().flatMap((a) =>
			a.filter((_x, i) => a[i - 1] === '-t' || a[i - 1] === '-s')
		);
		expect(new Set(targets)).toEqual(new Set([NAME, `=${NAME}:`]));
		// The paste buffer is the server's, so it is named for the session too.
		expect(args().find((a) => a[0] === 'load-buffer')).toEqual([
			'load-buffer',
			'-b',
			`${NAME}-input`,
			'-'
		]);
		expect(b.attachHint()).toBe(`tmux -L ${SOCKET} attach -t ${NAME}`);
		expect(b.legacy).toBe(false);
	});

	it('adopts a legacy wh-firstmate session only when it was started in this checkout', async () => {
		const ours = backend(answer([FIRSTMATE_TMUX]), SOCKET, { name: NAME, cwd: '/fm-a' });
		expect(await ours.b.running()).toBe(true);
		expect(ours.b.name).toBe(FIRSTMATE_TMUX);
		expect(ours.b.legacy).toBe(true);
		expect(ours.b.attachHint()).toBe(`tmux -L ${SOCKET} attach -t ${FIRSTMATE_TMUX}`);
		await ours.b.screen();
		expect(ours.args().at(-1)).toEqual(['capture-pane', '-p', '-t', `=${FIRSTMATE_TMUX}:`]);

		const other = backend(answer([FIRSTMATE_TMUX]), SOCKET, {
			name: firstmateTmuxName('/homes/b'),
			cwd: '/fm-b'
		});
		expect(await other.b.running()).toBe(false);
		expect(other.b.legacy).toBe(false);
		// Its own session wins over a legacy one, which is then never asked about.
		const both = backend(answer([FIRSTMATE_TMUX, NAME]), SOCKET, { name: NAME, cwd: '/fm-a' });
		expect(await both.b.running()).toBe(true);
		expect(both.b.name).toBe(NAME);
		expect(both.args().some((a) => a[0] === 'display-message')).toBe(false);
		// Once the legacy session ends, the home's own name is used again.
		let sessions = [FIRSTMATE_TMUX];
		const ending = backend((a) => answer(sessions)(a), SOCKET, { name: NAME, cwd: '/fm-a' });
		expect(await ending.b.running()).toBe(true);
		sessions = [];
		expect(await ending.b.running()).toBe(false);
		expect(ending.b.name).toBe(NAME);
	});

	it("gives Firstmate's scripts the home's session, or a legacy one started in its checkout", async () => {
		const ask = (sessions: string[], firstmateDir: string) => {
			const seen: (readonly string[])[] = [];
			const value = firstmateTmux({
				tmuxSocket: SOCKET,
				homeDir: '/homes/a',
				firstmateDir,
				find: () => TMUX,
				run: async (_file, all) => {
					const args = all.slice(2);
					seen.push(args);
					if (args.at(-1) === '#{session_path}') return answer(sessions)(args);
					const at = sessions.findIndex((s) => args[3] === `=${s}:`);
					return at < 0 ? fail("can't find session") : ok(`/tmp/tmux-501/wh-test,9,$${at}\n`);
				}
			})();
			return { value, seen };
		};
		expect(await ask([NAME], '/fm-a').value).toBe('/tmp/tmux-501/wh-test,9,0');
		expect(await ask([FIRSTMATE_TMUX], '/fm-a').value).toBe('/tmp/tmux-501/wh-test,9,0');
		const other = ask([FIRSTMATE_TMUX], '/fm-b');
		expect(await other.value).toBeNull();
		expect(other.seen.map((a) => a[3])).toEqual([`=${NAME}:`, `=${FIRSTMATE_TMUX}:`]);
	});
});

describe('the TMUX value for Firstmate scripts', () => {
	const answer = (r: RunResult) => {
		const seen: { args: readonly string[]; opts: RunOptions }[] = [];
		const tmux = firstmateTmux({
			tmuxSocket: SOCKET,
			env: { PATH: '/opt/bin', TMUX: '/tmp/tmux-501/default,1,0', WHEELHOUSE_HOME: '/x' },
			find: (name) => (name === 'tmux' ? TMUX : null),
			run: async (_file, args, opts) => {
				seen.push({ args, opts });
				return r;
			}
		});
		return { tmux, seen };
	};

	it("asks the configured server for the Firstmate session's socket, pid and index", async () => {
		const { tmux, seen } = answer(ok('/private/tmp/tmux-501/wh-test,9229,$3\n'));
		expect(await tmux()).toBe('/private/tmp/tmux-501/wh-test,9229,3');
		expect(seen[0].args).toEqual([
			'-L',
			SOCKET,
			'display-message',
			'-p',
			'-t',
			`=${FIRSTMATE_TMUX}:`,
			'#{socket_path},#{pid},#{session_id}'
		]);
		// The ask itself never inherits the TMUX of whatever launched Wheelhouse.
		expect(seen[0].opts.env?.TMUX).toBeUndefined();
	});

	it('is null when the session is not running there', async () => {
		expect(await answer(fail("can't find session: wh-firstmate")).tmux()).toBeNull();
		expect(await answer(fail('no server running on /tmp/tmux-501/wh-test')).tmux()).toBeNull();
	});

	it('is null for an answer that is not a TMUX value', async () => {
		expect(await answer(ok('')).tmux()).toBeNull();
		expect(await answer(ok('nonsense\n')).tmux()).toBeNull();
	});

	it('asks the default server, then the legacy one, when no socket is set', async () => {
		const seen: (readonly string[])[] = [];
		const ask = (legacy: boolean, onDefault: boolean) =>
			firstmateTmux({
				env: { PATH: '/opt/bin' },
				find: () => TMUX,
				run: async (_file, args) => {
					seen.push(args);
					if (args[0] === '-L')
						return legacy ? ok('/tmp/tmux-501/wheelhouse,7,$0\n') : fail('no server running');
					return onDefault ? ok('/tmp/tmux-501/default,5,$2\n') : fail("can't find session");
				}
			})();
		expect(await ask(true, true)).toBe('/tmp/tmux-501/default,5,2');
		expect(seen.map((a) => a[0])).toEqual(['display-message']);
		seen.length = 0;
		expect(await ask(true, false)).toBe('/tmp/tmux-501/wheelhouse,7,0');
		expect(seen.map((a) => a.slice(0, 2))).toEqual([
			['display-message', '-p'],
			['-L', LEGACY_TMUX_SOCKET]
		]);
		expect(await ask(false, false)).toBeNull();
	});

	it('is null without tmux or with an invalid socket name', async () => {
		expect(await firstmateTmux({ tmuxSocket: SOCKET, find: () => null })()).toBeNull();
		const run: Run = async () => ok('/tmp/x,1,$0');
		expect(await firstmateTmux({ tmuxSocket: '../x', find: () => TMUX, run })()).toBeNull();
	});
});
