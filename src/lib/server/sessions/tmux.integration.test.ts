import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FIRSTMATE_TMUX, TmuxBackend, which } from './tmux';

/**
 * A real tmux server under a private TMUX_TMPDIR. The wizard's terminal and the
 * drawer are clients: each one resizes the window, and the last one leaving
 * must put the launch size back so a later client can resize it again.
 */
it.skipIf(!which('tmux', process.env.PATH))(
	'returns the session to 160×48 when its last client detaches',
	async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-tmux-detach-')));
		const env: NodeJS.ProcessEnv = {
			PATH: process.env.PATH ?? '/usr/bin:/bin',
			HOME: root,
			TERM: 'xterm-256color',
			TMUX_TMPDIR: root,
			LANG: 'C.UTF-8'
		};
		delete env.TMUX;
		delete env.TMUX_PANE;
		const ptyEnv = Object.fromEntries(
			Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
		);
		const tmux = (...args: string[]) => execFileSync('tmux', args, { env, encoding: 'utf8' });
		const size = () =>
			tmux(
				'display-message',
				'-p',
				'-t',
				FIRSTMATE_TMUX,
				'#{window_width} #{window_height}'
			).trim();
		const mod = (await import('node-pty')) as typeof import('node-pty') & {
			default?: typeof import('node-pty');
		};
		const spawn = mod.spawn ?? mod.default?.spawn;
		const attach = (cols: number, rows: number) =>
			spawn('tmux', ['attach-session', '-t', FIRSTMATE_TMUX], {
				name: 'xterm-256color',
				cols,
				rows,
				cwd: root,
				env: ptyEnv
			});
		const backend = new TmuxBackend({
			env,
			find: (name) => which(name, env.PATH)
		});
		try {
			expect(await backend.start({ cwd: root, argv: ['sleep', '600'], env: {} })).toEqual({
				ok: true
			});
			expect(size()).toBe('160 48');

			const wizard = attach(81, 17);
			await expect.poll(size, { timeout: 4_000 }).toBe('81 17');
			wizard.kill();
			await expect.poll(size, { timeout: 4_000 }).toBe('160 48');

			// A client that is still attached keeps its own size.
			const drawer = attach(147, 26);
			await expect.poll(size, { timeout: 4_000 }).toBe('147 26');
			const again = attach(81, 17);
			await expect.poll(size, { timeout: 4_000 }).toBe('81 17');
			again.kill();
			await expect.poll(size, { timeout: 4_000 }).toBe('147 26');
			drawer.kill();
			await expect.poll(size, { timeout: 4_000 }).toBe('160 48');

			// Restoring must not pin the window, or the next client could not resize it.
			const later = attach(81, 17);
			await expect.poll(size, { timeout: 4_000 }).toBe('81 17');
			later.kill();
			await expect.poll(size, { timeout: 4_000 }).toBe('160 48');
		} finally {
			try {
				tmux('kill-server');
			} catch {
				/* the server may already have exited */
			}
			rmSync(root, { recursive: true, force: true });
		}
	}
);
