import { mkdir, readFile, realpath, writeFile, rename } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { isInside } from '../store/store';
import type { FirstmateSessionView, Picker, ScreenMenu, SignIn, TerminalWait } from '../../types';
import type { LaunchSpec, SessionBackend, SessionKey } from './backend';
import { parseMenu, parsePicker, pickerKeys, type PickerAction } from './picker';
import { atClaudePrompt, readSignIn, terminalExcerpt } from './waiting';
import type { ResolveTarget } from './terminal';
import { claudeStore, registerTrust } from './trust';
import { HARNESS_NAMES, parseHarness, type Harness } from '../../harness';
import { codexScreen } from './codex-screen';
import { piExtensionSource, piScreen } from './pi';
import { GROK_SESSION_VARIABLE, grokArgv, grokScreen, isGrokSessionId } from './grok';
import { ServicePorts } from '../plugins/ports';
import {
	parseOpenCodeConnection,
	createOpenCodeSession,
	selectOpenCodeSession,
	openCodeStatus,
	pendingOpenCodePicker,
	answerOpenCodePicker,
	sendOpenCode,
	interruptOpenCode,
	OpenCodeError,
	type OpenCodeConnection
} from './opencode';
import { sessionEnv, shellLine, TmuxBackend, which, type Run } from './tmux';
import { HerdrBackend } from './herdr';

/**
 * The one Firstmate primary session Wheelhouse shows and talks to.
 *
 * `wheelhouse open` starts it, when no Firstmate session is running, as an
 * interactive harness in Firstmate's checkout. Claude Code defaults to
 * `--dangerously-skip-permissions`; other harnesses keep their own settings, inside
 * its session backend (backend.ts): by default a detached tmux session named
 * `wh-firstmate` on tmux's default server (tmux.ts), or, experimentally,
 * a pane in a named herdr session (herdr.ts). The session belongs
 * to the backend, not to Wheelhouse, so it outlives browser tabs and Wheelhouse
 * restarts, and Firstmate's own hooks and supervision run in it exactly as in a
 * terminal. Wheelhouse never stops it.
 *
 * Firstmate's session lock decides whether a session is already running
 * (`fm-inbox.sh ready`): when another session holds it, Wheelhouse never starts
 * a second one. It shows that session's transcript read-only instead, since it
 * cannot type into a terminal it does not own (the page sends messages to
 * Firstmate's inbox for it).
 *
 * Input reaches the session the way a captain's typing would: text as one paste
 * (so a multi-line message is one message) followed by Enter; Escape to
 * interrupt; and, for a menu Claude Code waits on (its question picker, a
 * permission prompt), the digits and arrows the menu expects, worked out from
 * the menu on screen (picker.ts). Nothing is typed while
 * a menu is open, since its Enter would choose for the captain; one the chat cannot
 * drive (most of Claude Code's own, such as /mcp) is closed with Escape on request.
 * The agent's sign-in screen (waiting.ts) takes the code the captain pastes
 * back, typed into its own field; any other screen that is neither the prompt
 * nor something the chat can read is reported as waiting in the terminal, and
 * nothing is typed into it. The backend touches only its own session, never any other.
 *
 * Wheelhouse adds one SessionStart hook of its own (through `--settings`,
 * merged with Firstmate's hooks, never replacing them) that records the hook's
 * input - including `transcript_path` - in Wheelhouse's state directory, so the
 * chat follows the live transcript across /clear, /compact and resume.
 */

/** Largest message the composer may send (bytes of UTF-8). */
export const INPUT_MAX_BYTES = 64 * 1024;
/** Where the SessionStart hook leaves its input, under Wheelhouse's state directory. */
export const HOOK_RECORD = path.join('firstmate', 'session-start.json');
/** Where the herdr backend records its pane, under Wheelhouse's state directory. */
export const HERDR_RECORD = path.join('firstmate', 'herdr-session.json');

/** Claude Code needs a moment to take a bracketed paste before Enter submits it. */
const PASTE_SETTLE_MS = 400;
const KEY_GAP_MS = 120;
/** Longer than the second in which Grok takes another Ctrl+C as a request to quit. */
const GROK_STOP_HOLD_MS = 1200;
/** Escapes it may take to back out of a menu's nested screens (/mcp, then a server, then its tools). */
const DISMISS_MAX = 5;
/** Time for Claude Code to redraw after an Escape, before the screen is read again. */
const MENU_SETTLE_MS = 400;
/** Reads of the screen after an Escape before a menu that has not redrawn counts as stuck. */
const MENU_REDRAW_WAITS = 5;
/** The menu at the bottom of a screen, from Claude Code's overline down, so a spinner above it is not a redraw. */
const menuPart = (text: string | null) => text?.slice(Math.max(0, text.lastIndexOf('▔'))) ?? null;
const MENU_OPEN =
	'A Claude Code menu is open in Firstmate’s session, so nothing was typed. Answer or close it, then send again.';
