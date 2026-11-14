import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	readFileSync,
	existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FirstmateSession } from './firstmate';
import { FIRSTMATE_TMUX } from './tmux';
import { which } from './tmux';
import { openCodeSnapshot } from './opencode';

it.skipIf(!which('tmux', process.env.PATH)).each(['codex', 'pi'] as const)(
	'launches and reattaches %s on an isolated real default tmux server',
	async (harness) => {
		const root = mkdtempSync(path.join(tmpdir(), 'wh-native-'));
		const firstmateDir = path.join(root, 'home');
		const bin = path.join(root, 'bin');
		mkdirSync(firstmateDir);
		mkdirSync(bin);
		writeFileSync(
			path.join(bin, harness),
			'#!/bin/sh\nprintf "%s\\0%s\\0%s" "$PATH" "$HOME" "${SERVER_ONLY-unset}" > "$WH_TEST_ENV_OUT"\nprintf "native-ready tmux=[%s] pane=[%s] cc=[%s] home=[%s]\\n" "$TMUX" "$TMUX_PANE" "$CLAUDECODE" "$FM_HOME"\nwhile IFS= read -r message; do printf "reply: %s\\n" "$message"; done\n',
			{ mode: 0o755 }
		);
		// No TMUX, so the default server is the one under TMUX_TMPDIR, never the captain's.
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: `${bin}${path.delimiter}${process.env.PATH}`,
			TMUX_TMPDIR: root,
			WH_TEST_ENV_OUT: path.join(root, 'pane-env')
		};
		delete env.TMUX;
		delete env.TMUX_PANE;
		const tmux = (...args: string[]) => execFileSync('tmux', args, { env, encoding: 'utf8' });
		const opts = {
			firstmateDir,
			homeDir: firstmateDir,
			stateDir: path.join(root, 'state'),
			lock: async () => 'free' as const,
			env
		};
		try {
			// A default server someone else started, from inside a Claude Code session.
			execFileSync(
				which('tmux', env.PATH)!,
				['new-session', '-d', '-s', 'firstmate', 'sleep 600'],
				{
					env: {
						...env,
						PATH: '/usr/bin:/bin',
						HOME: path.join(root, 'server-home'),
						SERVER_ONLY: 'leak',
						CLAUDECODE: '1',
						FM_HOME: '/stale/home'
					}
				}
			);
			const session = new FirstmateSession({ ...opts, harness });
			expect(await session.ensure()).toMatchObject({ state: 'ours', harness });
			expect(tmux('show-environment', '-t', FIRSTMATE_TMUX, 'WHEELHOUSE_HARNESS').trim()).toBe(
				`WHEELHOUSE_HARNESS=${harness}`
			);
			// TMUX names the default server the crew share, and TMUX_PANE Firstmate's own pane.
			const [socketPath, pid, sessionId, pane] = tmux(
				'display-message',
				'-p',
				'-t',
				`=${FIRSTMATE_TMUX}:`,
				'#{socket_path} #{pid} #{session_id} #{pane_id}'
			)
				.trim()
				.split(' ');
			expect(socketPath).toBe(
				path.join(realpathSync(root), `tmux-${process.getuid!()}`, 'default')
			);
			await expect
				.poll(() => tmux('capture-pane', '-p', '-t', FIRSTMATE_TMUX))
				.toContain(
					`native-ready tmux=[${socketPath},${pid},${sessionId.slice(1)}] pane=[${pane}] cc=[] home=[]`
				);
			// The rest of the agent's environment is Wheelhouse's, not the server's.
			expect(readFileSync(env.WH_TEST_ENV_OUT!, 'utf8').split('\0')).toEqual([
				env.PATH,
				env.HOME,
				'unset'
			]);
			tmux('send-keys', '-t', FIRSTMATE_TMUX, 'hello', 'Enter');
			await expect
				.poll(() => tmux('capture-pane', '-p', '-t', FIRSTMATE_TMUX))
				.toContain('reply: hello');
			const restarted = new FirstmateSession({ ...opts, harness: 'claude' });
			expect(await restarted.status()).toMatchObject({ state: 'ours', harness });
			expect((await restarted.terminal()).ok).toBe(true);
			expect(await restarted.send('unsafe chat input')).toMatchObject({ ok: false, status: 409 });
		} finally {
			try {
				tmux('kill-server');
			} catch {
				/* server may already have exited */
			}
			rmSync(root, { recursive: true, force: true });
		}
	}
);

