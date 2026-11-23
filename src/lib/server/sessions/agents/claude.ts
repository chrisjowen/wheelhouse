import { parseMenu, parsePicker } from '../picker';
import { atClaudePrompt, readSignIn, terminalExcerpt } from '../waiting';
import { registerTrust } from '../trust';
import { shellLine } from '../tmux';
import { contextFileFor } from '../../material/context';
import { locateTranscript, projectsDir, type TranscriptRecord } from '../transcript';
import type { AgentIO, AgentLaunch, OnScreen, PrimaryAgent, SendResult } from './types';

/**
 * Claude Code: started with Wheelhouse's SessionStart hook (through
 * `--settings`, merged with Firstmate's hooks, never replacing them), which
 * records the hook's input, including `transcript_path`, so the chat follows the
 * live transcript across /clear, /compact and resume, and prints the session
 * context Wheelhouse keeps beside that record (material/context.ts), which
 * Claude Code adds to the conversation; a session another
 * terminal holds is followed through Firstmate's lock. Its screen is read for
 * its menus, sign-in and busy state; a menu of its own (such as /mcp) can be
 * closed from the chat.
 */

/** Escapes it may take to back out of a menu's nested screens (/mcp, then a server, then its tools). */
const DISMISS_MAX = 5;
/** Time for Claude Code to redraw after an Escape, before the screen is read again. */
const MENU_SETTLE_MS = 400;
/** Reads of the screen after an Escape before a menu that has not redrawn counts as stuck. */
const MENU_REDRAW_WAITS = 5;
/** The menu at the bottom of a screen, from Claude Code's overline down, so a spinner above it is not a redraw. */
const menuPart = (text: string | null) => text?.slice(Math.max(0, text.lastIndexOf('▔'))) ?? null;

/**
 * The `--settings` JSON: Wheelhouse's SessionStart hook, and no bypass-mode
 * prompt when skipping. The hook prints the session context file when there
 * is one (the captain can turn it off, which removes the file).
 */
export function sessionSettings(hookFile: string, skipPermissions: boolean): string {
	const tmp = `${hookFile}.tmp`;
	const context = contextFileFor(hookFile);
	const command = `cat > ${shellLine([tmp])} && mv -f ${shellLine([tmp])} ${shellLine([hookFile])} && { cat ${shellLine([context])} 2>/dev/null || true; }`;
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

/** Every Claude Code launch is the same to the chat: its hook record says where its transcript is. */
const launch: AgentLaunch = {
	chatReady: true,

	async screen(io, settled) {
		const text = await io.screen().catch(() => null);
		if (text === null) return { picker: null, menu: null, busy: false };
		const signIn = readSignIn(text)?.signIn ?? null;
		if (signIn) {
			io.read();
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
		if (shown.picker || shown.menu || !text.trim() || atClaudePrompt(text)) io.read();
		else if (io.unread() || settled) shown.terminal = { excerpt: terminalExcerpt(text) };
		return shown;
	},

	async picker(io) {
		const text = await io.screen();
		return text === null ? null : parsePicker(text);
	},

	/**
	 * Close the menu one of Claude Code's commands opened (such as /mcp):
	 * Escape, as often as it takes to back out of its nested screens. After each
	 * press the screen is read until the menu has redrawn, and only another menu
	 * gets another press, so Escape never reaches the prompt, where it would stop
	 * Firstmate's work or (pressed twice) open the rewind menu.
	 * Firstmate's own question or permission prompt, which has no heading of
	 * Claude Code's, is the captain's to answer and is never closed.
	 */
	async dismiss(io: AgentIO): Promise<SendResult> {
		let text = await io.screen().catch(() => null);
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
			const r = await io.keys(['Escape']);
			if (!r.ok) return r;
			const before = menuPart(text);
			for (let w = 0; w < MENU_REDRAW_WAITS && menuPart(text) === before; w++) {
				await io.sleep(MENU_SETTLE_MS);
				text = await io.screen().catch(() => null);
			}
			if (menuPart(text) === before) break;
		}
		return {
			ok: false,
			status: 409,
			error: 'The menu is still open after pressing Escape; close it in Firstmate’s terminal.'
		};
	}
};

export const claude: PrimaryAgent = {
	id: 'claude',
	skipPermissionsSetting: true,
	slashCommands: true,
	menuOpen:
		'A Claude Code menu is open in Firstmate’s session, so nothing was typed. Answer or close it, then send again.',
	restartToChat: 'Restart the claude session from Wheelhouse to enable its chat.',

	async start(ctx, binary) {
		// Firstmate's checkout is normally trusted already; this only skips the dialog when it is not.
		if (ctx.trustStore) registerTrust(ctx.trustStore, ctx.firstmateDir);
		return { argv: claudeArgv(binary, ctx.hookFile, ctx.skipPermissions), env: {}, launch };
	},

	async recover() {
		return launch;
	},

	chat: {
		kind: 'stream',
		locate: (ctx, _launch, state) =>
			locateTranscript(
				{
					firstmateDir: ctx.firstmateDir,
					homeDir: ctx.homeDir,
					hookFile: ctx.hookFile,
					projectsDir: projectsDir(ctx.env)
				},
				state
			),
		decode: (raw) =>
			raw !== null && typeof raw === 'object' && !Array.isArray(raw)
				? [raw as TranscriptRecord]
				: []
	}
};