const IN_TERMINAL =
	'Firstmate is waiting for you in its terminal, so nothing was typed. Open the terminal and answer it there, then send again.';
/**
 * How long a Claude Code screen that is neither its prompt nor anything the chat
 * can read must stay before it counts as waiting in the terminal, so a redraw
 * caught halfway never shows as one.
 */
const TERMINAL_SETTLE_MS = 1500;
/** A sign-in code (or the address Pi also takes) is one line of at most this many bytes. */
const SIGN_IN_MAX_BYTES = 4096;

/** What `fm-inbox.sh ready` says about the session lock: held by a live session, free, or unknown. */
export type LockState = 'held' | 'free' | 'unknown';

export interface FirstmateSessionOptions {
	harness?: Harness;
	/** Firstmate's checkout: the session's working directory. */
	firstmateDir: string;
	/** Firstmate's operational home (FM_HOME when it differs from the checkout). */
	homeDir: string;
	/** Wheelhouse's state directory (outside the Firstmate home). */
	stateDir: string;
	/** Firstmate's session lock, read through its own script. */
	lock: () => Promise<LockState>;
	/** Start with --dangerously-skip-permissions (the default). */
	skipPermissions?: boolean;
	/** Pi's provider, as the setup wizard chose it (e.g. `openai-codex`), read at each launch; null: Pi's own default. */
	piProvider?: () => string | null;
	/** What runs the session; default: the one `sessionBackend` names. */
	backend?: SessionBackend;
	/** Which backend to build when `backend` is not given: tmux (the default) or herdr (experimental). */
	sessionBackend?: 'tmux' | 'herdr';
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET, for the tmux backend. */
	tmuxSocket?: string | null;
	/** The herdr session name, for the herdr backend; default `wheelhouse`. */
	herdrSession?: string | null;
	/** Why the session backend setting cannot be used (sessions/choice.ts): no session starts or is talked to. */
	backendProblem?: string | null;
	env?: NodeJS.ProcessEnv;
	find?: (name: string) => string | null;
	/** How the built backend runs tmux or herdr. */
	run?: Run;
	/** Claude Code's config store for workspace trust; null skips it. */
	trustStore?: string | null;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

/**
 * A menu on the session's screen (and its choices, when numbered), whether Claude
 * Code is busy, and, when the harness waits on the captain some other way, its
 * sign-in or anything else it waits on in its terminal.
 */
type OnScreen = {
	picker: Picker | null;
	menu: ScreenMenu | null;
	busy: boolean;
	signIn?: SignIn | null;
	terminal?: TerminalWait | null;
};

export type SendResult =
	{ ok: true } | { ok: false; status: 400 | 409 | 413 | 500 | 503; error: string };

/** The `--settings` JSON: Wheelhouse's SessionStart hook, and no bypass-mode prompt when skipping. */
export function sessionSettings(hookFile: string, skipPermissions: boolean): string {
	const tmp = `${hookFile}.tmp`;
	const command = `cat > ${shellLine([tmp])} && mv -f ${shellLine([tmp])} ${shellLine([hookFile])}`;
	const settings: Record<string, unknown> = {
		hooks: { SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] }
	};
	if (skipPermissions) settings.skipDangerousModePermissionPrompt = true;
	return JSON.stringify(settings);
}

/** argv for the Firstmate session's `claude`. */
export function claudeArgv(claude: string, hookFile: string, skipPermissions: boolean): string[] {
	const argv = [claude];
	if (skipPermissions) argv.push('--dangerously-skip-permissions');
	argv.push('--settings', sessionSettings(hookFile, skipPermissions));
	return argv;
}

/** CLI-layer hooks add our exact session recorder while preserving Firstmate's project hooks. */
export function codexArgv(binary: string): string[] {
	const script = `const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 65536) process.exit(1); });
process.stdin.on('end', () => {
 const record = JSON.parse(input);
 const file = process.env.WH_SESSION_RECORD;
 if (!file || !process.env.WH_SESSION_NONCE) process.exit(1);
 fs.writeFileSync(file + '.tmp', JSON.stringify({...record, wheelhouse_nonce: process.env.WH_SESSION_NONCE}), {mode: 0o600});
 fs.renameSync(file + '.tmp', file);
});`;
	const command = shellLine([process.execPath, '-e', script]);
	return [
		binary,
		'-c',
		`hooks.SessionStart=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=10}]}]`
	];
}

