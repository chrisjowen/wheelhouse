import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter } from './adapter';
import { crewTmux } from './crew';
import { FIRSTMATE_TMUX, firstmateTmux } from '../sessions/firstmate';
import { which } from '../sessions/tmux';

let home: string;

const meta = (id: string, body: string) =>
	writeFileSync(path.join(home, 'state', `${id}.meta`), body);

beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'wh-crew-'));
	mkdirSync(path.join(home, 'state'));
	meta('t-1', 'window=firstmate:fm-t-1\nendpoint_task_id=t-1\nharness=claude\n');
	meta('t-2', 'window=firstmate:fm-t-2\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

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
