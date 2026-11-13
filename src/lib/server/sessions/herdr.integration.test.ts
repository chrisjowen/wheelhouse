import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FirstmateSession, HERDR_RECORD } from './firstmate';
import { compareVersions, HERDR_MIN_VERSION, parseHerdrVersion } from './herdr';
import { which } from './tmux';

/**
 * The herdr backend against a real herdr: FirstmateSession starts a stand-in
 * `claude` in a herdr pane, types into it, presses keys, reads its screen,
 * reattaches from a second Wheelhouse, and notices a herdr restart.
 *
 * By default the test runs its own herdr server in a throwaway session, with
 * HOME and the XDG directories pointed at a temporary directory. herdr keeps
 * a session's socket under XDG_CONFIG_HOME, so that server cannot see or reach
 * any other herdr session; the test checks this before it starts anything, and
 * stops and deletes only its own session. It is skipped when herdr is not
 * installed or is older than HERDR_MIN_VERSION, as in CI, and its name then
 * says so.
 *
 * To run it against a herdr session you already have instead (a lab session),
 * set WHEELHOUSE_TEST_HERDR_SESSION to that session's name; the test then
 * never starts, stops or deletes a herdr server or session, skips the restart
 * check, and its stand-in exits at the end so its pane closes.
 * WHEELHOUSE_TEST_HERDR names the herdr executable to use (default: `herdr`
 * on PATH).
 */

const SHARED = process.env.WHEELHOUSE_TEST_HERDR_SESSION || null;
const HERDR = process.env.WHEELHOUSE_TEST_HERDR || which('herdr', process.env.PATH);

function herdrVersion(): string | null {
	if (!HERDR) return null;
	try {
		const out = execFileSync(HERDR, ['--version'], { encoding: 'utf8', timeout: 5_000 });
		return parseHerdrVersion(out);
	} catch {
		return null;
	}
}

const VERSION = herdrVersion();
const usable = VERSION !== null && compareVersions(VERSION, HERDR_MIN_VERSION) >= 0;
/** Said in the skipped test's name, so a run without herdr says how to include it. */
const SKIPPED = usable
	? ''
	: ` (skipped: ${VERSION ? `herdr ${VERSION} is older than ${HERDR_MIN_VERSION}` : 'herdr is not installed'}; install herdr ${HERDR_MIN_VERSION} or newer to run it)`;

/**
 * The stand-in for Claude Code: it reports the Claude Code markers it can see,
 * answers each line it reads with `reply: <line>` (without the bracketed-paste
 * markers Wheelhouse wraps a message in, or a key pressed before it), and
 * exits on `quit`.
 */
const FAKE_CLAUDE = `#!/bin/sh
printf 'fake-claude ready child=%s cc=%s harness=%s\\n' "\${CLAUDE_CODE_CHILD_SESSION-unset}" "\${CLAUDECODE-unset}" "\${WHEELHOUSE_HARNESS-unset}"
esc=$(printf '\\033')
while IFS= read -r line; do
	line=\${line#*"$esc[200~"}
	line=\${line%"$esc[201~"}
	[ "$line" = quit ] && exit 0
	[ -n "$line" ] && printf 'reply: %s\\n' "$line"
done
`;