export type LaunchOptions = {
	binary: string;
	firstmateDir: string;
	hookFile: string;
	fmHome: string | null;
} & (
	| { harness: 'claude'; skipPermissions: boolean }
	| { harness: 'codex'; sessionNonce: string }
	| { harness: 'pi'; sessionNonce: string; extensionFile: string; provider?: string | null }
	| { harness: 'opencode'; connectionFile: string }
	| { harness: 'grok'; sessionId: string }
);

/** How to start one detached interactive primary, with only its own protocol options. */
export function launchSpec(options: LaunchOptions): LaunchSpec {
	const { binary, firstmateDir, hookFile, fmHome } = options;
	let command: string[];
	const environment = [`WHEELHOUSE_HARNESS=${options.harness}`];
	switch (options.harness) {
		case 'claude':
			command = claudeArgv(binary, hookFile, options.skipPermissions);
			break;
		case 'codex':
			environment.push(`WH_SESSION_RECORD=${hookFile}`, `WH_SESSION_NONCE=${options.sessionNonce}`);
			command = codexArgv(binary);
			break;
		case 'pi':
			environment.push(`WH_SESSION_RECORD=${hookFile}`, `WH_SESSION_NONCE=${options.sessionNonce}`);
			command = [
				binary,
				'--extension',
				options.extensionFile,
				...(options.provider ? ['--provider', options.provider] : [])
			];
			break;
		case 'opencode':
			environment.push(`WH_OPENCODE_CONNECTION=${options.connectionFile}`);
			// Read credentials from the private file, so they never appear in the session's process arguments.
			command = [
				process.execPath,
				'-e',
				`const fs = require('node:fs');
const {spawn} = require('node:child_process');
const connection = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const child = spawn(process.argv[2], ['--hostname', '127.0.0.1', '--port', new URL(connection.url).port], {
 stdio: 'inherit', env: {...process.env, OPENCODE_SERVER_USERNAME: connection.username, OPENCODE_SERVER_PASSWORD: connection.password}
});
child.on('error', () => { console.error('OpenCode could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; })`,
				options.connectionFile,
				binary
			];
			break;
		case 'grok':
			environment.push(`${GROK_SESSION_VARIABLE}=${options.sessionId}`);
			command = grokArgv(binary, options.sessionId);
			break;
	}
	if (fmHome) environment.push(`FM_HOME=${fmHome}`);
	const env: Record<string, string> = {};
	for (const value of environment) {
		const at = value.indexOf('=');
		env[value.slice(0, at)] = value.slice(at + 1);
	}
	return { cwd: firstmateDir, argv: command, env };
}

