import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter } from './adapter';
import { FIRSTMATE_TMUX, firstmateTmux, which } from '../sessions/tmux';
import { createFakeFirstmate, type FakeFirstmate } from '../../../../tests/helpers/fake-firstmate';

let fm: FakeFirstmate;
const adapter = (opts = {}) =>
	createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root }, opts);

beforeEach(() => {
	fm = createFakeFirstmate();
});
afterEach(() => fm.cleanup());

describe('tmux server', () => {
	// The real thing: Wheelhouse started from a plain shell, its Firstmate session on its own server.
	it.skipIf(!which('tmux', process.env.PATH))(
		'lets a script without an ambient TMUX find the session on a real tmux server',
		async () => {
			const tmp = mkdtempSync('/tmp/wh-tmux-');
			const socket = 'wh-adapter-test';
			const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMUX_TMPDIR: tmp };
			const tmux = (...args: string[]) =>
				execFileSync('tmux', ['-L', socket, ...args], { env, stdio: 'pipe' });
			fm.set(
				'bin/fm-peek.sh',
				'#!/usr/bin/env bash\nenv -u TMUX_TMPDIR tmux has-session -t "=' +
					FIRSTMATE_TMUX +
					'" && echo found\n'
			);
			chmodSync(path.join(fm.root, 'bin', 'fm-peek.sh'), 0o755);
			try {
				tmux('new-session', '-d', '-s', FIRSTMATE_TMUX, 'sleep 600');
				const without = await adapter({ env }).peek('t-1', 5);
				expect(without.ok).toBe(false);
				const r = await adapter({ env, tmux: firstmateTmux({ tmuxSocket: socket, env }) }).peek(
					't-1',
					5
				);
				expect(r.ok && r.value.lines).toEqual(['found']);
			} finally {
				try {
					tmux('kill-server');
				} catch {
					// already gone
				}
				rmSync(tmp, { recursive: true, force: true });
			}
		}
	);
});