it.skipIf(!usable)(
	`runs, drives and reattaches the Firstmate session in a real, isolated herdr session${SKIPPED}`,
	async () => {
		const herdr = HERDR as string;
		const root = mkdtempSync(path.join(tmpdir(), 'wh-herdr-'));
		const firstmateDir = path.join(root, 'firstmate');
		const bin = path.join(root, 'bin');
		for (const dir of [firstmateDir, bin]) mkdirSync(dir);
		writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
		// A short name keeps the session's socket path within the OS limit.
		const name = SHARED ?? `wh-it-${randomBytes(3).toString('hex')}`;
		const isolated = SHARED
			? {}
			: {
					HOME: path.join(root, 'home'),
					XDG_CONFIG_HOME: path.join(root, 'config'),
					XDG_DATA_HOME: path.join(root, 'data'),
					XDG_STATE_HOME: path.join(root, 'state-home'),
					XDG_CACHE_HOME: path.join(root, 'cache')
				};
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...isolated,
			PATH: `${bin}${path.delimiter}${process.env.PATH}`,
			// The pane must not inherit these from the herdr server, whatever started it.
			CLAUDECODE: '1',
			CLAUDE_CODE_CHILD_SESSION: '1'
		};
		for (const ambient of ['HERDR_SESSION', 'HERDR_SOCKET_PATH', 'HERDR_PANE_ID']) {
			delete env[ambient];
		}
		const find = (n: string) => (n === 'herdr' ? herdr : which(n, env.PATH));
		/** A herdr call on this test's own session, in its isolated directories. */
		const own = (...args: string[]) =>
			execFileSync(herdr, [...args], { env, encoding: 'utf8', timeout: 15_000 });

		if (!SHARED) {
			// Before anything starts: every session this herdr can see lives under the test's directory.
			const sessions = JSON.parse(own('session', 'list', '--json')) as {
				sessions: { name: string; session_dir: string }[];
			};
			for (const s of sessions.sessions) {
				if (!s.session_dir.startsWith(root + path.sep)) {
					throw new Error(
						`herdr does not keep its sessions under XDG_CONFIG_HOME (${s.name} is in ${s.session_dir}); refusing to start a server`
					);
				}
			}
		}

		const opts = {
			firstmateDir,
			homeDir: firstmateDir,
			stateDir: path.join(root, 'wheelhouse'),
			lock: async () => 'free' as const,
			sessionBackend: 'herdr' as const,
			herdrSession: name,
			harness: 'claude' as const,
			trustStore: null,
			env,
			find
		};
		const recordFile = path.join(opts.stateDir, HERDR_RECORD);
		const record = () =>
			JSON.parse(readFileSync(recordFile, 'utf8')) as { paneId: string; terminalId: string };
		const screen = (s: FirstmateSession) => s.backend.screen().then((text) => text ?? '');
		const session = new FirstmateSession(opts);
		try {
			expect(await session.status()).toMatchObject({ state: 'none' });
			expect(await session.ensure()).toMatchObject({
				state: 'ours',
				reason: null,
				harness: 'claude',
				canSend: true,
				attach: `herdr session attach ${name}`
			});
			const first = record();
			await expect
				.poll(() => screen(session), { timeout: 10_000 })
				.toContain('fake-claude ready child=unset cc=unset harness=claude');

			// A message goes in as one paste and Enter submits it; text that looks like herdr's options stays text.
			expect(await session.send('hello from wheelhouse')).toEqual({ ok: true });
			await expect.poll(() => screen(session)).toContain('reply: hello from wheelhouse');
			expect(await session.send('--session=elsewhere -n "quoted"')).toEqual({ ok: true });
			await expect.poll(() => screen(session)).toContain('reply: --session=elsewhere -n "quoted"');
			expect(await session.interrupt()).toEqual({ ok: true });

			// A second Wheelhouse finds the same pane, its harness and the drawer's target.
			const restarted = new FirstmateSession({ ...opts, harness: 'codex' });
			expect(await restarted.status()).toMatchObject({ state: 'ours', harness: 'claude' });
			expect(await restarted.terminal()).toMatchObject({
				ok: true,
				target: { argv: [herdr, 'session', 'attach', name], cwd: firstmateDir }
			});
			expect(await restarted.ensure()).toMatchObject({ state: 'ours' });
			expect(record()).toEqual(first);

			if (!SHARED) {
				// After a herdr restart the pane comes back under its id running a shell: not ours.
				own('session', 'stop', name, '--json');
				expect(await session.status()).toMatchObject({ state: 'none' });
				expect(await session.ensure()).toMatchObject({ state: 'ours', reason: null });
				expect(record().terminalId).not.toBe(first.terminalId);
				await expect
					.poll(() => screen(session), { timeout: 10_000 })
					.toContain('fake-claude ready');
				expect(await session.send('after restart')).toEqual({ ok: true });
				await expect.poll(() => screen(session)).toContain('reply: after restart');
			}

			// The stand-in exits; herdr closes its pane, and the session is no longer running.
			expect(await session.send('quit')).toEqual({ ok: true });
			await expect
				.poll(async () => (await session.status()).state, { timeout: 10_000 })
				.toBe('none');
		} finally {
			if (!SHARED) {
				for (const step of [
					['session', 'stop', name, '--json'],
					['session', 'delete', name, '--json']
				]) {
					try {
						own(...step);
					} catch {
						/* already stopped, or never started */
					}
				}
			}
			rmSync(root, { recursive: true, force: true });
		}
	},
	90_000
);
