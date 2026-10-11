import { randomBytes } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '../store/store';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { SessionProject, SessionSummary, SessionsView } from '../../types';
import type { AttachTarget, ResolveTarget } from './terminal';
import { claudeStore, registerTrust } from './trust';

/**
 * Captain-owned Claude Code sessions: "New session" starts an interactive
 * `claude` in a detached tmux session named `wh-session-<id>`, which the
 * captain then uses in the browser through a live terminal attached to it
 * (terminal.ts). These are the captain's own sessions, not Firstmate's crew;
 * Wheelhouse still never starts, stops or steers a worker.
 *
 * Each session runs in a fresh scratch directory under Wheelhouse's state
 * directory (`<state>/sessions/<id>/`), never inside the Firstmate home or a
 * project checkout. A project session gets the project attached with
 * `--add-dir` (which does not prevent edits) and an opening note instructing
 * it that the project is for reading and brainstorming, not editing. Wheelhouse's record of each session sits next to
 * its scratch directory (`<state>/sessions/<id>.json`). Claude Code's workspace
 * trust is pre-registered for that fresh directory (trust.ts), so the session
 * starts at its prompt rather than on the trust dialog.
 *
 * Every tmux call goes to Wheelhouse's own tmux server (`tmux -L wheelhouse`,
 * configurable), never the default server Firstmate and its crew run on, so
 * nothing here can list, read or end their sessions.
 *
 * Everything runs as argument arrays: no shell ever sees the prompt.
 */

export const SESSION_SCHEMA = 'wheelhouse-session.v1';
/** Session ids are `<yyyymmdd>-<hhmmss>-<hex>`, safe in a tmux name and a path. */
export const SESSION_ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{4,8}$/;
export const PROMPT_MAX_BYTES = 8 * 1024;
/** The Sessions page lists at most this many, newest first. */
export const LIST_MAX = 100;

export const tmuxName = (id: string) => `wh-session-${id}`;
/** The tmux socket name (`tmux -L <name>`) Wheelhouse's sessions live on by default. */
export const DEFAULT_TMUX_SOCKET = 'wheelhouse';
/** A socket name is one plain path component, never a path. */
export const TMUX_SOCKET = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/** What Wheelhouse records about a session it launched. */
export interface SessionRecord {
	schema: typeof SESSION_SCHEMA;
	id: string;
	createdAt: string;
	project: SessionProject | null;
	prompt: string | null;
	/** The session's scratch directory (its working directory). */
	dir: string;
}

export interface LaunchInput {
	project: SessionProject | null;
	prompt: string | null;
}

/** The note appended to the session's system prompt. */
export function openingNote(project: SessionProject | null, dir: string): string {
	const scratch = `Your working directory, ${dir}, is a scratch directory for this session: write any notes, drafts or plans there. The captain may later hand this session to Firstmate, which can read what you left in it.`;
	if (!project) {
		return `This is a fresh brainstorming session the captain started from Wheelhouse for a new idea. ${scratch}`;
	}
	const where = project.path
		? `The project's checkout is at ${project.path}; you have access to it for reading and brainstorming only. Do not edit, commit, or run anything that changes files there.`
		: `Wheelhouse does not know where this project is checked out, so it is not attached; ask the captain if you need to read it.`;
	return `This is a brainstorming session the captain started from Wheelhouse about the project ${project.name}. ${where} ${scratch}`;
}

/** argv for the interactive `claude` the session runs. The prompt is one argument after `--`. */
export function claudeArgv(claude: string, record: SessionRecord): string[] {
	const argv = [claude];
	if (record.project?.path) argv.push('--add-dir', record.project.path);
	argv.push('--append-system-prompt', openingNote(record.project, record.dir));
	if (record.prompt) argv.push('--', record.prompt);
	return argv;
}

/**
 * tmux arguments to start the session detached in its scratch directory. With
 * more than one command argument tmux executes them directly, without a shell
 * (and claudeArgv always yields more than one).
 */
