import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { BackendResult, LaunchSpec, SessionBackend, SessionKey } from './backend';
import type { AttachTarget } from './terminal';

/**
 * Wheelhouse's own tmux server (`tmux -L wheelhouse`, configurable): the tmux
 * session backend that runs the Firstmate session, and small pieces shared by
 * everything that talks to tmux. Wheelhouse starts only its Firstmate session
 * there; Firstmate's crew run wherever Firstmate spawned them, which
 * firstmate/crew.ts works out per task.
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
	'CLAUDE_ENV_FILE',
	'CODEX_THREAD_ID',
	'CODEX_INTERNAL_ORIGINATOR_OVERRIDE'
]);

export function sessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (DROP.has(k) || k.startsWith('WHEELHOUSE_')) continue;
		out[k] = v;
	}
	return out;
}

/** The tmux session Wheelhouse runs Firstmate in. */
export const FIRSTMATE_TMUX = 'wh-firstmate';

const TMUX_TIMEOUT_MS = 10_000;
const TMUX_FORMAT = '#{socket_path},#{pid},#{session_id}';
const BUFFER = 'wh-firstmate-input';
/** The message is at most 64 KiB (FirstmateSession checks); this leaves tmux's load-buffer room. */
const PASTE_MAX_INPUT_BYTES = 65 * 1024;

/**
 * tmux options for the Firstmate session: mouse mode so the wheel reaches
 * Claude Code's scrolling in the terminal drawer, no status bar, and a long
 * history for the drawer's scrollback.
 */
const SESSION_OPTIONS: [string, string][] = [
	['mouse', 'on'],
	['status', 'off'],
	['history-limit', '20000']
];

/** tmux's key names for the session's keys (the same names, as it happens). */
const TMUX_KEYS: Record<SessionKey, string> = {
	Enter: 'Enter',
	Escape: 'Escape',
	Up: 'Up',
	Down: 'Down',
	'0': '0',
	'1': '1',
	'2': '2',
	'3': '3',
	'4': '4',
	'5': '5',
	'6': '6',
	'7': '7',
	'8': '8',
	'9': '9'
};

/** tmux arguments that start the session detached, 160×48, as `spec` says. */
export function launchArgv(spec: LaunchSpec): string[] {
	return [
		'new-session',
		'-d',
		'-s',
		FIRSTMATE_TMUX,
		'-x',
		'160',
		'-y',
		'48',
		'-c',
		spec.cwd,
		...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
		'--',
		...spec.argv
	];
}

/** The command a captain can copy to attach their own terminal. */
export const attachHint = (socket: string) =>
	shellLine(['tmux', '-L', socket, 'attach', '-t', FIRSTMATE_TMUX]);

export interface TmuxBackendOptions {
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET; default `wheelhouse`. */
	socket?: string | null;
	/** The session's environment, already cleaned by sessionEnv. */
	env: NodeJS.ProcessEnv;
	find: (name: string) => string | null;
	run?: Run;
}

/**
 * The Firstmate session as a detached tmux session named `wh-firstmate` on
 * Wheelhouse's own tmux server. Every tmux call goes to that server and the
 * exact session name, as argument arrays. A message goes in through a tmux
 * paste buffer, pasted as a bracketed paste so a multi-line message is one
 * message.
 */
export class TmuxBackend implements SessionBackend {
	readonly label = 'tmux';
	readonly socket: string;
	private env: NodeJS.ProcessEnv;
	private find: (name: string) => string | null;
	private run: Run;

	constructor(opts: TmuxBackendOptions) {
		this.socket = opts.socket || DEFAULT_TMUX_SOCKET;
		this.env = opts.env;
		this.find = opts.find;
		this.run = opts.run ?? runBounded;
	}

	unavailable(): string | null {
		if (!TMUX_SOCKET.test(this.socket)) {
			return `The tmux socket name ${JSON.stringify(this.socket)} is not valid; use letters, digits, '.', '_' or '-'.`;
		}
		if (!this.find('tmux')) {
			return 'tmux is not installed or not on PATH. Install tmux (for example `brew install tmux`) and restart Wheelhouse.';
		}
		return null;
	}

	/** Run tmux on Wheelhouse's own server only; nothing reaches tmux any other way. */
	private tmux(args: string[], extra: Partial<RunOptions> = {}): Promise<RunResult> {
		const tmux = this.find('tmux');
		if (!tmux) return Promise.reject(new Error('tmux is missing'));
		return this.run(tmux, ['-L', this.socket, ...args], {
			env: this.env,
			timeoutMs: TMUX_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024,
			...extra
		});
	}

