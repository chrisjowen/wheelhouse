import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter, DEFAULT_SERVER } from './adapter';
import { crewEndpoint, crewTmux } from './crew';
import type { RunOptions, RunResult } from './exec';
import { FIRSTMATE_TMUX, firstmateTmux } from '../sessions/firstmate';
import { which, type Run } from '../sessions/tmux';

const TMUX = '/opt/bin/tmux';
const SOCKET = 'wh-test';
/** The servers the tests run: Wheelhouse's own, tmux's default, and a captain's own. */
const WH = '/private/tmp/tmux-501/wh-test';
const DEFAULT = '/private/tmp/tmux-501/default';
const CAPTAIN = '/private/tmp/tmux-501/captain';

let home: string;
let calls: { args: readonly string[]; opts: RunOptions }[];
/** Each server's windows as `session:window`, keyed by its socket; absent means not running. */
let servers: Map<string, { pid: number; windows: string[] }>;

const ok = (stdout = ''): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 1 });
const noServer = (socket: string): RunResult => ({
	ok: false,
	kind: 'exit',
	code: 1,
	signal: null,
	stdout: '',
	stderr: `no server running on ${socket}`,
	message: 'exited with code 1',
	durationMs: 1
});

/** A fake tmux answering `list-windows -a` on whichever server the arguments name. */
const run: Run = async (_file, args, opts) => {
	calls.push({ args, opts });
	const at = args.indexOf('list-windows');
	const server = args.slice(0, at);
	const socket =
		server[0] === '-L'
			? `/private/tmp/tmux-501/${server[1]}`
			: server[0] === '-S'
				? server[1]
				: DEFAULT;
	const s = servers.get(socket);
	if (!s) return noServer(socket);
	const lines = s.windows.map((w, i) => {
		const [session, window] = w.split(':');
		return `${socket},${s.pid},$${i}\t@${i + 10}\t${i}\t${session}\t${window}`;
	});
	return ok(lines.join('\n') + '\n');
};

const meta = (id: string, body: string) =>
	writeFileSync(path.join(home, 'state', `${id}.meta`), body);
const crew = (env: NodeJS.ProcessEnv = { PATH: '/opt/bin' }) =>
	crewTmux({
		homeDir: home,
		tmuxSocket: SOCKET,
		env,
		find: (name) => (name === 'tmux' ? TMUX : null),
		run
	});

beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'wh-crew-'));
	mkdirSync(path.join(home, 'state'));
	calls = [];
	// Today's layout: Firstmate's session on Wheelhouse's server, its crew on the default server.
	servers = new Map([
		[WH, { pid: 9229, windows: [`${FIRSTMATE_TMUX}:claude`] }],
		[DEFAULT, { pid: 18079, windows: ['firstmate:zsh', 'firstmate:fm-t-1', 'firstmate:fm-t-2'] }]
	]);
	meta('t-1', 'window=firstmate:fm-t-1\nendpoint_task_id=t-1\nharness=claude\n');
	meta('t-2', 'window=firstmate:fm-t-2\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('crewEndpoint', () => {
	it('reads the tmux window a meta records, the last value winning as fm_meta_get reads it', () => {
		expect(crewEndpoint('window=firstmate:fm-a\n')).toEqual({
			session: 'firstmate',
			window: 'fm-a'
		});
		expect(crewEndpoint('window=old:fm-a\nbackend=tmux\nwindow=firstmate:fm-a\n')).toEqual({
			session: 'firstmate',
			window: 'fm-a'
		});
	});

	it('has no tmux window for another backend, a remote secondmate or no target', () => {
		expect(crewEndpoint('backend=herdr\nwindow=main:p1\n')).toBeNull();
		expect(crewEndpoint('window=firstmate:fm-a\nremote_host=box\n')).toBeNull();
		expect(crewEndpoint('harness=claude\n')).toBeNull();
		expect(crewEndpoint('window=fm-a\n')).toBeNull();
	});
});

