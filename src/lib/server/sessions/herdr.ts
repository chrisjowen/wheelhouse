import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { BackendResult, LaunchSpec, SessionBackend, SessionKey } from './backend';
import type { AttachTarget } from './terminal';
import { DROPPED_VARIABLES, shellLine, type Run } from './tmux';

/**
 * The herdr session backend (experimental): the Firstmate session runs as an
 * agent pane in a dedicated, named herdr session (`wheelhouse` by default).
 *
 * Every herdr call names that session with `--session`, so Wheelhouse never
 * reaches the captain's other herdr sessions, whatever HERDR_* variables it was
 * launched with. Wheelhouse starts that session's server when it is not
 * running, as it starts its own tmux server, but never stops or restarts a
 * herdr server or session, and never closes a pane.
 *
 * herdr cannot report a pane's environment, so the pane's ids and the
 * variables it was launched with are kept in a record in Wheelhouse's state
 * directory. After a herdr server restart, herdr restores the pane under the
 * same pane id but with a new terminal running a plain shell, so the session
 * counts as running only while the pane's terminal is the one recorded at start.
 */

/** The herdr session Wheelhouse uses by default. */
export const DEFAULT_HERDR_SESSION = 'wheelhouse';
/** A herdr session name: one plain path component. */
export const HERDR_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The oldest herdr release this backend is verified against. */
export const HERDR_MIN_VERSION = '0.7.4';
/**
 * The agent name the Firstmate pane is started under, plus a fresh suffix each
 * start (a label only; panes are found by id). herdr keeps an agent's name on
 * the pane it restores after a server restart and refuses to start another
 * agent under a name in use, so a fixed name would block starting afresh.
 */
export const FIRSTMATE_AGENT = 'wh-firstmate';
const RECORD_SCHEMA = 'wheelhouse-herdr-session.v1';

const HERDR_TIMEOUT_MS = 10_000;
/** How long a newly started session server has to answer. */
const SERVER_START_MS = 10_000;
const SERVER_POLL_MS = 200;
/** The message is at most 64 KiB (FirstmateSession checks); one argv element may be 128 KiB on Linux. */
const PASTE_MAX_BYTES = 65 * 1024;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Variables a herdr call must not inherit: a Wheelhouse launched from inside a
 * herdr pane would otherwise have its calls follow that pane's socket.
 */
const HERDR_AMBIENT = [
	'HERDR_ENV',
	'HERDR_SESSION',
	'HERDR_SOCKET_PATH',
	'HERDR_PANE_ID',
	'HERDR_TAB_ID',
	'HERDR_WORKSPACE_ID'
];

/**
 * Variables the pane must not inherit from the herdr server, which may have
 * been started from inside another Claude Code session or tmux: the ones
 * Wheelhouse drops for its own tmux server, and the markers Claude Code sets
 * for the processes it runs. herdr gives a pane its server's environment, not
 * the caller's, so these are unset in the pane's command itself.
 */
const PANE_UNSET = [
	...DROPPED_VARIABLES,
	'CLAUDE_CODE_CHILD_SESSION',
	'CLAUDE_CODE_SESSION_ID',
	'CLAUDE_CODE_SESSION_ATTENDED',
	'CLAUDE_CODE_EXECPATH',
	'CLAUDE_EFFORT'
];

/** Families of variables the pane must not inherit, unset by name prefix. */
const PANE_UNSET_PREFIXES = ['CLAUDE_CODE_MESSAGING_'];