	async running(): Promise<boolean | null> {
		if (!this.find('tmux') || !TMUX_SOCKET.test(this.socket)) return null;
		const r = await this.tmux(['list-sessions', '-F', '#{session_name}']);
		if (r.ok) return r.stdout.split('\n').includes(FIRSTMATE_TMUX);
		if (r.kind === 'exit' && NO_SERVER.test(r.stderr)) return false;
		return null;
	}

	async start(spec: LaunchSpec): Promise<BackendResult> {
		const r = await this.tmux(launchArgv(spec), { cwd: spec.cwd });
		if (!r.ok) {
			return {
				ok: false,
				error: `tmux could not start Firstmate: ${r.stderr.trim() || r.message}`
			};
		}
		for (const [name, value] of SESSION_OPTIONS) {
			await this.tmux(['set-option', '-t', `=${FIRSTMATE_TMUX}:`, name, value]);
		}
		return { ok: true };
	}

	async variable(name: string): Promise<string | null> {
		const r = await this.tmux(['show-environment', '-t', FIRSTMATE_TMUX, name]);
		if (r.ok) return r.stdout.trim().replace(new RegExp(`^${name}=`), '');
		return /unknown variable/.test(r.stderr) ? '' : null;
	}

	async screen(): Promise<string | null> {
		const r = await this.tmux(['capture-pane', '-p', '-t', `=${FIRSTMATE_TMUX}:`]);
		return r.ok ? r.stdout : null;
	}

	async paste(text: string): Promise<BackendResult> {
		const load = await this.tmux(['load-buffer', '-b', BUFFER, '-'], {
			input: text,
			maxInputBytes: PASTE_MAX_INPUT_BYTES
		});
		if (!load.ok) {
			return {
				ok: false,
				error: `tmux could not take the message: ${load.stderr.trim() || load.message}`
			};
		}
		const paste = await this.tmux([
			'paste-buffer',
			'-d',
			'-p',
			'-b',
			BUFFER,
			'-t',
			`=${FIRSTMATE_TMUX}:`
		]);
		if (!paste.ok) {
			return {
				ok: false,
				error: `tmux could not paste the message: ${paste.stderr.trim() || paste.message}`
			};
		}
		return { ok: true };
	}

	async key(key: SessionKey): Promise<BackendResult> {
		const r = await this.tmux(['send-keys', '-t', `=${FIRSTMATE_TMUX}:`, TMUX_KEYS[key]]);
		if (!r.ok) {
			return { ok: false, error: `tmux could not send a key: ${r.stderr.trim() || r.message}` };
		}
		return { ok: true };
	}

	attach(): Omit<AttachTarget, 'cwd'> {
		return {
			argv: [
				this.find('tmux') as string,
				'-L',
				this.socket,
				'attach-session',
				'-t',
				`=${FIRSTMATE_TMUX}`
			],
			env: { ...this.env, TERM: 'xterm-256color' }
		};
	}

	attachHint(): string {
		return attachHint(this.socket);
	}
}

/**
 * The TMUX value that puts Firstmate's scripts on the tmux server Wheelhouse's
 * Firstmate session runs on, or null when that session is not running there
 * (Firstmate runs elsewhere, or tmux is not in use). Firstmate's scripts reach
 * tmux through the ambient TMUX, so without it - Wheelhouse launched outside
 * tmux, or from the captain's own tmux - they would talk to another server and
 * never find the session's windows. Asked of tmux on each call, so it follows
 * the session across restarts of either side. Scripts that read a crewmate's
 * terminal use crewTmux instead, since the crew need not share this server.
 */
export function firstmateTmux(opts: {
	tmuxSocket?: string | null;
	env?: NodeJS.ProcessEnv;
	find?: (name: string) => string | null;
	run?: Run;
}): () => Promise<string | null> {
	const socket = opts.tmuxSocket || DEFAULT_TMUX_SOCKET;
	const env = sessionEnv(opts.env ?? process.env);
	const find = opts.find ?? ((name) => which(name, env.PATH));
	const run = opts.run ?? runBounded;
	return async () => {
		const tmux = find('tmux');
		if (!tmux || !TMUX_SOCKET.test(socket)) return null;
		const r = await run(
			tmux,
			['-L', socket, 'display-message', '-p', '-t', `=${FIRSTMATE_TMUX}:`, TMUX_FORMAT],
			{ env, timeoutMs: TMUX_TIMEOUT_MS, maxOutputBytes: 64 * 1024 }
		);
		if (!r.ok) return null;
		// TMUX is "<socket path>,<server pid>,<session index>"; #{session_id} prints the index as $N.
		const value = r.stdout.trim().replace(/,\$(\d+)$/, ',$1');
		return /^\/.*,\d+,\d+$/.test(value) ? value : null;
	};
}
