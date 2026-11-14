import { randomBytes } from 'node:crypto';
import { accessSync, constants, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { BackendResult, LaunchSpec, SessionBackend, SessionKey } from './backend';
import type { AttachTarget } from './terminal';

/**
 * The tmux session backend that runs the Firstmate session, and small pieces
 * shared by everything that talks to tmux. The session runs on tmux's default
 * server, where Firstmate's tmux backend puts the crew it spawns, so the TMUX
 * and TMUX_PANE tmux gives its pane name Firstmate's own server and pane for
 * its crew commands and its supervision alike. A socket name
 * (`tmux -L <name>`) moves it to a server of its own instead. Firstmate's crew
 * run wherever Firstmate spawned them, which firstmate/crew.ts works out per
 * task.
 */

/**
 * The server (`tmux -L wheelhouse`) earlier Wheelhouse versions ran the session
 * on. With no socket set, a session still running there is used until it ends.
 */
export const LEGACY_TMUX_SOCKET = 'wheelhouse';
/** A socket name is one plain path component, never a path. */
export const TMUX_SOCKET = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
/** tmux's "there is nothing to list" answers, which are not failures. */
export const NO_SERVER = /no server running|error connecting to|no sessions/i;

export type Run = (file: string, args: readonly string[], opts: RunOptions) => Promise<RunResult>;

/** tmux's arguments for a server: `-L <socket>`, or none for the default server. */
export const serverArgs = (socket: string | null): string[] => (socket ? ['-L', socket] : []);

/**
 * The servers the Firstmate session may be on, in the order to look: the
 * configured socket's alone, or the default server and then the legacy one.
 */
export const firstmateServers = (socket: string | null | undefined): (string | null)[] =>
	socket ? [socket] : [null, LEGACY_TMUX_SOCKET];

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
 * inherit: tmux's (we choose the server ourselves), Wheelhouse's, and the runtime
 * markers of any Claude Code session Wheelhouse itself was started from, which
 * would otherwise make the new session believe it runs inside that one.
 */
export const DROPPED_VARIABLES: readonly string[] = [
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
];
const DROP = new Set(DROPPED_VARIABLES);

/**
 * Variables a session's command must not inherit from its server, which may
 * have been started from inside another Claude Code session or tmux: the ones
 * Wheelhouse drops from its own environment, and the markers Claude Code sets
 * for the processes it runs.
 */
const COMMAND_UNSET = [
	...DROPPED_VARIABLES,
	'CLAUDE_CODE_CHILD_SESSION',
	'CLAUDE_CODE_SESSION_ID',
	'CLAUDE_CODE_SESSION_ATTENDED',
	'CLAUDE_CODE_EXECPATH',
	'CLAUDE_EFFORT'
];

/** Families of variables the command must not inherit, unset by name prefix. */
const COMMAND_UNSET_PREFIXES = ['CLAUDE_CODE_MESSAGING_'];

/**
 * A session's command for a multiplexer that gives it its server's
 * environment rather than the caller's: `sh` unsetting what it must not
 * inherit (except `keep` and the spec's own variables), then exec'ing the
 * harness's argv, passed as positional arguments so none of it is sh source.
 */
export function cleanCommand(
	shBinary: string,
	spec: LaunchSpec,
	keep: readonly string[] = []
): string[] {
	const unset = COMMAND_UNSET.filter((name) => !(name in spec.env) && !keep.includes(name));
	const families = COMMAND_UNSET_PREFIXES.map((p) => `${p}*`).join('|');
	const script = [
		`unset ${unset.join(' ')}`,
		`for n in $(env | while IFS== read -r n _; do case "$n" in (*[!A-Za-z0-9_]*) ;; (${families}) echo "$n" ;; esac; done); do unset "$n"; done`,
		'exec "$@"'
	].join('\n');
	return [shBinary, '-c', script, 'sh', ...spec.argv];
}

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

/** The variables tmux sets for the pane itself, which the session keeps. */
const PANE_VARIABLES = ['TMUX', 'TMUX_PANE'];

/**
 * The session's command: `sh` unsetting everything it inherited from the
 * server except the pane's own TMUX and TMUX_PANE, then taking exactly the
 * environment in `envPath` (see envFileContent) and removing that file, then
 * exec'ing the harness's argv, passed as positional arguments so none of it is
 * sh source.
 */
const SESSION_SCRIPT = [
	`for n in $(env | while IFS== read -r n _; do case "$n" in ('' | [0-9]* | *[!A-Za-z0-9_]* | ${PANE_VARIABLES.join(' | ')}) ;; (*) echo "$n" ;; esac; done); do unset "$n"; done`,
	'. "$1"',
	'/bin/rm -f "$1"',
	'shift',
	'exec "$@"'
].join('\n');

/**
 * The environment file the session's command reads: one `export` line per
 * variable sh can name, never the pane's own TMUX or TMUX_PANE. It goes through
 * a file, not the command line, so no value shows in a process listing.
 */
export function envFileContent(env: NodeJS.ProcessEnv): string {
	return Object.entries(env)
		.filter(
			([k, v]) =>
				v !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !PANE_VARIABLES.includes(k)
		)
		.map(([k, v]) => `export ${k}='${(v as string).replace(/'/g, `'\\''`)}'\n`)
		.join('');
}

/**
 * tmux arguments that start the session detached, 160×48, as `spec` says. A
 * running server gives the pane its own global environment, which may be
 * another program's, so the command replaces it with the one in `envPath`,
 * keeping only the TMUX and TMUX_PANE tmux sets for the pane. The spec's
 * variables also go to tmux, which keeps them as the session's own.
 */
export function launchArgv(spec: LaunchSpec, envPath: string): string[] {
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
		'/bin/sh',
		'-c',
		SESSION_SCRIPT,
		'sh',
		envPath,
		...spec.argv
	];
}

/** The command a captain can copy to attach their own terminal. */
export const attachHint = (socket: string | null) =>
	shellLine(['tmux', ...serverArgs(socket), 'attach', '-t', FIRSTMATE_TMUX]);

export interface TmuxBackendOptions {
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET; default tmux's default server. */
	socket?: string | null;
	/** The session's environment, already cleaned by sessionEnv. */
	env: NodeJS.ProcessEnv;
	find: (name: string) => string | null;
	run?: Run;
}

/**
 * The Firstmate session as a detached tmux session named `wh-firstmate` on
 * tmux's default server, or the configured socket's. Every tmux call goes to
 * the server running() last found the session on (the legacy server while a
 * session from an earlier Wheelhouse still runs there) and the exact session
 * name, as argument arrays; nothing ever stops a server. A message goes in
 * through a tmux paste buffer, pasted as a bracketed paste so a multi-line
 * message is one message.
 */
export class TmuxBackend implements SessionBackend {
	readonly label = 'tmux';
	/** The configured socket, or null for the default server. */
	readonly configured: string | null;
	/** The server the session is on: running() keeps it current. */
	socket: string | null;
	private env: NodeJS.ProcessEnv;
	private find: (name: string) => string | null;
	private run: Run;

	constructor(opts: TmuxBackendOptions) {
		this.configured = opts.socket || null;
		this.socket = this.configured;
		this.env = opts.env;
		this.find = opts.find;
		this.run = opts.run ?? runBounded;
	}

	unavailable(): string | null {
		if (this.configured !== null && !TMUX_SOCKET.test(this.configured)) {
			return `The tmux socket name ${JSON.stringify(this.configured)} is not valid; use letters, digits, '.', '_' or '-'.`;
		}
		if (!this.find('tmux')) {
			return 'tmux is not installed or not on PATH. Install tmux (for example `brew install tmux`) and restart Wheelhouse.';
		}
		return null;
	}

	/** Run tmux on the session's server only; nothing reaches tmux any other way. */
	private tmux(
		args: string[],
		extra: Partial<RunOptions> = {},
		socket = this.socket
	): Promise<RunResult> {
		const tmux = this.find('tmux');
		if (!tmux) return Promise.reject(new Error('tmux is missing'));
		return this.run(tmux, [...serverArgs(socket), ...args], {
			env: this.env,
			timeoutMs: TMUX_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024,
			...extra
		});
	}

	async running(): Promise<boolean | null> {
		if (!this.find('tmux') || this.unavailable()) return null;
		for (const socket of firstmateServers(this.configured)) {
			const r = await this.tmux(['list-sessions', '-F', '#{session_name}'], {}, socket);
			if (r.ok && r.stdout.split('\n').includes(FIRSTMATE_TMUX)) {
				this.socket = socket;
				return true;
			}
			const absent = r.ok || (r.kind === 'exit' && NO_SERVER.test(r.stderr));
			if (!absent && socket === this.configured) return null;
		}
		this.socket = this.configured;
		return false;
	}

	async start(spec: LaunchSpec): Promise<BackendResult> {
		// The session's environment is Wheelhouse's, whoever started the server; its command removes the file.
		const envPath = path.join(tmpdir(), `wh-firstmate-env-${randomBytes(8).toString('hex')}`);
		writeFileSync(envPath, envFileContent({ ...this.env, ...spec.env }), {
			mode: 0o600,
			flag: 'wx'
		});
		const r = await this.tmux(launchArgv(spec, envPath), { cwd: spec.cwd });
		if (!r.ok) {
			rmSync(envPath, { force: true });
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
		const r = await this.tmux(['show-environment', '-t', `=${FIRSTMATE_TMUX}:`, name]);
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
				...serverArgs(this.socket),
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
 * Firstmate session runs on (the servers firstmateServers names, in order), or
 * null when that session is not running there
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
	const socket = opts.tmuxSocket || null;
	const env = sessionEnv(opts.env ?? process.env);
	const find = opts.find ?? ((name) => which(name, env.PATH));
	const run = opts.run ?? runBounded;
	return async () => {
		const tmux = find('tmux');
		if (!tmux || (socket !== null && !TMUX_SOCKET.test(socket))) return null;
		for (const server of firstmateServers(socket)) {
			const r = await run(
				tmux,
				[...serverArgs(server), 'display-message', '-p', '-t', `=${FIRSTMATE_TMUX}:`, TMUX_FORMAT],
				{ env, timeoutMs: TMUX_TIMEOUT_MS, maxOutputBytes: 64 * 1024 }
			);
			if (!r.ok) continue;
			// TMUX is "<socket path>,<server pid>,<session index>"; #{session_id} prints the index as $N.
			const value = r.stdout.trim().replace(/,\$(\d+)$/, ',$1');
			return /^\/.*,\d+,\d+$/.test(value) ? value : null;
		}
		return null;
	};
}
