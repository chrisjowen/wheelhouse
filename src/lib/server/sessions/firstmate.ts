import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '../store/store';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import type { FirstmateSessionView, Picker, ScreenMenu } from '../../types';
import { parseMenu, parsePicker, pickerKeys, type PickerAction } from './picker';
import type { AttachTarget, ResolveTarget } from './terminal';
import { claudeStore, registerTrust } from './trust';
import {
	DEFAULT_TMUX_SOCKET,
	NO_SERVER,
	sessionEnv,
	shellLine,
	TMUX_SOCKET,
	which,
	type Run
} from './tmux';

/**
 * The one Firstmate primary session Wheelhouse shows and talks to.
 *
 * `wheelhouse open` starts it, when no Firstmate session is running, as an
 * ordinary interactive `claude` in Firstmate's checkout - with
 * `--dangerously-skip-permissions` unless the captain turned that off - inside
 * a detached tmux session named `wh-firstmate` on Wheelhouse's own tmux server.
 * The session belongs to tmux, not to Wheelhouse, so it outlives browser tabs
 * and Wheelhouse restarts, and Firstmate's own hooks and supervision run in it
 * exactly as in a terminal. Wheelhouse never stops it.
 *
 * Firstmate's session lock decides whether a session is already running
 * (`fm-inbox.sh ready`): when another session holds it, Wheelhouse never starts
 * a second one. It shows that session's transcript read-only instead, since it
 * cannot type into a terminal it does not own (the page sends messages to
 * Firstmate's inbox for it).
 *
 * Input reaches the session the way a captain's typing would: text through a
 * tmux paste buffer (bracketed paste, so a multi-line message is one message)
 * followed by Enter; Escape to interrupt; and, for a menu Claude Code waits on
 * (its question picker, a permission prompt), the digits and arrows the menu
 * expects, worked out from the menu on screen (picker.ts). Nothing is typed while
 * a menu is open, since its Enter would choose for the captain; one the chat cannot
 * drive (most of Claude Code's own, such as /mcp) is closed with Escape on request.
 * Every tmux call goes to Wheelhouse's own server and the exact session name, as
 * argument arrays.
 *
 * Wheelhouse adds one SessionStart hook of its own (through `--settings`,
 * merged with Firstmate's hooks, never replacing them) that records the hook's
 * input - including `transcript_path` - in Wheelhouse's state directory, so the
 * chat follows the live transcript across /clear, /compact and resume.
 */

export const FIRSTMATE_TMUX = 'wh-firstmate';
/** Largest message the composer may send (bytes of UTF-8). */
export const INPUT_MAX_BYTES = 64 * 1024;
/** Where the SessionStart hook leaves its input, under Wheelhouse's state directory. */
export const HOOK_RECORD = path.join('firstmate', 'session-start.json');

const TMUX_TIMEOUT_MS = 10_000;
const BUFFER = 'wh-firstmate-input';
/** Claude Code needs a moment to take a bracketed paste before Enter submits it. */
const PASTE_SETTLE_MS = 400;
const KEY_GAP_MS = 120;
/** Escapes it may take to back out of a menu's nested screens (/mcp, then a server, then its tools). */
const DISMISS_MAX = 5;
/** Time for Claude Code to redraw after an Escape, before the screen is read again. */
const MENU_SETTLE_MS = 400;
const MENU_OPEN =
	'A Claude Code menu is open in Firstmate’s session, so nothing was typed. Answer or close it, then send again.';

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

/** What `fm-inbox.sh ready` says about the session lock: held by a live session, free, or unknown. */
export type LockState = 'held' | 'free' | 'unknown';

export interface FirstmateSessionOptions {
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
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET. */
	tmuxSocket?: string | null;
	env?: NodeJS.ProcessEnv;
	find?: (name: string) => string | null;
	run?: Run;
	/** Claude Code's config store for workspace trust; null skips it. */
	trustStore?: string | null;
	sleep?: (ms: number) => Promise<void>;
}

/** A menu on the session's screen (and its choices, when numbered), and whether Claude Code is busy. */
type OnScreen = { picker: Picker | null; menu: ScreenMenu | null; busy: boolean };

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

/** tmux arguments that start the session detached in Firstmate's checkout. */
export function launchArgv(
	claude: string,
	firstmateDir: string,
	hookFile: string,
	skipPermissions: boolean,
	fmHome: string | null
): string[] {
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
		firstmateDir,
		...(fmHome ? ['-e', `FM_HOME=${fmHome}`] : []),
		'--',
		...claudeArgv(claude, hookFile, skipPermissions)
	];
}

/** The command a captain can copy to attach their own terminal. */
export const attachHint = (socket: string) =>
	shellLine(['tmux', '-L', socket, 'attach', '-t', FIRSTMATE_TMUX]);