export function tmuxLaunchArgv(record: SessionRecord, claude: string): string[] {
	return [
		'new-session',
		'-d',
		'-s',
		tmuxName(record.id),
		'-c',
		record.dir,
		'--',
		...claudeArgv(claude, record)
	];
}

/** argv that attaches a tmux client to the session (exact-name match, Wheelhouse's tmux server). */
export function attachArgv(tmux: string, socket: string, id: string): string[] {
	return [tmux, '-L', socket, 'attach-session', '-t', `=${tmuxName(id)}`];
}

/** The short command a captain can copy to attach their own terminal. */
export function attachHint(socket: string, id: string): string {
	return shellLine(['tmux', '-L', socket, 'attach', '-t', tmuxName(id)]);
}

/** One shell-quoted command line, for display. */
export function shellLine(argv: string[]): string {
	return argv
		.map((a) => (/^[A-Za-z0-9_./=:@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
		.join(' ');
}

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

/** A new session id: UTC time to the second plus random hex. */
export function newSessionId(now: number, random = () => randomBytes(3).toString('hex')): string {
	const iso = new Date(now).toISOString();
	return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${random()}`;
}

export type Run = (file: string, args: readonly string[], opts: RunOptions) => Promise<RunResult>;

export interface SessionManagerOptions {
	/** `<state>/sessions`. */
	dir: string;
	/** Directories a scratch directory must never be inside (the Firstmate home). */
	forbidden: string[];
	/** Finds a program on PATH; defaults to which() over process.env.PATH. */
	find?: (name: string) => string | null;
	run?: Run;
	/**
	 * Claude Code's config store, where workspace trust for each new scratch
	 * directory is recorded; defaults to claudeStore() of the session's
	 * environment, and null skips it. Tests pass a temporary file.
	 */
	trustStore?: string | null;
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET: the `tmux -L` name; defaults to DEFAULT_TMUX_SOCKET. */
	tmuxSocket?: string | null;
	/** Environment for tmux (a new tmux server keeps it). */
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	newId?: (now: number) => string;
}

export type LaunchResult =
	| { ok: true; session: SessionSummary; warning: string | null }
	| { ok: false; status: 400 | 409 | 500 | 503; error: string };

/**
 * tmux options for a session shown in the browser: mouse mode, so the wheel
 * reaches Claude Code's own scrolling (or tmux's history) instead of becoming
 * arrow keys; and no status bar.
 */
export const SESSION_TMUX_OPTIONS: [string, string][] = [
	['mouse', 'on'],
	['status', 'off']
];

/** Variables from Wheelhouse's own launch that a captain's session should not inherit. */
function sessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (k === 'TMUX' || k === 'TMUX_PANE' || k === 'FM_HOME' || k.startsWith('WHEELHOUSE_'))
			continue;
		out[k] = v;
	}
	return out;
}

const TMUX_TIMEOUT_MS = 10_000;
const NO_SERVER = /no server running|error connecting to|no sessions/i;

export class SessionManager {
	readonly dir: string;
	private forbidden: string[];
	private find: (name: string) => string | null;
	private run: Run;
	private trustStore: string | null;
	readonly tmuxSocket: string;
	private env: NodeJS.ProcessEnv;
	private now: () => number;
	private newId: (now: number) => string;

	constructor(opts: SessionManagerOptions) {
		this.dir = path.resolve(opts.dir);
		this.forbidden = opts.forbidden;
		this.env = sessionEnv(opts.env ?? process.env);
		this.find = opts.find ?? ((name) => which(name, this.env.PATH));
		this.run = opts.run ?? runBounded;
		this.trustStore = opts.trustStore === undefined ? claudeStore(this.env) : opts.trustStore;
		this.tmuxSocket = opts.tmuxSocket || DEFAULT_TMUX_SOCKET;
		this.now = opts.now ?? Date.now;
		this.newId = opts.newId ?? ((n) => newSessionId(n));
	}

	/** Why sessions cannot be launched here, or null. */
	unavailable(): string | null {
		if (!TMUX_SOCKET.test(this.tmuxSocket)) {
			return `The tmux socket name ${JSON.stringify(this.tmuxSocket)} is not valid; use letters, digits, '.', '_' or '-'.`;
		}
		if (!this.find('tmux')) {
			return 'tmux is not installed or not on PATH. Install tmux (for example `brew install tmux`) and restart Wheelhouse.';
		}
		if (!this.find('claude')) {
			return 'Claude Code (`claude`) is not installed or not on PATH. Install it and restart Wheelhouse.';
		}
		const inside = this.forbidden.find((d) => isInside(this.dir, d));
		if (inside)
			return `The sessions directory ${this.dir} is inside ${inside}; choose a state directory outside it.`;
		return null;
	}

	/** Run tmux on Wheelhouse's own server only; nothing reaches tmux any other way. */
	private tmux(tmux: string, args: string[], opts: RunOptions): Promise<RunResult> {
		return this.run(tmux, ['-L', this.tmuxSocket, ...args], opts);
	}

	private recordFile(id: string): string {
		return path.join(this.dir, `${id}.json`);
	}

	private async readRecord(id: string): Promise<SessionRecord | null> {
		if (!SESSION_ID.test(id)) return null;
		try {
			const r = JSON.parse(await readFile(this.recordFile(id), 'utf8')) as SessionRecord;
			return r.schema === SESSION_SCHEMA && r.id === id ? r : null;
		} catch {
			return null;
		}
	}

	/** Names of live tmux sessions, or null when tmux cannot say. */
	private async liveNames(): Promise<Set<string> | null> {
		const tmux = this.find('tmux');
		if (!tmux || !TMUX_SOCKET.test(this.tmuxSocket)) return null;
		const r = await this.tmux(tmux, ['list-sessions', '-F', '#{session_name}'], {
			env: this.env,
			timeoutMs: TMUX_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024
		});
		if (r.ok) return new Set(r.stdout.split('\n').filter(Boolean));
		if (r.kind === 'exit' && NO_SERVER.test(r.stderr)) return new Set();
		return null;
	}

	private summary(r: SessionRecord, live: Set<string> | null): SessionSummary {
		return {
			id: r.id,
			tmux: tmuxName(r.id),
			project: r.project,
			prompt: r.prompt,
			createdAt: r.createdAt,
			dir: r.dir,
			state: live === null ? 'unknown' : live.has(tmuxName(r.id)) ? 'alive' : 'ended',
			attach: attachHint(this.tmuxSocket, r.id)
		};
	}

	async list(): Promise<SessionsView> {
		let ids: string[] = [];
		try {
			ids = (await readdir(this.dir))
				.filter((f) => f.endsWith('.json'))
				.map((f) => f.slice(0, -5))
				.filter((id) => SESSION_ID.test(id))
				.sort()
				.reverse()
				.slice(0, LIST_MAX);
		} catch {
			// no sessions yet
		}
		const records = (await Promise.all(ids.map((id) => this.readRecord(id)))).filter(
			(r): r is SessionRecord => r !== null
		);
		const live = records.length ? await this.liveNames() : new Set<string>();
		const reason = this.unavailable();
		return {
			schema: 'wheelhouse-sessions.v1',
			available: reason === null,
			reason,
			dir: this.dir,
			sessions: records.map((r) => this.summary(r, live))
		};
	}

	async get(id: string): Promise<SessionSummary | null> {
		const r = await this.readRecord(id);
		return r ? this.summary(r, await this.liveNames()) : null;
	}

	async launch(input: LaunchInput): Promise<LaunchResult> {
		const reason = this.unavailable();
		if (reason) return { ok: false, status: 503, error: reason };
		const tmux = this.find('tmux') as string;
		const claude = this.find('claude') as string;
		const id = this.newId(this.now());
		if (!SESSION_ID.test(id))
			return { ok: false, status: 500, error: 'Could not make a session id.' };
		const dir = path.join(this.dir, id);
		if (input.project?.path && isInside(dir, input.project.path)) {
			return {
				ok: false,
				status: 409,
				error: `The session directory would be inside the project ${input.project.path}; choose a state directory outside it.`
			};
		}
		const record: SessionRecord = {
			schema: SESSION_SCHEMA,
			id,
			createdAt: new Date(this.now()).toISOString(),
			project: input.project,
			prompt: input.prompt,
			dir
		};
		try {
			await mkdir(dir, { recursive: true });
			await writeFile(this.recordFile(id), `${JSON.stringify(record, null, '\t')}\n`, {
				flag: 'wx'
			});
		} catch (e) {
			return {
				ok: false,
				status: 500,
				error: `Wheelhouse could not create the session directory ${dir}: ${(e as Error).message}`
			};
		}
		const trustError = this.trustStore ? registerTrust(this.trustStore, dir) : null;
		const r = await this.tmux(tmux, tmuxLaunchArgv(record, claude), {
			cwd: dir,
			env: this.env,
			timeoutMs: TMUX_TIMEOUT_MS,
			maxOutputBytes: 64 * 1024
		});
		if (!r.ok) {
			await rm(this.recordFile(id), { force: true });
			await rm(dir, { recursive: true, force: true });
			const detail = r.stderr.trim() || r.message;
			return { ok: false, status: 500, error: `tmux could not start the session: ${detail}` };
		}
		for (const [name, value] of SESSION_TMUX_OPTIONS) {
			await this.tmux(tmux, ['set-option', '-t', `=${tmuxName(id)}:`, name, value], {
				env: this.env,
				timeoutMs: TMUX_TIMEOUT_MS,
				maxOutputBytes: 64 * 1024
			});
		}
		const warning = trustError
			? `Wheelhouse could not pre-approve Claude Code's workspace trust for the session (${trustError}), so it may first ask whether you trust its folder; answer it in the terminal.`
			: null;
		return { ok: true, session: this.summary(record, new Set([tmuxName(id)])), warning };
	}

	/**
	 * What the live terminal may attach to: only a session Wheelhouse launched
	 * (its record exists) that is running on Wheelhouse's own tmux server.
	 */
	terminal: ResolveTarget = async (id) => {
		const tmux = this.find('tmux');
		if (!tmux || !TMUX_SOCKET.test(this.tmuxSocket)) {
			return { ok: false, status: 503, error: this.unavailable() ?? 'tmux is missing.' };
		}
		const record = await this.readRecord(id);
		if (!record) return { ok: false, status: 404, error: `There is no session called ${id}.` };
		const live = await this.liveNames();
		if (!live) {
			return { ok: false, status: 503, error: 'Wheelhouse could not ask tmux about the session.' };
		}
		if (!live.has(tmuxName(id))) {
			return { ok: false, status: 409, error: 'This session has ended.' };
		}
		const target: AttachTarget = {
			argv: attachArgv(tmux, this.tmuxSocket, id),
			cwd: record.dir,
			env: { ...this.env, TERM: 'xterm-256color' }
		};
		return { ok: true, target };
	};
}

/** Validate a launch request against the projects Wheelhouse knows. */
export function validateLaunch(
	body: Record<string, unknown>,
	projects: SessionProject[]
): { ok: true; input: LaunchInput } | { ok: false; status: 400 | 413; error: string } {
	const { projectId, prompt } = body;
	let project: SessionProject | null = null;
	if (projectId !== undefined && projectId !== null && projectId !== '') {
		if (typeof projectId !== 'string')
			return { ok: false, status: 400, error: 'The project is not valid.' };
		project = projects.find((p) => p.id === projectId) ?? null;
		if (!project)
			return { ok: false, status: 400, error: `There is no project called ${projectId}.` };
	}
	if (prompt !== undefined && prompt !== null && typeof prompt !== 'string') {
		return { ok: false, status: 400, error: 'The opening prompt is not valid.' };
	}
	const text = typeof prompt === 'string' ? prompt.trim() : '';
	if (Buffer.byteLength(text) > PROMPT_MAX_BYTES) {
		return {
			ok: false,
			status: 413,
			error: `The opening prompt is limited to ${PROMPT_MAX_BYTES} bytes.`
		};
	}
	if (text.includes('\0'))
		return { ok: false, status: 400, error: 'The opening prompt is not valid.' };
	return { ok: true, input: { project, prompt: text || null } };
}