export class FirstmateSession {
	readonly harness: Harness;
	private activeHarness: Harness;
	private nativeRecorder = false;
	private nativeNonce: string | null = null;
	private openCode: OpenCodeConnection | null = null;
	get openCodeConnection(): OpenCodeConnection | null {
		return this.openCode;
	}
	get sessionNonce(): string | null {
		return this.nativeNonce;
	}
	private grokSession: string | null = null;
	private grokStopHold: Promise<void> = Promise.resolve();
	/** The conversation id a running Grok session was started with, or null. */
	get grokSessionId(): string | null {
		return this.grokSession;
	}
	readonly firstmateDir: string;
	readonly homeDir: string;
	readonly hookFile: string;
	readonly skipPermissions: boolean;
	readonly backend: SessionBackend;
	private stateDir: string;
	private lock: () => Promise<LockState>;
	private env: NodeJS.ProcessEnv;
	private find: (name: string) => string | null;
	private trustStore: string | null;
	private piProvider: () => string | null;
	/** Why the backend choice could not be used (the runtime fell back to tmux), or null. */
	readonly backendProblem: string | null;
	private sleep: (ms: number) => Promise<void>;
	private now: () => number;
	/** Since when Claude Code's screen has been one the chat cannot read, or null. */
	private unreadSince: number | null = null;
	private starting: Promise<FirstmateSessionView> | null = null;
	/** One input at a time, in order, so two messages never interleave in the paste buffer. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(opts: FirstmateSessionOptions) {
		this.harness = opts.harness ?? parseHarness((opts.env ?? process.env).WHEELHOUSE_HARNESS);
		this.activeHarness = this.harness;
		this.firstmateDir = path.resolve(opts.firstmateDir);
		this.homeDir = path.resolve(opts.homeDir);
		this.stateDir = path.resolve(opts.stateDir);
		this.hookFile = path.join(this.stateDir, HOOK_RECORD);
		this.lock = opts.lock;
		this.skipPermissions = this.harness === 'claude' && (opts.skipPermissions ?? true);
		this.env = sessionEnv(opts.env ?? process.env);
		this.find = opts.find ?? ((name) => which(name, this.env.PATH));
		this.backend =
			opts.backend ??
			(opts.sessionBackend === 'herdr'
				? new HerdrBackend({
						session: opts.herdrSession,
						recordFile: path.join(this.stateDir, HERDR_RECORD),
						env: this.env,
						find: this.find,
						run: opts.run,
						sleep: opts.sleep
					})
				: new TmuxBackend({
						socket: opts.tmuxSocket,
						env: this.env,
						find: this.find,
						run: opts.run
					}));
		this.trustStore = opts.trustStore === undefined ? claudeStore(this.env) : opts.trustStore;
		this.backendProblem = opts.backendProblem ?? null;
		this.piProvider = opts.piProvider ?? (() => null);
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
		this.now = opts.now ?? Date.now;
	}

	/** Why Wheelhouse cannot start or talk to a session here, or null. */
	unavailable(requireHarness = true): string | null {
		if (this.backendProblem) return this.backendProblem;
		const backend = this.backend.unavailable();
		if (backend) return backend;
		if (requireHarness && !this.find(this.harness)) {
			return `${HARNESS_NAMES[this.harness]} (\`${this.harness}\`) is not installed or not on PATH. Install it and restart Wheelhouse.`;
		}
		if (isInside(this.stateDir, this.homeDir)) {
			return `The Wheelhouse state directory ${this.stateDir} is inside the Firstmate home; choose one outside it.`;
		}
		return null;
	}

	/** The backend could not say whether the session runs. */
	private get cannotAsk(): string {
		return (
			this.backend.problem?.() ??
			`Wheelhouse could not ask ${this.backend.label} about the session.`
		);
	}

	/**
	 * Whether the backend's Firstmate session is running; null when the backend
	 * cannot say. A running session's harness, and the recorder or connection
	 * it was started with, are read back from the variables it was launched with.
	 */
	async running(): Promise<boolean | null> {
		const running = await this.backend.running();
		if (running === false) this.activeHarness = this.harness;
		if (!running) return running;
		const saved = await this.backend.variable('WHEELHOUSE_HARNESS');
		if (saved === null) return null;
		try {
			// Older Wheelhouse sessions have no harness marker and always ran Claude.
			this.activeHarness = parseHarness(saved || 'claude');
		} catch {
			return null;
		}
		if (this.activeHarness === 'codex' || this.activeHarness === 'pi') {
			this.nativeRecorder = (await this.backend.variable('WH_SESSION_RECORD')) === this.hookFile;
			const value = (await this.backend.variable('WH_SESSION_NONCE')) ?? '';
			this.nativeNonce = /^[0-9a-f-]{36}$/.test(value) ? value : null;
			this.nativeRecorder &&= this.nativeNonce !== null;
		}
		if (this.activeHarness === 'grok') {
			const value = await this.backend.variable(GROK_SESSION_VARIABLE);
			this.grokSession = isGrokSessionId(value) ? value : null;
		}
		if (this.activeHarness === 'opencode') {
			this.openCode = null;
			const file = (await this.backend.variable('WH_OPENCODE_CONNECTION')) ?? '';
			try {
				if (
					!/^opencode-[0-9a-f-]{36}\.json$/.test(path.basename(file)) ||
					(await realpath(path.dirname(file))) !== (await realpath(path.dirname(this.hookFile)))
				)
					throw new Error('Wrong state directory');
				const connection = parseOpenCodeConnection(JSON.parse(await readFile(file, 'utf8')));
				if ((await realpath(connection.directory)) !== (await realpath(this.firstmateDir)))
					throw new Error('Wrong Firstmate checkout');
				this.openCode = connection;
			} catch {
				/* An old or differently scoped session stays terminal-accessible only. */
			}
		}
		return true;
	}

