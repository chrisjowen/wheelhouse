import { describe, expect, it } from 'vitest';
import type { RunOptions, RunResult } from '../firstmate/exec';
import {
	attachHint,
	FIRSTMATE_TMUX,
	firstmateTmux,
	launchArgv,
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
function backend(answer: (args: readonly string[]) => RunResult = () => ok(), socket = SOCKET) {
	const calls: { file: string; args: readonly string[]; opts: RunOptions }[] = [];
	const run: Run = async (file, args, opts) => {
		calls.push({ file, args, opts });
		return answer(args.slice(2));
	};
	const env = { PATH: '/opt/bin', HOME: '/home/c' };
	const b = new TmuxBackend({ socket, env, find: (n) => (n === 'tmux' ? TMUX : null), run });
	return { b, calls, args: () => calls.map((c) => c.args.slice(2)) };
}

describe('TmuxBackend', () => {
	it('talks only to Wheelhouse’s own server, by socket name', async () => {
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
		expect(none.socket).toBe('wheelhouse');
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
		expect(args()[0]).toEqual(launchArgv(spec));
		expect(calls[0].opts.cwd).toBe('/fm');
		expect(args().slice(1)).toEqual([
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'mouse', 'on'],
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'status', 'off'],
			['set-option', '-t', `=${FIRSTMATE_TMUX}:`, 'history-limit', '20000']
		]);
	});

	it('builds new-session arguments with the command after --', () => {
		const argv = launchArgv({ cwd: '/work/firstmate', argv: ['/c', '-a'], env: {} });
		expect(argv).toEqual([
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
			'--',
			'/c',
			'-a'
		]);
		const withHome = launchArgv({ cwd: '/w', argv: ['/c'], env: { FM_HOME: '/ops/home' } });
		expect(withHome.slice(withHome.indexOf('-e'), withHome.indexOf('-e') + 2)).toEqual([
			'-e',
			'FM_HOME=/ops/home'
		]);
		expect(withHome.indexOf('-e')).toBeLessThan(withHome.indexOf('--'));
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
		expect(args()[0]).toEqual(['show-environment', '-t', FIRSTMATE_TMUX, 'WHEELHOUSE_HARNESS']);
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
		expect(attachHint(SOCKET)).toBe(b.attachHint());
		expect(b.label).toBe('tmux');
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

	it("asks Wheelhouse's own server for the Firstmate session's socket, pid and index", async () => {
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

	it('is null without tmux or with an invalid socket name', async () => {
		expect(await firstmateTmux({ tmuxSocket: SOCKET, find: () => null })()).toBeNull();
		const run: Run = async () => ok('/tmp/x,1,$0');
		expect(await firstmateTmux({ tmuxSocket: '../x', find: () => TMUX, run })()).toBeNull();
	});
});
