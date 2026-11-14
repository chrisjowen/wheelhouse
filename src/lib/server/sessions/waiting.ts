import { createHash } from 'node:crypto';
import type { SignIn } from '../../types';

/**
 * What the Firstmate session waits on in its terminal beyond its menus
 * (picker.ts): a harness's sign-in screen, which the chat shows as a card
 * that opens the sign-in page and types the code back, and, for Claude Code,
 * whether its prompt is on screen at all, so any other screen it stops on
 * (an error to retry, a dialog Wheelhouse does not know) is shown as waiting
 * in the terminal rather than as Firstmate waiting for a message. Pure: each
 * reads a `tmux capture-pane -p` dump. Verified against Claude Code 2.1.280,
 * Codex 0.169.0 and Pi 0.80.10.
 */

/** Hosts a sign-in link may point at; a link anywhere else shows as waiting in the terminal instead. */
const SIGN_IN_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com', 'openai.com', 'chatgpt.com'];
const URL_START = /^\s*(https:\/\/\S+)\s*$/;
/** A row of a long address the terminal wrapped: address characters only, no spaces. */
const URL_PART = /^\s*([A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)\s*$/;
/** Claude Code: its paste field is the screen's last line. */
const CLAUDE_PASTE = /^\s*Paste code here if prompted\s*>(.*)$/;
/** Pi: asks on one line and takes the answer on the next. */
const PI_ASK = /\bpaste the authorization code\b/i;
const PI_FIELD = /^\s*>(.*)$/;
/** Codex: signing in finishes in the browser (or with a device code), and Esc cancels. */
const CODEX_WAIT = /^\s*Finish signing in via your browser\s*$/;
const ESC_CANCEL = /\besc to cancel\b/i;
const DEVICE_CODE = /^\s*([A-Z0-9]{4,}-[A-Z0-9]{4,})\s*$/;
const ANOTHER_MACHINE = /\b(remote|headless|another machine)\b/i;
const MAX_URL = 4096;

/** The sign-in screen at the bottom of `screen`, and what is already typed into its field. */
export function readSignIn(screen: string | null): { signIn: SignIn; typed: string } | null {
	if (!screen) return null;
	const lines = screen.replace(/\r/g, '').split('\n');
	let last = lines.length - 1;
	while (last >= 0 && !lines[last].trim()) last--;
	if (last < 0) return null;

	let paste = false;
	let typed = '';
	let end = -1;
	const claude = CLAUDE_PASTE.exec(lines[last]);
	if (claude) {
		paste = true;
		typed = claude[1].trim();
		end = last;
	} else if ((end = piAsk(lines, last)) >= 0) {
		paste = true;
		let field = end + 1;
		while (!lines[field].trim()) field++;
		typed = (PI_FIELD.exec(lines[field]) as RegExpExecArray)[1].trim();
	} else if (ESC_CANCEL.test(lines[last]) && lines.some((l) => CODEX_WAIT.test(l))) {
		end = last;
	} else {
		return null;
	}

	// The address: the last one above the field, joined back up where the terminal wrapped it.
	const start = lines.findLastIndex((l, i) => i < end && URL_START.test(l));
	if (start < 0) return null;
	let url = (URL_START.exec(lines[start]) as RegExpExecArray)[1];
	let after = start + 1;
	for (; after < end && lines[after].trim(); after++) {
		const part = URL_PART.exec(lines[after]);
		if (!part) break;
		url += part[1];
	}
	if (!allowed(url)) return null;

	const code = paste
		? null
		: (lines
				.slice(after, end)
				.map((l) => DEVICE_CODE.exec(l)?.[1])
				.find(Boolean) ?? null);
	const signature = createHash('sha256')
		.update(JSON.stringify([url, code, paste]))
		.digest('hex')
		.slice(0, 16);
	return { signIn: { url, code, paste, note: note(lines, start, end), signature }, typed };
}

/** The sign-in screen at the bottom of `screen`, or null. */
export function parseSignIn(screen: string | null): SignIn | null {
	return readSignIn(screen)?.signIn ?? null;
}

function allowed(url: string): boolean {
	if (url.length > MAX_URL) return false;
	try {
		const u = new URL(url);
		const host = u.hostname.toLowerCase();
		return (
			u.protocol === 'https:' &&
			!u.username &&
			!u.password &&
			SIGN_IN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
		);
	} catch {
		return false;
	}
}

/**
 * Pi's question, whose answer field is the next row: near the bottom, with
 * only how to cancel, its editor's rule and its footer below. -1 when absent.
 */
function piAsk(lines: string[], last: number): number {
	for (let i = last, seen = 0; i >= 0 && seen < 8; i--) {
		if (!lines[i].trim()) continue;
		seen++;
		if (!PI_ASK.test(lines[i])) continue;
		let field = i + 1;
		while (field <= last && !lines[field].trim()) field++;
		return field <= last && PI_FIELD.test(lines[field]) ? i : -1;
	}
	return -1;
}

/** The paragraph between the address and `end` about signing in from another machine, as one line. */
function note(lines: string[], start: number, end: number): string | null {
	const at = lines.findIndex((l, i) => i > start && i < end && ANOTHER_MACHINE.test(l));
	if (at < 0) return null;
	let top = at;
	while (top > start + 1 && lines[top - 1].trim()) top--;
	let bottom = at;
	while (bottom + 1 < end && lines[bottom + 1].trim()) bottom++;
	return lines
		.slice(top, bottom + 1)
		.map((l) => l.trim())
		.join(' ');
}

const RULE = /^\s*─{8,}\s*$/;
const BOX_TOP = /^\s*╭─{8,}/;
/** The prompt's first row: Claude Code's `❯` (or `>`, or `!` in bash mode), alone in its box or older `│ >`. */
const PROMPT_ROW = /^\s*(?:[❯>!](?:\s|$)|│\s*>(?:\s|$))/;

/**
 * Whether Claude Code's prompt is on `screen`, idle or busy: a row starting
 * with its prompt sign, directly under the rule (or box) it draws above it,
 * with a rule below. Anything else that is not a menu means it waits in its
 * terminal on something the chat cannot read.
 */
export function atClaudePrompt(screen: string): boolean {
	const lines = screen.replace(/\r/g, '').split('\n');
	for (let i = lines.length - 1; i > 0; i--) {
		if (!PROMPT_ROW.test(lines[i])) continue;
		let above = i - 1;
		while (above >= 0 && !lines[above].trim()) above--;
		if (above < 0 || !(RULE.test(lines[above]) || BOX_TOP.test(lines[above]))) continue;
		if (lines.slice(i + 1).some((l) => RULE.test(l) || /^\s*╰─{8,}/.test(l))) return true;
	}
	return false;
}

/** Rows that only draw (rules, overlines, dotted lines, the logo's art) say nothing. */
const DRAWING = /^[\s─━▔╌═│┃╭╮╰╯░▒▓█▄▀.*]*$/;

/** The last few rows of `screen` that say something, as a hint of what it waits on. */
export function terminalExcerpt(screen: string): string {
	return screen
		.replace(/\r/g, '')
		.split('\n')
		.filter((l) => l.trim() && !DRAWING.test(l))
		.slice(-3)
		.map((l) => {
			const t = l.trim();
			return t.length > 160 ? `${t.slice(0, 159)}…` : t;
		})
		.join('\n');
}
