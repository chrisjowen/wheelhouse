import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeHerdr, type FakeHerdr } from '../../../../tests/helpers/fake-herdr';
import {
	compareVersions,
	DEFAULT_HERDR_SESSION,
	FIRSTMATE_AGENT,
	HerdrBackend,
	herdrError,
	paneArgv
} from './herdr';

const HERDR = '/opt/bin/herdr';
const SH = '/bin/sh';
const SESSION = 'wh-test';

let dir: string;
let recordFile: string;
let fake: FakeHerdr;

beforeEach(() => {
	dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-herdr-')));
	recordFile = path.join(dir, 'herdr-session.json');
	fake = fakeHerdr(SESSION);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function backend(
	opts: {
		session?: string | null;
		env?: NodeJS.ProcessEnv;
		find?: (n: string) => string | null;
	} = {}
) {
	return new HerdrBackend({
		session: opts.session === undefined ? SESSION : opts.session,
		recordFile,
		env: opts.env ?? { PATH: '/opt/bin', HOME: '/home/c' },
		find: opts.find ?? ((n) => (n === 'herdr' ? HERDR : n === 'sh' ? SH : null)),
		run: fake.run,
		spawnServer: fake.spawnServer,
		sleep: async () => {}
	});
}

const SPEC = {
	cwd: '/fm',
	argv: ['/opt/bin/claude', '--dangerously-skip-permissions'],
	env: { WHEELHOUSE_HARNESS: 'claude', FM_HOME: '/ops' }
};

/** A backend whose Firstmate pane is started; returns it and the pane's id. */
async function started() {
	const b = backend();
	expect(await b.start(SPEC)).toEqual({ ok: true });
	const [paneId] = [...fake.state.panes.keys()];
	return { b, paneId, pane: fake.state.panes.get(paneId)! };
}

describe('HerdrBackend', () => {
	it('names its session on every call, before any --, and never inherits a herdr pane’s socket', async () => {
		const b = backend({
			env: {
				PATH: '/opt/bin',
				HERDR_SOCKET_PATH: '/x.sock',
				HERDR_SESSION: 'default',
				HERDR_PANE_ID: 'w9:p9'
			}
		});
		expect(await b.start(SPEC)).toEqual({ ok: true });
		await b.running();
		await b.screen();
		await b.paste('hi');
		await b.key('Enter');
		expect(fake.calls.length).toBeGreaterThan(5);
		// The fake refuses any call without exactly one `--session wh-test` before `--`, or with an inherited socket.
		expect(fake.calls.every((c) => c.file === HERDR)).toBe(true);
		expect(fake.args().every((a) => !a.includes('--session'))).toBe(true);
		const start = fake.calls.find((c) => c.args[0] === 'agent')!.args;
		expect(start.indexOf('--session')).toBeLessThan(start.indexOf('--'));
	});

	it('uses the session `wheelhouse` by default and refuses a name that is a path', () => {
		expect(backend({ session: null }).session).toBe(DEFAULT_HERDR_SESSION);
		expect(DEFAULT_HERDR_SESSION).toBe('wheelhouse');
		expect(backend().unavailable()).toBeNull();
		expect(backend({ session: '../x' }).unavailable()).toMatch(/herdr session name/);
		expect(backend({ find: () => null }).unavailable()).toMatch(
			/herdr is not installed.*0\.7\.4 or newer/
		);
	});

	it('starts Firstmate as an agent pane with the spec’s cwd, env and argv, records it and sizes it 160×48', async () => {
		const { paneId, pane } = await started();
		expect(pane.cwd).toBe('/fm');
		expect(pane.env).toEqual({ WHEELHOUSE_HARNESS: 'claude', FM_HOME: '/ops' });
		expect(pane.argv).toEqual(paneArgv(SH, SPEC));
		expect(pane.size).toEqual([160, 48]);
		const start = fake.args().find((a) => a[0] === 'agent')!;
		expect(start.slice(0, 3)).toEqual(['agent', 'start', FIRSTMATE_AGENT]);
		expect(start).toContain('--no-focus');
		const record = JSON.parse(readFileSync(recordFile, 'utf8'));
		expect(record).toEqual({
			schema: 'wheelhouse-herdr-session.v1',
			session: SESSION,
			paneId,
			terminalId: pane.terminalId,
			env: SPEC.env
		});
		expect(statSync(recordFile).mode & 0o777).toBe(0o600);
	});

	it('strips what the pane would inherit from the herdr server, except what the spec sets, and runs the argv as given', () => {
		const argv = [
			process.execPath,
			'-e',
			'console.log(JSON.stringify([process.argv.slice(1), process.env]))',
			'--'
		];
		const args = ['--flag', 'it\'s $HOME `x` "q"', '', 'a\nb', '*'];
		const inherited = {
			PATH: process.env.PATH ?? '/usr/bin:/bin',
			HOME: '/home/c',
			CLAUDE_CONFIG_DIR: '/home/c/.claude-alt',
			CLAUDECODE: '1',
			CLAUDE_CODE_SESSION_ID: 's1',
			CLAUDE_CODE_MESSAGING_SOCKET: '/x.sock',
			CLAUDE_CODE_MESSAGING_EXTRA: 'leak',
			TMUX: '/tmp/tmux',
			WHEELHOUSE_HARNESS: 'claude',
			FM_HOME: '/ops'
		};
		const run = (env: Record<string, string>) => {
			const [file, ...rest] = paneArgv(SH, { cwd: dir, argv: [...argv, ...args], env });
			const r = spawnSync(file, rest, { env: inherited, encoding: 'utf8' });
			expect(r.status).toBe(0);
			return JSON.parse(r.stdout) as [string[], Record<string, string>];
		};
		const [childArgs, childEnv] = run({ WHEELHOUSE_HARNESS: 'claude', FM_HOME: '/ops' });
		expect(childArgs).toEqual(args);
		for (const name of [
			'CLAUDECODE',
			'CLAUDE_CODE_SESSION_ID',
			'CLAUDE_CODE_MESSAGING_SOCKET',
			'CLAUDE_CODE_MESSAGING_EXTRA',
			'TMUX'
		])
			expect(childEnv).not.toHaveProperty(name);
		expect(childEnv).toMatchObject({
			HOME: '/home/c',
			CLAUDE_CONFIG_DIR: '/home/c/.claude-alt',
			WHEELHOUSE_HARNESS: 'claude',
			FM_HOME: '/ops'
		});
		// FM_HOME the spec does not set is the herdr server's, so the pane must not keep it.
		expect(run({})[1]).not.toHaveProperty('FM_HOME');
	});

	it('starts its own session’s server when it is not running, and only that', async () => {
		fake.state.running = false;
		const b = backend();
		expect(await b.running()).toBe(false);
		expect(await b.start(SPEC)).toEqual({ ok: true });
		expect(fake.servers).toEqual([{ file: HERDR, args: ['server', '--session', SESSION] }]);
		expect(await b.running()).toBe(true);
	});

	it('says so when its session’s server does not come up', async () => {
		fake.state.running = false;
		fake.state.spawnStarts = false;
		expect(await backend().start(SPEC)).toEqual({
			ok: false,
			error: 'herdr session "wh-test" did not start within 10 seconds.'
		});
		expect(fake.state.panes.size).toBe(0);
	});

	it('does not start a server that is already running', async () => {
		await started();
		expect(fake.servers).toEqual([]);
	});

	it('is running only while the recorded pane runs the recorded terminal', async () => {
		expect(await backend().running()).toBe(false); // nothing recorded
		const { b, paneId } = await started();
		expect(await b.running()).toBe(true);
		expect(await backend().running()).toBe(true); // a restarted Wheelhouse reads the record
		fake.exit(paneId);
		expect(await b.running()).toBe(false);
	});

	it('spots the dead pane a herdr server restart leaves behind', async () => {
		const { b, paneId } = await started();
		fake.state.running = false;
		expect(await b.running()).toBe(false);
		fake.restart();
		// The pane id is back, running a plain shell in a new terminal: not Firstmate.
		expect(fake.state.panes.has(paneId)).toBe(true);
		expect(await b.running()).toBe(false);
		expect(await b.variable('WHEELHOUSE_HARNESS')).toBeNull();
	});

	it('does not trust a record made for another herdr session', async () => {
		await started();
		const other = fakeHerdr('other');
		other.state.panes = fake.state.panes;
		const b = new HerdrBackend({
			session: 'other',
			recordFile,
			env: {},
			find: (n) => (n === 'herdr' ? HERDR : SH),
			run: other.run
		});
		expect(await b.running()).toBe(false);
	});

	it('cannot say when herdr gives no usable answer, and says why', async () => {
		const { b } = await started();
		fake.state.fail = { prefix: 'pane get', stderr: 'Error: connection reset' };
		expect(await b.running()).toBeNull();
		expect(b.problem()).toBe("herdr could not report Firstmate's pane: Error: connection reset");
		expect(await b.running()).toBe(true);
		expect(b.problem()).toBeNull();
		fake.state.fail = { prefix: 'status', stderr: 'boom' };
		expect(await b.running()).toBeNull();
		expect(b.problem()).toMatch(/^herdr could not report its status: boom/);
		writeFileSync(recordFile, 'not json');
		expect(await b.running()).toBe(false);
	});

	it('explains a herdr that is too old or a server that does not match', async () => {
		const { b } = await started();
		fake.state.version = '0.7.3';
		expect(await b.running()).toBeNull();
		expect(b.problem()).toBe(
			'herdr 0.7.3 is older than Wheelhouse supports. Update herdr to 0.7.4 or newer.'
		);
		expect(await b.start(SPEC)).toEqual({ ok: false, error: b.problem() });
		fake.state.version = '0.9.1';
		fake.state.protocol = 18;
		fake.state.compatible = false;
		expect(await b.running()).toBeNull();
		expect(b.problem()).toBe(
			'The herdr server for session "wh-test" (herdr 0.7.4, protocol 16) does not match this herdr (0.9.1, protocol 18). Restart that herdr session yourself; Wheelhouse never restarts it.'
		);
		expect(fake.lifecycle()).toEqual([]);
	});

	it('answers launch variables from the record, only while the pane is live', async () => {
		const { b } = await started();
		expect(await b.variable('WHEELHOUSE_HARNESS')).toBe('claude');
		const fresh = backend();
		expect(await fresh.variable('WHEELHOUSE_HARNESS')).toBeNull();
		expect(await fresh.running()).toBe(true);
		expect(await fresh.variable('WHEELHOUSE_HARNESS')).toBe('claude');
		expect(await fresh.variable('WH_SESSION_NONCE')).toBe('');
	});

	it('reads the visible screen with pane read, or null when it cannot', async () => {
		const { b, pane, paneId } = await started();
		pane.screen = '❯ hello\n';
		expect(await b.screen()).toBe('❯ hello\n');
		expect(fake.args().at(-1)).toEqual(['pane', 'read', paneId, '--source', 'visible']);
		fake.exit(paneId);
		expect(await b.screen()).toBeNull();
		expect(await backend().screen()).toBeNull();
	});

	it('pastes a message as one bracketed paste, so lines and CRs never submit it early', async () => {
		const { b, pane, paneId } = await started();
		expect(await b.paste('one\ntwo\rthree')).toEqual({ ok: true });
		expect(pane.text).toEqual(['\x1b[200~one\ntwo\rthree\x1b[201~']);
		expect(fake.args().at(-1)).toEqual(['pane', 'send-text', paneId, pane.text[0]]);
		// An end marker in the message cannot end the paste early.
		await b.paste('a\x1b[201~b');
		expect(pane.text[1]).toBe('\x1b[200~ab\x1b[201~');
		// Nor can one that stripping a marker would leave behind.
		await b.paste('\x1b[20\x1b[201~1~\rrest');
		expect(pane.text[2]).toBe('\x1b[200~\rrest\x1b[201~');
	});

	it('sends a message that looks like an option as text, as one argument', async () => {
		const { b, pane } = await started();
		for (const text of ['--session', '--session=default', '--help', '-- x']) {
			expect(await b.paste(text)).toEqual({ ok: true });
			expect(pane.text.at(-1)).toBe(`\x1b[200~${text}\x1b[201~`);
		}
		const send = fake.calls.filter((c) => c.args[1] === 'send-text');
		expect(send.every((c) => c.args.slice(-2).join(' ') === `--session ${SESSION}`)).toBe(true);
	});

	it('refuses a message too long for one argument', async () => {
		const { b, pane } = await started();
		expect(await b.paste('x'.repeat(66 * 1024))).toEqual({
			ok: false,
			error: 'herdr could not take the message: it is too long.'
		});
		expect(pane.text).toEqual([]);
	});

	it('presses keys by herdr’s names, one per call', async () => {
		const { b, pane, paneId } = await started();
		for (const k of ['Enter', 'Escape', 'Up', 'Down', '3'] as const) await b.key(k);
		expect(pane.keys).toEqual(['Enter', 'Escape', 'Up', 'Down', '3']);
		expect(fake.args().slice(-5)).toEqual(
			['Enter', 'Escape', 'Up', 'Down', '3'].map((k) => ['pane', 'send-keys', paneId, k])
		);
	});

	it('says what herdr said when a call fails', async () => {
		const { b, paneId } = await started();
		fake.state.fail = {
			prefix: 'pane send-keys',
			stderr: JSON.stringify({
				error: { code: 'invalid_key', message: 'unsupported key Enter' },
				id: 'cli:request'
			})
		};
		expect(await b.key('Enter')).toEqual({
			ok: false,
			error: 'herdr could not send a key: unsupported key Enter'
		});
		fake.exit(paneId);
		expect(await b.paste('x')).toEqual({
			ok: false,
			error: `herdr could not take the message: pane ${paneId} not found`
		});
		fake.state.fail = {
			prefix: 'agent start',
			stderr: '{"error":{"code":"x","message":"no room"}}'
		};
		expect(await b.start(SPEC)).toEqual({
			ok: false,
			error: 'herdr could not start Firstmate: no room'
		});
	});

	it('types nothing when no pane was ever started', async () => {
		const b = backend();
		expect(await b.paste('x')).toMatchObject({ ok: false });
		expect(await b.key('Enter')).toMatchObject({ ok: false });
		expect(fake.calls).toEqual([]);
	});

	it('never stops or restarts a herdr server or session', async () => {
		fake.state.running = false;
		const { b, paneId } = await started();
		fake.restart();
		await b.running();
		await b.start(SPEC);
		fake.exit(paneId);
		await b.running();
		expect(fake.lifecycle()).toEqual([]);
		expect(fake.servers).toHaveLength(1);
	});

	it('attaches the drawer to its own session, and hints the same', () => {
		const b = backend({ env: { PATH: '/opt/bin', HERDR_SOCKET_PATH: '/x.sock' } });
		expect(b.attach()).toEqual({
			argv: [HERDR, 'session', 'attach', SESSION],
			env: { PATH: '/opt/bin', TERM: 'xterm-256color' }
		});
		expect(b.attachHint()).toBe('herdr session attach wh-test');
		expect(b.label).toBe('herdr');
	});
});

describe('herdr helpers', () => {
	it('compares dotted versions numerically', () => {
		expect(compareVersions('0.7.4', '0.7.4')).toBe(0);
		expect(compareVersions('0.7.10', '0.7.4')).toBe(1);
		expect(compareVersions('0.7.3', '0.7.4')).toBe(-1);
		expect(compareVersions('1.0', '0.9.9')).toBe(1);
	});

	it('reads both of herdr’s error shapes and plain text', () => {
		const r = (stderr: string) => ({
			ok: false as const,
			kind: 'exit' as const,
			code: 1,
			signal: null,
			stdout: '',
			stderr,
			message: 'exited with code 1',
			durationMs: 1
		});
		expect(herdrError(r('{"error":{"code":"a","message":"one"},"id":"x"}'))).toBe('one');
		expect(herdrError(r('{"code":"pane_not_found","message":"two"}'))).toBe('two');
		expect(herdrError(r('Error: Os { code: 2 }\n'))).toBe('Error: Os { code: 2 }');
		expect(herdrError(r(''))).toBe('exited with code 1');
	});
});
