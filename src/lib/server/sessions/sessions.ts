import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '../store/store';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { SessionOutput, SessionProject, SessionSummary, SessionsView } from '../../types';

/**
 * Captain-owned Claude Code sessions: "New session" starts an interactive
 * `claude` in a detached tmux session named `wh-session-<id>`, then opens the
 * captain's terminal attached to it. These are the captain's own sessions, not
 * Firstmate's crew; Wheelhouse still never starts, stops or steers a worker.
 *
 * Each session runs in a fresh scratch directory under Wheelhouse's state
 * directory (`<state>/sessions/<id>/`), never inside the Firstmate home or a
 * project checkout. A project session gets the project attached with
 * `--add-dir` (which does not prevent edits) and an opening note instructing
 * it that the project is for reading and brainstorming, not editing. Wheelhouse's record of each session sits next to
 * its scratch directory (`<state>/sessions/<id>.json`).
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
export const PREVIEW_DEFAULT_LINES = 40;
export const PREVIEW_MAX_LINES = 200;
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

/** argv that attaches a terminal to the session (exact-name match, Wheelhouse's tmux server). */
export function attachArgv(tmux: string, socket: string, id: string): string[] {
	return [tmux, '-L', socket, 'attach-session', '-t', `=${tmuxName(id)}`];
}