describe('crewTmux', () => {
	it("finds a worker on the default server while Firstmate's session is on Wheelhouse's", async () => {
		expect(await crew()('t-1')).toBe(`${DEFAULT},18079,1`);
		// The ask itself never inherits a TMUX from whatever launched Wheelhouse.
		for (const c of calls) expect(c.opts.env?.TMUX).toBeUndefined();
	});

	it("still finds it when Wheelhouse inherited the TMUX of Firstmate's own session", async () => {
		// Restarted from inside the wh-firstmate pane, as a plugin update does.
		const env = { PATH: '/opt/bin', TMUX: `${WH},9229,0`, TMUX_PANE: '%0' };
		expect(await crew(env)('t-1')).toBe(`${DEFAULT},18079,1`);
	});

	it("finds a worker Firstmate spawned into its own session on Wheelhouse's server", async () => {
		servers.get(WH)!.windows.push(`${FIRSTMATE_TMUX}:fm-t-3`);
		meta('t-3', `window=${FIRSTMATE_TMUX}:fm-t-3\n`);
		expect(await crew()('t-3')).toBe(`${WH},9229,1`);
	});

	it('finds a worker on the server of a TMUX Wheelhouse inherited', async () => {
		servers.set(CAPTAIN, { pid: 4242, windows: ['work:fm-t-4'] });
		meta('t-4', 'window=work:fm-t-4\n');
		const env = { PATH: '/opt/bin', TMUX: `${CAPTAIN},4242,0` };
		expect(await crew(env)('t-4')).toBe(`${CAPTAIN},4242,0`);
		expect(calls.map((c) => c.args.slice(0, 2))).toContainEqual(['-S', CAPTAIN]);
	});

	it('matches the session and window exactly, never by prefix', async () => {
		servers.set(DEFAULT, { pid: 18079, windows: ['firstmate2:fm-t-1', 'firstmate:fm-t-1-b'] });
		expect(await crew()('t-1')).toBe(DEFAULT_SERVER);
	});

	it('looks for a window that is on no server where Firstmate puts crew outside tmux', async () => {
		servers.delete(DEFAULT);
		expect(await crew()('t-1')).toBe(DEFAULT_SERVER);
		expect(await crewTmux({ homeDir: home, find: () => null, run })('t-1')).toBe(DEFAULT_SERVER);
	});

	it('follows the worker across a restart of its tmux server', async () => {
		const ask = crew();
		expect(await ask('t-1')).toBe(`${DEFAULT},18079,1`);
		servers.set(DEFAULT, { pid: 31337, windows: ['firstmate:fm-t-1'] });
		expect(await ask('t-1')).toBe(`${DEFAULT},31337,0`);
	});

	it('leaves the environment alone for a terminal that is not a local tmux window', async () => {
		meta('h-1', 'backend=herdr\nwindow=main:pane-1\n');
		meta('r-1', 'window=firstmate:fm-r-1\nremote_host=box\n');
		expect(await crew()('h-1')).toBeNull();
		expect(await crew()('r-1')).toBeNull();
		expect(await crew()('missing')).toBeNull();
		expect(await crew()('../t-1')).toBeNull();
		expect(calls).toEqual([]);
	});

	it('never reads a meta that is a symlink', async () => {
		symlinkSync(path.join(home, 'state', 't-1.meta'), path.join(home, 'state', 'link.meta'));
		expect(await crew()('link')).toBeNull();
	});

	it("gives the fleet snapshot the server holding most of the fleet's windows", async () => {
		servers.get(WH)!.windows.push(`${FIRSTMATE_TMUX}:fm-t-3`);
		meta('t-3', `window=${FIRSTMATE_TMUX}:fm-t-3\n`);
		meta('h-1', 'backend=herdr\nwindow=main:pane-1\n');
		expect(await crew()()).toBe(`${DEFAULT},18079,1`);
		rmSync(path.join(home, 'state', 't-1.meta'));
		rmSync(path.join(home, 'state', 't-2.meta'));
		expect(await crew()()).toBe(`${WH},9229,1`);
	});

	it('leaves the snapshot environment alone with no local tmux crew on record', async () => {
		rmSync(path.join(home, 'state', 't-1.meta'));
		rmSync(path.join(home, 'state', 't-2.meta'));
		expect(await crew()()).toBeNull();
	});
});

describe('script routing', () => {
	let fmDir: string;
	beforeEach(() => {
		fmDir = mkdtempSync(path.join(tmpdir(), 'wh-crew-fm-'));
		mkdirSync(path.join(fmDir, 'bin'));
		for (const name of ['fm-peek.sh', 'fm-inbox.sh']) {
			const file = path.join(fmDir, 'bin', name);
			writeFileSync(
				file,
				'#!/usr/bin/env bash\necho "TMUX=${TMUX-unset} PANE=${TMUX_PANE-unset}"\n'
			);
			chmodSync(file, 0o755);
		}
	});
	afterEach(() => rmSync(fmDir, { recursive: true, force: true }));

	const adapter = (env: NodeJS.ProcessEnv) =>
		createScriptAdapter(
			{ firstmateDir: fmDir, homeDir: home },
			{ env, tmux: async () => `${WH},9229,0`, crew: crew() }
		);

	it("peeks a worker on its own server, not Firstmate's session's", async () => {
		const env = { PATH: process.env.PATH, TMUX: `${WH},9229,0`, TMUX_PANE: '%0' };
		const r = await adapter(env).peek('t-2', 5);
		expect(r.ok && r.value.lines).toEqual([`TMUX=${DEFAULT},18079,2 PANE=unset`]);
	});

	it('peeks with no TMUX at all when the window is on no server', async () => {
		servers.delete(DEFAULT);
		const env = { PATH: process.env.PATH, TMUX: `${WH},9229,0`, TMUX_PANE: '%0' };
		const r = await adapter(env).peek('t-1', 5);
		expect(r.ok && r.value.lines).toEqual(['TMUX=unset PANE=unset']);
	});
});