	private view(
		state: FirstmateSessionView['state'],
		reason: string | null,
		screen: OnScreen = { picker: null, menu: null, busy: false }
	): FirstmateSessionView {
		const needsRestart =
			state === 'ours' &&
			(this.activeHarness === 'codex' || this.activeHarness === 'pi'
				? !this.nativeRecorder
				: this.activeHarness === 'grok'
					? !this.grokSession
					: this.activeHarness === 'opencode' && !this.openCode);
		return {
			schema: 'wheelhouse-firstmate-session.v1',
			harness: this.activeHarness,
			state,
			reason: needsRestart
				? `This ${this.activeHarness} session predates chat integration or belongs to another Wheelhouse state directory. Exit it in the terminal, then start Firstmate here again.`
				: reason,
			canSend: state === 'ours' && !needsRestart,
			attach: state === 'ours' ? this.backend.attachHint() : null,
			skipPermissions: this.activeHarness === 'claude' && this.skipPermissions,
			...screen
		};
	}

	/** Wheelhouse's session's screen as text, or null. */
	private screen(): Promise<string | null> {
		return this.backend.screen();
	}

	/** The menu Claude Code is waiting on in Wheelhouse's session, read off its screen, or null. */
	async picker(): Promise<Picker | null> {
		if (this.activeHarness === 'opencode')
			return this.openCode ? pendingOpenCodePicker(this.openCode) : null;
		const text = await this.screen();
		if (this.activeHarness === 'codex') {
			const shown = codexScreen(text);
			return shown.kind === 'picker' ? shown.picker : null;
		}
		if (this.activeHarness !== 'claude') return null;
		return text === null ? null : parsePicker(text);
	}

	/**
	 * What the screen says: a menu Claude Code waits on (as choices when it has
	 * numbered ones), and whether it is busy (it shows "esc to interrupt" while
	 * working, before anything reaches the transcript). A screen it cannot read
	 * counts as waiting in the terminal once it has stayed, or at once when
	 * `settled` (before typing, where a screen caught halfway must not be typed into).
	 */
	private async onScreen(settled = false): Promise<OnScreen> {
		if (this.activeHarness === 'opencode') {
			try {
				if (this.openCode) return await openCodeStatus(this.openCode);
			} catch {
				/* The optional terminal remains available while the API recovers. */
			}
			return {
				picker: null,
				menu: {
					title: 'OpenCode’s session API is not ready. Retry shortly or open its terminal.',
					canDismiss: false
				},
				busy: false
			};
		}
		if (
			this.activeHarness === 'codex' ||
			this.activeHarness === 'pi' ||
			this.activeHarness === 'grok'
		) {
			const text = await this.screen().catch(() => null);
			const signIn = readSignIn(text)?.signIn ?? null;
			if (signIn) return { picker: null, menu: null, busy: false, signIn };
			const shown =
				this.activeHarness === 'codex'
					? codexScreen(text)
					: this.activeHarness === 'pi'
						? piScreen(text)
						: grokScreen(text);
			return {
				picker: shown.kind === 'picker' ? shown.picker : null,
				menu: shown.kind === 'blocked' ? { title: shown.title, canDismiss: false } : null,
				busy: shown.kind === 'prompt' && shown.busy
			};
		}
		if (this.activeHarness !== 'claude') return { picker: null, menu: null, busy: false };
		const text = await this.screen().catch(() => null);
		if (text === null) return { picker: null, menu: null, busy: false };
		const signIn = readSignIn(text)?.signIn ?? null;
		if (signIn) {
			this.unreadSince = null;
			return { picker: null, menu: null, busy: false, signIn, terminal: null };
		}
		const shown: OnScreen = {
			picker: parsePicker(text),
			menu: parseMenu(text),
			busy: /\besc to interrupt\b/i.test(text),
			signIn: null,
			terminal: null
		};
		// Neither its prompt nor a menu: it waits on something only the terminal shows.
		if (shown.picker || shown.menu || !text.trim() || atClaudePrompt(text)) {
			this.unreadSince = null;
		} else {
			const now = this.now();
			this.unreadSince ??= now;
			if (now - this.unreadSince >= TERMINAL_SETTLE_MS || settled)
				shown.terminal = { excerpt: terminalExcerpt(text) };
		}
		return shown;
	}

	/** Where the Firstmate session stands, as the page shows it. */
	async status(): Promise<FirstmateSessionView> {
		const reason = this.unavailable();
		const ours = this.unavailable(false) ? null : await this.running();
		if (ours) return this.view('ours', null, await this.onScreen());
		const lock = await this.lock();
		if (lock === 'held') {
			return this.view(
				'external',
				'Firstmate is running in another terminal, so Wheelhouse shows its conversation read-only and sends your messages to its inbox. To talk to it here directly, close it there and start it from Wheelhouse.'
			);
		}
		if (reason) return this.view('unavailable', reason);
		if (ours === null) return this.view('unavailable', this.cannotAsk);
		if (this.starting) return this.view('starting', null);
		return this.view('none', 'No Firstmate session is running.');
	}

