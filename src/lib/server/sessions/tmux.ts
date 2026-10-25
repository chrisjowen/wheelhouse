import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import type { RunOptions, RunResult } from '../firstmate/exec';

/**
 * Small pieces shared by everything that talks to Wheelhouse's own tmux server
 * (`tmux -L wheelhouse`, configurable). That server is Wheelhouse's alone:
 * Firstmate's crew run on the default server, which nothing here ever names.
 */

/** The tmux socket name (`tmux -L <name>`) Wheelhouse uses by default. */
export const DEFAULT_TMUX_SOCKET = 'wheelhouse';
/** A socket name is one plain path component, never a path. */
export const TMUX_SOCKET = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
/** tmux's "there is nothing to list" answers, which are not failures. */
export const NO_SERVER = /no server running|error connecting to|no sessions/i;

export type Run = (file: string, args: readonly string[], opts: RunOptions) => Promise<RunResult>;

/** The first executable called `name` on PATH, or null. */
export function which(name: string, envPath: string | undefined): string | null {
	for (const dir of (envPath ?? '').split(path.delimiter)) {
		if (!dir) continue;
		const file = path.join(dir, name);
		try {
			accessSync(file, constants.X_OK);
			if (statSync(file).isFile()) return file;
		} catch {
			// not here
		}
	}
	return null;
}

/** One shell-quoted command line, for display (and for a hook command line). */
export function shellLine(argv: string[]): string {
	return argv
		.map((a) => (/^[A-Za-z0-9_./=:@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
		.join(' ');
}

/**
 * Variables from Wheelhouse's own launch that a session it starts must not
 * inherit: tmux's (we start our own server), Wheelhouse's, and the runtime
 * markers of any Claude Code session Wheelhouse itself was started from, which
 * would otherwise make the new session believe it runs inside that one.
 */
const DROP = new Set([
	'TMUX',
	'TMUX_PANE',
	'FM_HOME',
	'CLAUDECODE',
	'CLAUDE_CODE_ENTRYPOINT',
	'CLAUDE_CODE_SSE_PORT',
	'CLAUDE_PID',
	'CLAUDE_SESSION_ID',
	'CLAUDE_PROJECT_DIR',
	'CLAUDE_ENV_FILE'
]);

export function sessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (DROP.has(k) || k.startsWith('WHEELHOUSE_')) continue;
		out[k] = v;
	}
	return out;
}