/** herdr's key names for the session's keys. */
const HERDR_KEYS: Record<SessionKey, string> = {
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

/** What Wheelhouse keeps about the pane it started. */
export interface HerdrRecord {
	schema: typeof RECORD_SCHEMA;
	session: string;
	paneId: string;
	terminalId: string;
	/** The variables the pane was launched with (LaunchSpec.env). */
	env: Record<string, string>;
}

/** Start a herdr session's server, detached, so it outlives Wheelhouse. */
export type SpawnServer = (
	file: string,
	args: string[],
	opts: { cwd: string; env: NodeJS.ProcessEnv }
) => void;

const spawnServer: SpawnServer = (file, args, opts) => {
	const child = spawn(file, args, { ...opts, detached: true, stdio: 'ignore' });
	child.on('error', () => {});
	child.unref();
};

/** -1, 0 or 1 as dotted version `a` is older than, the same as, or newer than `b`. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return Math.sign(d);
	}
	return 0;
}

/** herdr's error message from a failed call: either JSON shape on stderr, or its plain text. */
export function herdrError(r: RunResult): string {
	if (r.ok) return '';
	const text = r.stderr.trim() || r.stdout.trim();
	try {
		const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
		const message = parsed.error?.message ?? parsed.message;
		if (typeof message === 'string' && message) return message;
	} catch {
		/* not JSON */
	}
	return text || r.message;
}

/** herdr's error code from a failed call, when it gave one. */
function herdrCode(r: RunResult): string | null {
	if (r.ok) return null;
	try {
		const parsed = JSON.parse(r.stderr.trim()) as { error?: { code?: unknown }; code?: unknown };
		const code = parsed.error?.code ?? parsed.code;
		return typeof code === 'string' ? code : null;
	} catch {
		return null;
	}
}

function json(text: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(text) as unknown;
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The parts of `herdr status --json` this backend reads. */
interface HerdrStatus {
	clientVersion: string | null;
	clientProtocol: unknown;
	running: boolean;
	serverVersion: string | null;
	serverProtocol: unknown;
	compatible: unknown;
}

function parseStatus(stdout: string): HerdrStatus | null {
	const all = json(stdout);
	if (!all) return null;
	const client = obj(all.client);
	const server = obj(all.server);
	if (typeof server.running !== 'boolean') return null;
	return {
		clientVersion: str(client.version),
		clientProtocol: client.protocol,
		running: server.running,
		serverVersion: str(server.version),
		serverProtocol: server.protocol,
		compatible: server.compatible
	};
}

function parseRecord(text: string): HerdrRecord | null {
	const r = json(text);
	if (!r || r.schema !== RECORD_SCHEMA) return null;
	const env = obj(r.env);
	if (!str(r.session) || !str(r.paneId) || !str(r.terminalId)) return null;
	if (!Object.values(env).every((v) => typeof v === 'string')) return null;
	return {
		schema: RECORD_SCHEMA,
		session: r.session as string,
		paneId: r.paneId as string,
		terminalId: r.terminalId as string,
		env: env as Record<string, string>
	};
}

/**
 * The pane's command: `sh` unsetting what it must not inherit, then exec'ing
 * the harness's argv, passed as positional arguments so none of it is sh source.
 */
export function paneArgv(shBinary: string, spec: LaunchSpec): string[] {
	const unset = PANE_UNSET.filter((name) => !(name in spec.env));
	const families = PANE_UNSET_PREFIXES.map((p) => `${p}*`).join('|');
	const script = [
		`unset ${unset.join(' ')}`,
		`for n in $(env | while IFS== read -r n _; do case "$n" in *[!A-Za-z0-9_]*) ;; ${families}) echo "$n" ;; esac; done); do unset "$n"; done`,
		'exec "$@"'
	].join('\n');
	return [shBinary, '-c', script, 'sh', ...spec.argv];
}

export interface HerdrBackendOptions {
	/** The herdr session name; default `wheelhouse`. */
	session?: string | null;
	/** Where the pane's ids and launch variables are kept (in Wheelhouse's state directory). */
	recordFile: string;
	/** Wheelhouse's environment, already cleaned by sessionEnv. */
	env: NodeJS.ProcessEnv;
	find: (name: string) => string | null;
	run?: Run;
	spawnServer?: SpawnServer;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * The Firstmate session as an agent pane in a named herdr session. Every herdr
 * call names that session, as argument arrays. A message goes in with
 * `pane send-text` as a bracketed paste, so a multi-line message is one
 * message and nothing in it can submit it early.
 */
export class HerdrBackend implements SessionBackend {
	readonly label = 'herdr';
	readonly session: string;
	readonly recordFile: string;
	private env: NodeJS.ProcessEnv;
	private find: (name: string) => string | null;
	private run: Run;
	private spawnServer: SpawnServer;
	private sleep: (ms: number) => Promise<void>;
	/** The record of the pane, while running() last found its terminal live. */
	private live: HerdrRecord | null = null;
	/** Why running() last could not say, for the page. */
	private lastProblem: string | null = null;

	constructor(opts: HerdrBackendOptions) {
		this.session = opts.session || DEFAULT_HERDR_SESSION;
		this.recordFile = opts.recordFile;
		const env = { ...opts.env };
		for (const name of HERDR_AMBIENT) delete env[name];
		this.env = env;
		this.find = opts.find;
		this.run = opts.run ?? runBounded;
		this.spawnServer = opts.spawnServer ?? spawnServer;
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	unavailable(): string | null {
		if (!HERDR_SESSION.test(this.session)) {
			return `The herdr session name ${JSON.stringify(this.session)} is not valid; use letters, digits, '_' or '-'.`;
		}
		if (!this.find('herdr')) {
			return `herdr is not installed or not on PATH. Install herdr ${HERDR_MIN_VERSION} or newer and restart Wheelhouse.`;
		}
		return null;
	}

	problem(): string | null {
		return this.lastProblem;
	}

	/**
	 * Run herdr on Wheelhouse's session only: `--session` goes after the
	 * subcommand's own arguments and before any `--`, so it is always read as
	 * herdr's option and never as part of a command or a message.
	 */
	private herdr(args: string[], extra: Partial<RunOptions> = {}): Promise<RunResult> {
		const herdr = this.find('herdr');
		if (!herdr) return Promise.reject(new Error('herdr is missing'));
		const dash = args.indexOf('--');
		const full =
			dash < 0
				? [...args, '--session', this.session]
				: [...args.slice(0, dash), '--session', this.session, ...args.slice(dash)];
		return this.run(herdr, full, {
			env: this.env,
			timeoutMs: HERDR_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024,
			...extra
		});
	}

	/** herdr's status for the session, or a sentence saying why it cannot be used. */
	private async status(): Promise<HerdrStatus | string> {
		const r = await this.herdr(['status', '--json']);
		const status = r.ok ? parseStatus(r.stdout) : null;
		if (!status) {
			return `herdr could not report its status: ${r.ok ? 'it gave an answer Wheelhouse does not understand' : herdrError(r)}. Wheelhouse needs herdr ${HERDR_MIN_VERSION} or newer.`;
		}
		if (!status.clientVersion || compareVersions(status.clientVersion, HERDR_MIN_VERSION) < 0) {
			return `herdr ${status.clientVersion ?? '(unknown version)'} is older than Wheelhouse supports. Update herdr to ${HERDR_MIN_VERSION} or newer.`;
		}
		if (status.running && status.compatible !== true) {
			return `The herdr server for session "${this.session}" (herdr ${status.serverVersion ?? 'unknown'}, protocol ${String(status.serverProtocol)}) does not match this herdr (${status.clientVersion}, protocol ${String(status.clientProtocol)}). Restart that herdr session yourself; Wheelhouse never restarts it.`;
		}
		return status;
	}

	private async readRecord(): Promise<HerdrRecord | null> {
		try {
			const record = parseRecord(await readFile(this.recordFile, 'utf8'));
			return record && record.session === this.session ? record : null;
		} catch {
			return null;
		}
	}

	private async writeRecord(record: HerdrRecord): Promise<void> {
		const tmp = `${this.recordFile}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
		await rename(tmp, this.recordFile);
	}

	/** The pane to type into: the one running() found live, else the recorded one. */
	private async pane(): Promise<string | null> {
		return (this.live ?? (await this.readRecord()))?.paneId ?? null;
	}

	async running(): Promise<boolean | null> {
		this.live = null;
		this.lastProblem = null;
		if (this.unavailable()) return null;
		const status = await this.status();
		if (typeof status === 'string') {
			this.lastProblem = status;
			return null;
		}
		if (!status.running) return false;
		const record = await this.readRecord();
		if (!record) return false;
		const r = await this.herdr(['pane', 'get', record.paneId]);
		if (!r.ok) {
			if (herdrCode(r) === 'pane_not_found') return false;
			this.lastProblem = `herdr could not report Firstmate's pane: ${herdrError(r)}`;
			return null;
		}
		const pane = obj(obj(json(r.stdout)?.result).pane);
		const terminal = str(pane.terminal_id);
		if (!terminal) {
			this.lastProblem =
				"herdr gave an answer about Firstmate's pane that Wheelhouse does not understand.";
			return null;
		}
		// A pane restored after a herdr restart keeps its id but runs a new terminal (a plain shell).
		if (terminal !== record.terminalId) return false;
		this.live = record;
		return true;
	}

	/** Start the session's herdr server when it is not running, and wait for it to answer. */
	private async serve(cwd: string): Promise<string | null> {
		let status = await this.status();
		if (typeof status === 'string') return status;
		if (status.running) return null;
		try {
			this.spawnServer(this.find('herdr') as string, ['server', '--session', this.session], {
				cwd,
				env: this.env
			});
		} catch (e) {
			return `herdr could not start session "${this.session}": ${(e as Error).message}`;
		}
		for (let waited = 0; waited < SERVER_START_MS; waited += SERVER_POLL_MS) {
			await this.sleep(SERVER_POLL_MS);
			status = await this.status();
			if (typeof status === 'string') return status;
			if (status.running) return null;
		}
		return `herdr session "${this.session}" did not start within ${SERVER_START_MS / 1000} seconds.`;
	}

	async start(spec: LaunchSpec): Promise<BackendResult> {
		this.live = null;
		const sh = this.find('sh');
		if (!sh) return { ok: false, error: 'herdr could not start Firstmate: `sh` is not on PATH.' };
		const served = await this.serve(spec.cwd);
		if (served) return { ok: false, error: served };
		const r = await this.herdr([
			'agent',
			'start',
			`${FIRSTMATE_AGENT}-${randomBytes(4).toString('hex')}`,
			'--cwd',
			spec.cwd,
			...Object.entries(spec.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
			'--no-focus',
			'--',
			...paneArgv(sh, spec)
		]);
		if (!r.ok) return { ok: false, error: `herdr could not start Firstmate: ${herdrError(r)}` };
		const agent = obj(obj(json(r.stdout)?.result).agent);
		const paneId = str(agent.pane_id);
		const terminalId = str(agent.terminal_id);
		if (!paneId || !terminalId) {
			return {
				ok: false,
				error: `herdr started Firstmate but did not say which pane it is in. Close it in herdr session "${this.session}" before starting again.`
			};
		}
		const record: HerdrRecord = {
			schema: RECORD_SCHEMA,
			session: this.session,
			paneId,
			terminalId,
			env: { ...spec.env }
		};
		try {
			await this.writeRecord(record);
		} catch (e) {
			return {
				ok: false,
				error: `herdr started Firstmate in pane ${paneId}, but Wheelhouse could not record it: ${(e as Error).message}`
			};
		}
		this.live = record;
		// A pane no client has attached to is 53×23, too small for Claude Code's menus; this sticks after it returns.
		await this.herdr([
			'terminal',
			'session',
			'control',
			terminalId,
			'--cols',
			'160',
			'--rows',
			'48'
		]);
		return { ok: true };
	}

	async variable(name: string): Promise<string | null> {
		return this.live ? (this.live.env[name] ?? '') : null;
	}

	async screen(): Promise<string | null> {
		const pane = await this.pane();
		if (!pane) return null;
		const r = await this.herdr(['pane', 'read', pane, '--source', 'visible']);
		return r.ok ? r.stdout : null;
	}

	async paste(text: string): Promise<BackendResult> {
		const pane = await this.pane();
		if (!pane) return { ok: false, error: 'herdr could not take the message: no Firstmate pane.' };
		// A bracketed paste: one message however many lines, and a CR in it cannot submit it early.
		let stripped = text;
		while (stripped.includes(PASTE_END)) stripped = stripped.split(PASTE_END).join('');
		const body = `${PASTE_START}${stripped}${PASTE_END}`;
		if (Buffer.byteLength(body) > PASTE_MAX_BYTES) {
			return { ok: false, error: 'herdr could not take the message: it is too long.' };
		}
		const r = await this.herdr(['pane', 'send-text', pane, body]);
		if (!r.ok) return { ok: false, error: `herdr could not take the message: ${herdrError(r)}` };
		return { ok: true };
	}

	async key(key: SessionKey): Promise<BackendResult> {
		const pane = await this.pane();
		if (!pane) return { ok: false, error: 'herdr could not send a key: no Firstmate pane.' };
		const r = await this.herdr(['pane', 'send-keys', pane, HERDR_KEYS[key]]);
		if (!r.ok) return { ok: false, error: `herdr could not send a key: ${herdrError(r)}` };
		return { ok: true };
	}

	attach(): Omit<AttachTarget, 'cwd'> {
		return {
			argv: [this.find('herdr') as string, 'session', 'attach', this.session],
			env: { ...this.env, TERM: 'xterm-256color' }
		};
	}

	attachHint(): string {
		return shellLine(['herdr', 'session', 'attach', this.session]);
	}
}