// The real thing: real tmux servers, isolated from the captain's by TMUX_TMPDIR, and an
// fm-peek.sh that reads its task's window the way Firstmate's does (meta target, ambient TMUX).
describe.skipIf(!which('tmux', process.env.PATH))('on real tmux servers', () => {
	const socket = 'wh-crew-test';
	let tmp: string;
	let fmDir: string;
	let env: NodeJS.ProcessEnv;
	const tmuxOn = (server: string[], ...args: string[]) =>
		execFileSync('tmux', [...server, ...args], { env: { ...env, TMUX: '' }, stdio: 'pipe' })
			.toString()
			.trim();
	const wheelhouse = (...args: string[]) => tmuxOn(['-L', socket], ...args);
	const defaultServer = (...args: string[]) => tmuxOn([], ...args);
	const worker = (text: string) => {
		defaultServer('new-session', '-d', '-s', 'firstmate', 'sleep 600');
		defaultServer(
			'new-window',
			'-d',
			'-t',
			'firstmate:',
			'-n',
			'fm-t-1',
			`echo ${text}; sleep 600`
		);
	};
	const killAll = () => {
		for (const server of [['-L', socket], []]) {
			try {
				tmuxOn(server, 'kill-server');
			} catch {
				// already gone
			}
		}
	};
	/** Peek as runtime.ts wires the adapter, or (`crew: false`) as it did before crewTmux. */
	const peek = async (wheelhouseEnv: NodeJS.ProcessEnv, { crew = true } = {}) => {
		const adapter = createScriptAdapter(
			{ firstmateDir: fmDir, homeDir: home },
			{
				env: wheelhouseEnv,
				tmux: firstmateTmux({ tmuxSocket: socket, env: wheelhouseEnv }),
				crew: crew ? crewTmux({ homeDir: home, tmuxSocket: socket, env: wheelhouseEnv }) : undefined
			}
		);
		const r = await adapter.peek('t-1', 40);
		return r.ok ? r.value.lines.filter(Boolean) : r.error.message;
	};
	const until = async (check: () => Promise<boolean>) => {
		for (let i = 0; i < 50 && !(await check()); i++) await new Promise((r) => setTimeout(r, 100));
	};

	beforeEach(() => {
		tmp = mkdtempSync('/tmp/wh-crew-tmux-');
		fmDir = mkdtempSync(path.join(tmpdir(), 'wh-crew-fm-'));
		mkdirSync(path.join(fmDir, 'bin'));
		const peekScript = path.join(fmDir, 'bin', 'fm-peek.sh');
		writeFileSync(
			peekScript,
			'#!/usr/bin/env bash\nset -eu\n' +
				'T=$(sed -n "s/^window=//p" "$FM_HOME/state/$1.meta" | tail -n 1)\n' +
				'tmux capture-pane -p -t "$T" -S -"$2"\n'
		);
		chmodSync(peekScript, 0o755);
		env = { PATH: process.env.PATH, HOME: process.env.HOME, TMUX_TMPDIR: tmp };
		wheelhouse('new-session', '-d', '-s', FIRSTMATE_TMUX, 'sleep 600');
		worker('crew-on-default');
	});
	afterEach(() => {
		killAll();
		rmSync(tmp, { recursive: true, force: true });
		rmSync(fmDir, { recursive: true, force: true });
	});

	const sees = (text: string, wheelhouseEnv: NodeJS.ProcessEnv) =>
		until(async () => {
			const lines = await peek(wheelhouseEnv);
			return Array.isArray(lines) && lines.includes(text);
		}).then(() => peek(wheelhouseEnv));

	it('reads a worker on the default server with Wheelhouse launched outside tmux', async () => {
		expect(await sees('crew-on-default', env)).toContain('crew-on-default');
	});

	it("reads it with Wheelhouse restarted inside Firstmate's own session, inheriting its TMUX", async () => {
		const inherited = wheelhouse(
			'display-message',
			'-p',
			'-t',
			`=${FIRSTMATE_TMUX}:`,
			'#{socket_path},#{pid},0'
		);
		const paneEnv = { ...env, TMUX: inherited, TMUX_PANE: '%0' };
		expect(await sees('crew-on-default', paneEnv)).toContain('crew-on-default');
		// Pointing every script at Firstmate's session's server was the bug the captain kept seeing.
		expect(await peek(paneEnv, { crew: false })).toMatch(/can't find session: firstmate/);
		expect(await peek(env, { crew: false })).toMatch(/can't find session: firstmate/);
	});

	it('follows the worker after its tmux server restarts', async () => {
		expect(await sees('crew-on-default', env)).toContain('crew-on-default');
		defaultServer('kill-server');
		worker('crew-after-restart');
		expect(await sees('crew-after-restart', env)).toContain('crew-after-restart');
	});
});