it.skipIf(!which('tmux', process.env.PATH) || !which('opencode', process.env.PATH))(
	'binds the actual OpenCode TUI to an exact authenticated session without a model call',
	async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wh-opencode-live-'));
		const firstmateDir = path.join(root, 'project');
		mkdirSync(firstmateDir);
		const env = {
			...process.env,
			HOME: path.join(root, 'user'),
			XDG_CONFIG_HOME: path.join(root, 'config'),
			XDG_DATA_HOME: path.join(root, 'data'),
			XDG_CACHE_HOME: path.join(root, 'cache'),
			XDG_STATE_HOME: path.join(root, 'user-state'),
			TMUX_TMPDIR: root
		};
		const opts = {
			firstmateDir,
			homeDir: firstmateDir,
			stateDir: path.join(root, 'wheelhouse'),
			lock: async () => 'free' as const,
			tmuxSocket: 'opencode-live',
			env
		};
		try {
			const primary = new FirstmateSession({ ...opts, harness: 'opencode' });
			const view = await primary.ensure();
			expect(view).toMatchObject({ state: 'ours', reason: null, harness: 'opencode' });
			const connection = primary.openCodeConnection;
			if (!connection) throw new Error('Missing bound OpenCode connection');
			expect((await fetch(`${connection.url}/global/health`)).status).toBe(401);
			expect(await openCodeSnapshot(connection)).toMatchObject({
				source: { how: 'api', truncated: false },
				records: []
			});
			const admission = await fetch(
				`${connection.url}/api/session/${connection.sessionId}/prompt`,
				{
					method: 'POST',
					headers: {
						authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						id: 'msg_wheelhouse_observer_check',
						prompt: { text: 'Queued native chat check; do not execute.' },
						resume: false
					})
				}
			);
			expect(admission.ok).toBe(true);
			expect((await openCodeSnapshot(connection)).records).toMatchObject([
				{ type: 'user', message: { content: 'Queued native chat check; do not execute.' } }
			]);
			const restarted = new FirstmateSession({ ...opts, harness: 'claude' });
			expect(await restarted.status()).toMatchObject({
				state: 'ours',
				harness: 'opencode',
				canSend: true
			});
			expect(restarted.openCodeConnection?.sessionId).toBe(connection.sessionId);
		} finally {
			try {
				execFileSync('tmux', ['-L', opts.tmuxSocket, 'kill-server'], { env, stdio: 'ignore' });
			} catch {
				/* already stopped */
			}
			rmSync(root, { recursive: true, force: true });
		}
	},
	35_000
);

it.skipIf(!which('tmux', process.env.PATH) || !which('pi', process.env.PATH))(
	'loads the actual Pi observer and sends a native local command without a model call',
	async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wh-pi-live-'));
		const firstmateDir = path.join(root, 'project');
		mkdirSync(firstmateDir);
		const env = {
			PATH: process.env.PATH,
			HOME: path.join(root, 'user'),
			PI_CODING_AGENT_DIR: path.join(root, 'agent'),
			TMUX_TMPDIR: root
		};
		const opts = {
			firstmateDir,
			homeDir: firstmateDir,
			stateDir: path.join(root, 'wheelhouse'),
			lock: async () => 'free' as const,
			tmuxSocket: 'pi-live',
			env
		};
		try {
			const primary = new FirstmateSession({ ...opts, harness: 'pi' });
			expect(await primary.ensure()).toMatchObject({ state: 'ours', harness: 'pi' });
			await expect.poll(async () => (await primary.status()).menu, { timeout: 15_000 }).toBeNull();
			expect(await primary.send('/name Wheelhouse native observer check')).toEqual({ ok: true });
			await expect
				.poll(
					() =>
						existsSync(primary.hookFile)
							? JSON.parse(readFileSync(primary.hookFile, 'utf8')).leaf_id
							: null,
					{ timeout: 5000 }
				)
				.toBeTypeOf('string');
			const receipt = JSON.parse(readFileSync(primary.hookFile, 'utf8'));
			expect(receipt.wheelhouse_nonce).toBe(primary.sessionNonce);
			const restarted = new FirstmateSession({ ...opts, harness: 'claude' });
			expect(await restarted.status()).toMatchObject({
				state: 'ours',
				harness: 'pi',
				canSend: true
			});
			expect(restarted.sessionNonce).toBe(primary.sessionNonce);
		} finally {
			try {
				execFileSync('tmux', ['-L', opts.tmuxSocket, 'kill-server'], { env, stdio: 'ignore' });
			} catch {
				/* already stopped */
			}
			rmSync(root, { recursive: true, force: true });
		}
	},
	25_000
);