export class FirstmateSession {
	readonly firstmateDir: string;
	readonly homeDir: string;
	readonly hookFile: string;
	readonly skipPermissions: boolean;
	readonly tmuxSocket: string;
	private stateDir: string;
	private lock: () => Promise<LockState>;
	private env: NodeJS.ProcessEnv;
	private find: (name: string) => string | null;
	private run: Run;
	private trustStore: string | null;
	private sleep: (ms: number) => Promise<void>;
	private starting: Promise<FirstmateSessionView> | null = null;
	/** One input at a time, in order, so two messages never interleave in the paste buffer. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(opts: FirstmateSessionOptions) {
		this.firstmateDir = path.resolve(opts.firstmateDir);
		this.homeDir = path.resolve(opts.homeDir);
		this.stateDir = path.resolve(opts.stateDir);
		this.hookFile = path.join(this.stateDir, HOOK_RECORD);
		this.lock = opts.lock;
		this.skipPermissions = opts.skipPermissions ?? true;
		this.tmuxSocket = opts.tmuxSocket || DEFAULT_TMUX_SOCKET;
		this.env = sessionEnv(opts.env ?? process.env);
		this.find = opts.find ?? ((name) => which(name, this.env.PATH));
		this.run = opts.run ?? runBounded;
		this.trustStore = opts.trustStore === undefined ? claudeStore(this.env) : opts.trustStore;
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	/** Why Wheelhouse cannot start or talk to a session here, or null. */
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
		if (isInside(this.stateDir, this.homeDir)) {
			return `The Wheelhouse state directory ${this.stateDir} is inside the Firstmate home; choose one outside it.`;
		}
		return null;
	}

	private opts(extra: Partial<RunOptions> = {}): RunOptions {
		return { env: this.env, timeoutMs: TMUX_TIMEOUT_MS, maxOutputBytes: 256 * 1024, ...extra };
	}

	/** Run tmux on Wheelhouse's own server only; nothing reaches tmux any other way. */
	private tmux(args: string[], extra?: Partial<RunOptions>): Promise<RunResult> {
		const tmux = this.find('tmux');
		if (!tmux) return Promise.reject(new Error('tmux is missing'));
		return this.run(tmux, ['-L', this.tmuxSocket, ...args], this.opts(extra));
	}

	/** Whether Wheelhouse's `wh-firstmate` session is running; null when tmux cannot say. */
	async running(): Promise<boolean | null> {
		if (!this.find('tmux') || !TMUX_SOCKET.test(this.tmuxSocket)) return null;
		const r = await this.tmux(['list-sessions', '-F', '#{session_name}']);
		if (r.ok) return r.stdout.split('\n').includes(FIRSTMATE_TMUX);
		if (r.kind === 'exit' && NO_SERVER.test(r.stderr)) return false;
		return null;
	}

	private view(
		state: FirstmateSessionView['state'],
		reason: string | null,
		screen: OnScreen = { picker: null, menu: null, busy: false }
	): FirstmateSessionView {
		return {
			schema: 'wheelhouse-firstmate-session.v1',
			state,
			reason,
			canSend: state === 'ours',
			attach: state === 'ours' ? attachHint(this.tmuxSocket) : null,
			skipPermissions: this.skipPermissions,
			...screen
		};
	}

	/** Wheelhouse's session's screen as text, or null. */
	private async screen(): Promise<string | null> {
		const r = await this.tmux(['capture-pane', '-p', '-t', `=${FIRSTMATE_TMUX}:`]);
		return r.ok ? r.stdout : null;
	}

	/** The menu Claude Code is waiting on in Wheelhouse's session, read off its screen, or null. */
	async picker(): Promise<Picker | null> {
		const text = await this.screen();
		return text === null ? null : parsePicker(text);
	}

	/**
	 * What the screen says: a menu Claude Code waits on (as choices when it has
	 * numbered ones), and whether it is busy (it shows "esc to interrupt" while
	 * working, before anything reaches the transcript).
	 */
	private async onScreen(): Promise<OnScreen> {
		const text = await this.screen().catch(() => null);
		if (text === null) return { picker: null, menu: null, busy: false };
		return {
			picker: parsePicker(text),
			menu: parseMenu(text),
			busy: /\besc to interrupt\b/i.test(text)
		};
	}

	/** Where the Firstmate session stands, as the page shows it. */
	async status(): Promise<FirstmateSessionView> {
		const reason = this.unavailable();
		const ours = reason ? null : await this.running();
		if (ours) return this.view('ours', null, await this.onScreen());
		const lock = await this.lock();
		if (lock === 'held') {
			return this.view(
				'external',
				'Firstmate is running in another terminal, so Wheelhouse shows its conversation read-only and sends your messages to its inbox. To talk to it here directly, close it there and start it from Wheelhouse.'
			);
		}
		if (reason) return this.view('unavailable', reason);
		if (ours === null)
			return this.view('unavailable', 'Wheelhouse could not ask tmux about the session.');
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
		const reason = this.unavailable();
		if (reason) return this.view('unavailable', reason);
		const ours = await this.running();
		if (ours) return this.view('ours', null);
		if (ours === null)
			return this.view('unavailable', 'Wheelhouse could not ask tmux about the session.');
		const lock = await this.lock();
		if (lock === 'held') return this.status();
		if (lock === 'unknown') {
			return this.view(
				'unavailable',
				"Wheelhouse could not read Firstmate's session lock, so it did not start a session (it never risks a second one)."
			);
		}
		const claude = this.find('claude') as string;
		try {
			await mkdir(path.dirname(this.hookFile), { recursive: true });
		} catch (e) {
			return this.view(
				'unavailable',
				`Wheelhouse could not create ${path.dirname(this.hookFile)}: ${(e as Error).message}`
			);
		}
		// Firstmate's checkout is normally trusted already; this only skips the dialog when it is not.
		if (this.trustStore) registerTrust(this.trustStore, this.firstmateDir);
		const fmHome = this.homeDir !== this.firstmateDir ? this.homeDir : null;
		const r = await this.tmux(
			launchArgv(claude, this.firstmateDir, this.hookFile, this.skipPermissions, fmHome),
			{ cwd: this.firstmateDir }
		);
		if (!r.ok) {
			return this.view(
				'unavailable',
				`tmux could not start Firstmate: ${r.stderr.trim() || r.message}`
			);
		}
		for (const [name, value] of SESSION_OPTIONS) {
			await this.tmux(['set-option', '-t', `=${FIRSTMATE_TMUX}:`, name, value]);
		}
		return this.view('ours', null);
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work, work);
		this.queue = next.catch(() => {});
		return next;
	}

	private async ours(): Promise<SendResult | null> {
		const reason = this.unavailable();
		if (reason) return { ok: false, status: 503, error: reason };
		const running = await this.running();
		if (running === null)
			return { ok: false, status: 503, error: 'Wheelhouse could not ask tmux about the session.' };
		if (!running) {
			return {
				ok: false,
				status: 409,
				error: 'Firstmate is not running in Wheelhouse, so there is nothing here to type into.'
			};
		}
		return null;
	}

	private async keys(keys: string[]): Promise<SendResult> {
		for (const key of keys) {
			const r = await this.tmux(['send-keys', '-t', `=${FIRSTMATE_TMUX}:`, key]);
			if (!r.ok)
				return {
					ok: false,
					status: 500,
					error: `tmux could not send a key: ${r.stderr.trim() || r.message}`
				};
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
			const shown = await this.onScreen();
			if (shown.picker || shown.menu) return { ok: false, status: 409, error: MENU_OPEN };
			const load = await this.tmux(['load-buffer', '-b', BUFFER, '-'], {
				input: body,
				maxInputBytes: INPUT_MAX_BYTES + 1024
			});
			if (!load.ok)
				return {
					ok: false,
					status: 500,
					error: `tmux could not take the message: ${load.stderr.trim() || load.message}`
				};
			const paste = await this.tmux([
				'paste-buffer',
				'-d',
				'-p',
				'-b',
				BUFFER,
				'-t',
				`=${FIRSTMATE_TMUX}:`
			]);
			if (!paste.ok)
				return {
					ok: false,
					status: 500,
					error: `tmux could not paste the message: ${paste.stderr.trim() || paste.message}`
				};
			await this.sleep(PASTE_SETTLE_MS);
			return this.keys(['Enter']);
		});
	}

	/** Press Escape: Claude Code stops what it is doing. */
	interrupt(): Promise<SendResult> {
		return this.serial(async () => (await this.ours()) ?? this.keys(['Escape']));
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
	 * Close the menu one of Claude Code's commands opened (such as /mcp):
	 * Escape, as often as it takes to back out of its nested screens. The screen
	 * is read before every press, so Escape never reaches the prompt, where it
	 * would stop Firstmate's work or (pressed twice) open the rewind menu.
	 * Firstmate's own question or permission prompt, which has no heading of
	 * Claude Code's, is the captain's to answer and is never closed.
	 */
	dismiss(): Promise<SendResult> {
		return this.serial(async () => {
			const refused = await this.ours();
			if (refused) return refused;
			for (let i = 0; i < DISMISS_MAX; i++) {
				const text = await this.screen().catch(() => null);
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
				await this.sleep(MENU_SETTLE_MS);
			}
			return {
				ok: false,
				status: 409,
				error: 'The menu is still open after pressing Escape; close it in Firstmate’s terminal.'
			};
		});
	}

	/** What the terminal drawer may attach to: only Wheelhouse's own running session. */
	terminal: ResolveTarget = async () => {
		const refused = await this.ours();
		if (refused && !refused.ok) {
			return { ok: false, status: refused.status === 409 ? 409 : 503, error: refused.error };
		}
		const target: AttachTarget = {
			argv: [
				this.find('tmux') as string,
				'-L',
				this.tmuxSocket,
				'attach-session',
				'-t',
				`=${FIRSTMATE_TMUX}`
			],
			cwd: this.firstmateDir,
			env: { ...this.env, TERM: 'xterm-256color' }
		};
		return { ok: true, target };
	};
}