	/**
	 * Start the Firstmate session unless one is already running here or holds
	 * Firstmate's session lock elsewhere. Safe to call repeatedly.
	 */
	ensure(): Promise<FirstmateSessionView> {
		this.starting ??= this.start().finally(() => (this.starting = null));
		return this.starting;
	}

	private async start(): Promise<FirstmateSessionView> {
		const boundary = this.unavailable(false);
		if (boundary) return this.view('unavailable', boundary);
		const ours = await this.running();
		if (ours) return this.view('ours', null);
		const reason = this.unavailable();
		if (reason) return this.view('unavailable', reason);
		if (ours === null) return this.view('unavailable', this.cannotAsk);
		const lock = await this.lock();
		if (lock === 'held') return this.status();
		if (lock === 'unknown') {
			return this.view(
				'unavailable',
				"Wheelhouse could not read Firstmate's session lock, so it did not start a session (it never risks a second one)."
			);
		}
		const binary = this.find(this.harness);
		if (!binary) return this.view('unavailable', `${this.harness} is no longer on PATH.`);
		try {
			await mkdir(path.dirname(this.hookFile), { recursive: true });
		} catch (e) {
			return this.view(
				'unavailable',
				`Wheelhouse could not create ${path.dirname(this.hookFile)}: ${(e as Error).message}`
			);
		}
		// Firstmate's checkout is normally trusted already; this only skips the dialog when it is not.
		if (this.harness === 'claude' && this.trustStore)
			registerTrust(this.trustStore, this.firstmateDir);
		const fmHome = this.homeDir !== this.firstmateDir ? this.homeDir : null;
		const nonce = randomUUID();
		const common = { binary, firstmateDir: this.firstmateDir, hookFile: this.hookFile, fmHome };
		let launch: LaunchOptions;
		try {
			switch (this.harness) {
				case 'claude':
					launch = { ...common, harness: 'claude', skipPermissions: this.skipPermissions };
					break;
				case 'codex':
					launch = { ...common, harness: 'codex', sessionNonce: nonce };
					break;
				case 'pi': {
					const extensionFile = path.join(path.dirname(this.hookFile), 'pi-extension.mjs');
					await writeFile(`${extensionFile}.${nonce}.tmp`, piExtensionSource(), { mode: 0o600 });
					await rename(`${extensionFile}.${nonce}.tmp`, extensionFile);
					launch = {
						...common,
						harness: 'pi',
						sessionNonce: nonce,
						extensionFile,
						provider: this.piProvider()
					};
					break;
				}
				case 'opencode': {
					const port = await new ServicePorts(path.join(this.stateDir, 'primary-ports.json')).port(
						'opencode',
						null,
						4096,
						[],
						[]
					);
					const connection = parseOpenCodeConnection({
						url: `http://127.0.0.1:${port}`,
						directory: this.firstmateDir,
						sessionId: `ses_${nonce.replace(/-/g, '')}`,
						username: 'wheelhouse',
						password: randomBytes(32).toString('hex')
					});
					const connectionFile = path.join(path.dirname(this.hookFile), `opencode-${nonce}.json`);
					await writeFile(connectionFile, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
					this.openCode = connection;
					launch = { ...common, harness: 'opencode', connectionFile };
					break;
				}
				case 'grok':
					launch = { ...common, harness: 'grok', sessionId: nonce };
					break;
			}
		} catch (error) {
			return this.view(
				'unavailable',
				`Could not prepare ${this.harness}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
		const r = await this.backend.start(launchSpec(launch));
		if (!r.ok) return this.view('unavailable', r.error);
		this.activeHarness = this.harness;
		this.nativeRecorder = this.harness === 'codex' || this.harness === 'pi';
		this.nativeNonce = this.nativeRecorder ? nonce : null;
		this.grokSession = this.harness === 'grok' ? nonce : null;
		if (this.openCode && this.harness === 'opencode') {
			const until = Date.now() + 20_000;
			let failure = 'The native TUI is not ready.';
			while (Date.now() < until) {
				try {
					if (!(await this.screen())?.includes('┃'))
						throw new Error('The native TUI is not ready.');
					await createOpenCodeSession(this.openCode);
					await selectOpenCodeSession(this.openCode);
					return this.view('ours', null);
				} catch (error) {
					failure = error instanceof Error ? error.message : String(error);
				}
				await this.sleep(250);
			}
			return this.view(
				'ours',
				`OpenCode started but its chat could not be connected: ${failure} Open its terminal, finish setup, then restart the primary.`
			);
		}
		return this.view('ours', null);
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work, work);
		this.queue = next.catch(() => {});
		return next;
	}

	private async ours(): Promise<SendResult | null> {
		const reason = this.unavailable(false);
		if (reason) return { ok: false, status: 503, error: reason };
		const running = await this.running();
		if (running === null) return { ok: false, status: 503, error: this.cannotAsk };
		if (!running) {
			return {
				ok: false,
				status: 409,
				error: 'Firstmate is not running in Wheelhouse, so there is nothing here to type into.'
			};
		}
		return null;
	}

	private async keys(keys: SessionKey[]): Promise<SendResult> {
		for (const key of keys) {
			const r = await this.backend.key(key);
			if (!r.ok) return { ok: false, status: 500, error: r.error };
			await this.sleep(KEY_GAP_MS);
		}
		return { ok: true };
	}

	/** Type a message into the session and submit it. */
	send(text: string): Promise<SendResult> {
		return this.serial(async () => {
			const body = text.replace(/\r\n?/g, '\n').trim();
			if (!body) return { ok: false, status: 400, error: 'There is nothing to send.' };
			if (body.includes('\0'))
				return { ok: false, status: 400, error: 'The message is not valid text.' };
			if (Buffer.byteLength(body) > INPUT_MAX_BYTES) {
				return {
					ok: false,
					status: 413,
					error: `A message is limited to ${INPUT_MAX_BYTES / 1024} KiB.`
				};
			}
			const refused = await this.ours();
			if (refused) return refused;
			if ((this.activeHarness === 'codex' || this.activeHarness === 'pi') && !this.nativeRecorder)
				return {
					ok: false,
					status: 409,
					error: `Restart the ${this.activeHarness} session from Wheelhouse to enable its chat recorder.`
				};
			if (this.activeHarness === 'grok' && !this.grokSession)
				return {
					ok: false,
					status: 409,
					error: 'Restart the grok session from Wheelhouse to enable its chat.'
				};
			if (this.activeHarness === 'opencode')
				return this.openCodeAction((connection) => sendOpenCode(connection, body));
			// Typing is refused at once, without waiting for the screen to settle.
			const shown = await this.onScreen(true);
			if (shown.picker || shown.menu)
				return {
					ok: false,
					status: 409,
					error:
						this.activeHarness !== 'claude'
							? `${this.activeHarness} is waiting for attention. Answer the choice or open its terminal before sending.`
							: MENU_OPEN
				};
			if (shown.signIn)
				return {
					ok: false,
					status: 409,
					error: `${HARNESS_NAMES[this.activeHarness]} is waiting for you to sign in, so nothing was typed. Sign in with the card above, then send again.`
				};
			if (shown.terminal) return { ok: false, status: 409, error: IN_TERMINAL };
			const paste = await this.backend.paste(body);
			if (!paste.ok) return { ok: false, status: 500, error: paste.error };
			await this.sleep(PASTE_SETTLE_MS);
			return this.keys(['Enter']);
		});
	}

	/**
	 * Press Escape: Claude Code stops what it is doing. Grok cancels a turn with
	 * Ctrl+C (to Escape it only answers "Press Ctrl+c to cancel the turn"), pressed
	 * only while its screen shows a turn it can cancel, so the key reaches nothing else,
	 * and never within GROK_STOP_HOLD_MS of the last press: a second Ctrl+C that soon quits Grok.
	 */
	interrupt(): Promise<SendResult> {
		return this.serial(async () => {
			const refused = await this.ours();
			if (refused) return refused;
			if (this.activeHarness === 'grok') {
				await this.grokStopHold;
				const shown = grokScreen(await this.screen().catch(() => null));
				if (shown.kind !== 'prompt')
					return { ok: false, status: 409, error: 'Use Grok’s terminal to stop it.' };
				if (!shown.busy) return { ok: true };
				const pressed = await this.keys(['C-c']);
				this.grokStopHold = this.sleep(GROK_STOP_HOLD_MS);
				return pressed;
			}
			return this.activeHarness === 'opencode'
				? this.openCodeAction(interruptOpenCode)
				: this.keys(['Escape']);
		});
	}

	private async openCodeAction(
		action: (connection: OpenCodeConnection) => Promise<void>
	): Promise<SendResult> {
		if (!this.openCode)
			return {
				ok: false,
				status: 409,
				error: 'Restart the OpenCode primary from Wheelhouse to enable chat.'
			};
		try {
			await action(this.openCode);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				status: error instanceof OpenCodeError ? error.status : 503,
				error: error instanceof Error ? error.message : 'OpenCode is unavailable.'
			};
		}
	}

	/**
	 * Choose in the menu Claude Code is waiting on. `signature` names the menu
	 * the page showed; if the screen now shows another (or none), nothing is
	 * pressed. The keys come from the menu on screen, never from the page.
	 */
	pick(signature: string, action: PickerAction): Promise<SendResult> {
		return this.serial(async () => {
			const refused = await this.ours();
			if (refused) return refused;
			if (this.activeHarness === 'opencode')
				return this.openCodeAction((connection) =>
					answerOpenCodePicker(connection, signature, action)
				);
			const now = await this.picker().catch(() => null);
			if (!now || now.signature !== signature) {
				return {
					ok: false,
					status: 409,
					error: 'That choice is no longer on Firstmate’s screen.'
				};
			}
			const keys = pickerKeys(now, action);
			if (!keys) return { ok: false, status: 400, error: 'That is not one of the choices.' };
			return this.keys(keys);
		});
	}

	/**
	 * Type the code the captain brought back from the sign-in page into the
	 * harness's sign-in field, and submit it. `signature` names the sign-in the
	 * page showed; if the screen now shows another (or none), or its field
	 * already holds something, nothing is typed.
	 */
	signIn(signature: string, code: string): Promise<SendResult> {
		return this.serial(async () => {
			const body = code.trim();
			if (!body || /\p{Cc}/u.test(body) || Buffer.byteLength(body) > SIGN_IN_MAX_BYTES)
				return { ok: false, status: 400, error: 'Paste the code the sign-in page gave you.' };
			const refused = await this.ours();
			if (refused) return refused;
			if (this.activeHarness === 'opencode')
				return { ok: false, status: 409, error: 'Sign in to OpenCode in its terminal.' };
			const now = readSignIn(await this.screen().catch(() => null));
			if (!now || now.signIn.signature !== signature || !now.signIn.paste)
				return {
					ok: false,
					status: 409,
					error: 'That sign-in is no longer on Firstmate’s screen.'
				};
			if (now.typed)
				return {
					ok: false,
					status: 409,
					error:
						'Something is already typed into the sign-in field. Clear it in Firstmate’s terminal, then try again.'
				};
			const paste = await this.backend.paste(body);
			if (!paste.ok) return { ok: false, status: 500, error: paste.error };
			await this.sleep(PASTE_SETTLE_MS);
			return this.keys(['Enter']);
		});
	}

	/**
	 * Close the menu one of Claude Code's commands opened (such as /mcp):
	 * Escape, as often as it takes to back out of its nested screens. After each
	 * press the screen is read until the menu has redrawn, and only another menu
	 * gets another press, so Escape never reaches the prompt, where it would stop
	 * Firstmate's work or (pressed twice) open the rewind menu.
	 * Firstmate's own question or permission prompt, which has no heading of
	 * Claude Code's, is the captain's to answer and is never closed.
	 */
	dismiss(): Promise<SendResult> {
		return this.serial(async () => {
			const refused = await this.ours();
			if (refused) return refused;
			if (this.activeHarness !== 'claude')
				return {
					ok: false,
					status: 409,
					error: 'Use the browser terminal to close this harness’s menus.'
				};
			let text = await this.screen().catch(() => null);
			for (let i = 0; i < DISMISS_MAX; i++) {
				const menu = text === null ? null : parseMenu(text);
				if (!menu) return { ok: true };
				if (!menu.title && parsePicker(text as string)) {
					if (i > 0) return { ok: true };
					return {
						ok: false,
						status: 409,
						error: 'Firstmate is asking you something now; answer it in the chat.'
					};
				}
				const r = await this.keys(['Escape']);
				if (!r.ok) return r;
				const before = menuPart(text);
				for (let w = 0; w < MENU_REDRAW_WAITS && menuPart(text) === before; w++) {
					await this.sleep(MENU_SETTLE_MS);
					text = await this.screen().catch(() => null);
				}
				if (menuPart(text) === before) break;
			}
			return {
				ok: false,
				status: 409,
				error: 'The menu is still open after pressing Escape; close it in Firstmate’s terminal.'
			};
		});
	}

	/** What the terminal drawer may attach to: only Wheelhouse's own running session, through its backend. */
	terminal: ResolveTarget = async () => {
		const refused = await this.ours();
		if (refused && !refused.ok) {
			return { ok: false, status: refused.status === 409 ? 409 : 503, error: refused.error };
		}
		return { ok: true, target: { ...this.backend.attach(), cwd: this.firstmateDir } };
	};
}