/** One shell-quoted command line, for display and for Terminal's `do script`. */
export function shellLine(argv: string[]): string {
	return argv
		.map((a) => (/^[A-Za-z0-9_./=:@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
		.join(' ');
}

/** A terminal template must have `{attach}` as one of its whitespace-separated words. */
export function isTerminalTemplate(template: string): boolean {
	return template.trim().split(/\s+/).includes('{attach}');
}

/**
 * argv that opens the captain's terminal attached to the session.
 * `template` (from --terminal or WHEELHOUSE_TERMINAL) is split on whitespace
 * and its `{attach}` word becomes the attach argv as separate arguments; a
 * template without `{attach}` is not used. Without a template, macOS uses
 * Terminal through osascript; other platforms need a template.
 */
export function terminalArgv(
	template: string | null,
	platform: NodeJS.Platform,
	attach: string[]
): string[] | null {
	if (template?.trim()) {
		if (!isTerminalTemplate(template)) return null;
		return template
			.trim()
			.split(/\s+/)
			.flatMap((t) => (t === '{attach}' ? attach : [t]));
	}
	if (platform === 'darwin') {
		const script = shellLine(attach).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		return [
			'osascript',
			'-e',
			`tell application "Terminal" to do script "${script}"`,
			'-e',
			'tell application "Terminal" to activate'
		];
	}
	return null;
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

/** Start a terminal command detached; a quick non-zero exit or a spawn error is a failure. */
export function spawnTerminal(argv: string[], settleMs = 2_000): Promise<string | null> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (error: string | null) => {
			if (done) return;
			done = true;
			resolve(error);
		};
		try {
			const child = spawn(argv[0], argv.slice(1), {
				detached: true,
				stdio: 'ignore',
				shell: false
			});
			child.on('error', (e) => finish(e.message));
			child.on('exit', (code, signal) =>
				finish(
					code === 0
						? null
						: `${argv[0]} ${signal ? `was killed by ${signal}` : `exited with code ${code}`}`
				)
			);
			child.unref();
			setTimeout(() => finish(null), settleMs).unref();
		} catch (e) {
			finish((e as Error).message);
		}
	});
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
	/** Opens a terminal; returns why it failed, or null. Tests mock this. */
	openTerminal?: (argv: string[]) => Promise<string | null>;
	/** --terminal / WHEELHOUSE_TERMINAL. */
	terminal?: string | null;
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET: the `tmux -L` name; defaults to DEFAULT_TMUX_SOCKET. */
	tmuxSocket?: string | null;
	platform?: NodeJS.Platform;
	/** Environment for tmux (a new tmux server keeps it). */
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	newId?: (now: number) => string;
}

export type LaunchResult =
	| { ok: true; session: SessionSummary; terminalError: string | null }
	| { ok: false; status: 400 | 409 | 500 | 503; error: string };

export type OpenResult = { ok: true } | { ok: false; status: 404 | 409 | 500 | 503; error: string };

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
	private openTerminalFn: (argv: string[]) => Promise<string | null>;
	private terminal: string | null;
	readonly tmuxSocket: string;
	private platform: NodeJS.Platform;
	private env: NodeJS.ProcessEnv;
	private now: () => number;
	private newId: (now: number) => string;

	constructor(opts: SessionManagerOptions) {
		this.dir = path.resolve(opts.dir);
		this.forbidden = opts.forbidden;
		this.env = sessionEnv(opts.env ?? process.env);
		this.find = opts.find ?? ((name) => which(name, this.env.PATH));
		this.run = opts.run ?? runBounded;
		this.openTerminalFn = opts.openTerminal ?? spawnTerminal;
		this.terminal = opts.terminal ?? null;
		this.tmuxSocket = opts.tmuxSocket || DEFAULT_TMUX_SOCKET;
		this.platform = opts.platform ?? process.platform;
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
		const tmux = this.find('tmux') ?? 'tmux';
		return {
			id: r.id,
			tmux: tmuxName(r.id),
			project: r.project,
			prompt: r.prompt,
			createdAt: r.createdAt,
			dir: r.dir,
			state: live === null ? 'unknown' : live.has(tmuxName(r.id)) ? 'alive' : 'ended',
			attach: shellLine(attachArgv(tmux, this.tmuxSocket, r.id))
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
		const terminalError = await this.attach(tmux, id);
		return { ok: true, session: this.summary(record, new Set([tmuxName(id)])), terminalError };
	}

	/** Open the captain's terminal on the session; returns why it failed, or null. */
	private async attach(tmux: string, id: string): Promise<string | null> {
		const argv = terminalArgv(this.terminal, this.platform, attachArgv(tmux, this.tmuxSocket, id));
		if (!argv) {
			return 'Wheelhouse does not know how to open a terminal on this system. Start Wheelhouse with --terminal "<command> {attach}" ({attach} as its own word), or attach yourself.';
		}
		const error = await this.openTerminalFn(argv);
		return error ? `Wheelhouse could not open your terminal: ${error}` : null;
	}

	/** Re-open the captain's terminal attached to a live session. */
	async open(id: string): Promise<OpenResult> {
		const tmux = this.find('tmux');
		if (!tmux || !TMUX_SOCKET.test(this.tmuxSocket)) {
			return { ok: false, status: 503, error: this.unavailable() ?? 'tmux is missing.' };
		}
		const s = await this.get(id);
		if (!s) return { ok: false, status: 404, error: `There is no session called ${id}.` };
		if (s.state === 'ended') return { ok: false, status: 409, error: 'This session has ended.' };
		const error = await this.attach(tmux, id);
		return error ? { ok: false, status: 500, error } : { ok: true };
	}

	/** A bounded, read-only sample of the session's last lines. */
	async preview(id: string, lines: number): Promise<SessionOutput | null> {
		const s = await this.get(id);
		if (!s) return null;
		const n = Math.min(PREVIEW_MAX_LINES, Math.max(1, Math.floor(lines)));
		const capturedAt = new Date(this.now()).toISOString();
		const base = { requested: n, capturedAt };
		if (s.state !== 'alive') {
			return {
				...base,
				available: false,
				reason:
					s.state === 'ended'
						? 'The session has ended. Anything it wrote is in its scratch directory.'
						: 'Wheelhouse could not ask tmux whether the session is running.',
				lines: []
			};
		}
		const r = await this.tmux(
			this.find('tmux') as string,
			['capture-pane', '-p', '-J', '-t', `=${tmuxName(id)}:`, '-S', `-${n}`],
			{ env: this.env, timeoutMs: TMUX_TIMEOUT_MS, maxOutputBytes: 512 * 1024 }
		);
		if (!r.ok) {
			return {
				...base,
				available: false,
				reason: `tmux could not read the session: ${r.stderr.trim() || r.message}`,
				lines: []
			};
		}
		const out = r.stdout.replace(/\s+$/, '').split('\n');
		return {
			...base,
			available: true,
			reason: null,
			lines: out.length === 1 && out[0] === '' ? [] : out.slice(-n)
		};
	}
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
