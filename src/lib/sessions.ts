import type { SessionSummary } from '$lib/types';

/**
 * Handing a captain's session to Firstmate. The hand-off is an ordinary Bridge
 * message (same idempotent send), whose body starts `Re: session <id>` and
 * names the session's scratch directory so Firstmate can read any notes the
 * session left there. Pure, so it is unit-tested.
 */

export const sessionLabel = (s: Pick<SessionSummary, 'project'>) => s.project?.name ?? 'Blank idea';

const reLine = (s: SessionSummary) => `Re: session ${s.id}`;
const notesLine = (s: SessionSummary) => `Session notes: ${s.dir}`;

/** What the hand-off composer starts with; the captain writes below it. */
export function handoffPrefill(s: SessionSummary): string {
	return `${reLine(s)}\n${notesLine(s)}\n${s.project ? `Project: ${s.project.name}` : 'Blank idea'}\n\n`;
}

/**
 * The message sent to Firstmate: the captain's text, with the `Re: session`
 * first line and the scratch directory put back if they were edited away.
 */
export function handoffBody(text: string, s: SessionSummary): string {
	let body = text.trim();
	if (body.startsWith(reLine(s))) body = body.slice(reLine(s).length).trimStart();
	if (!body.includes(s.dir)) body = `${notesLine(s)}\n${body}`;
	return `${reLine(s)}\n${body}`;
}

/**
 * The live terminal: a WebSocket at `/api/sessions/<id>/terminal`. Browsers
 * cannot put custom headers on a WebSocket, so the page offers two
 * subprotocols: TERMINAL_PROTOCOL, which the server echoes, and the launch's
 * session token as `TOKEN_PROTOCOL_PREFIX + token`. The server sends the
 * terminal's output as binary frames; the page sends TerminalMessage JSON as
 * text frames.
 */
export const TERMINAL_PROTOCOL = 'wheelhouse.terminal.v1';
export const TOKEN_PROTOCOL_PREFIX = 'wheelhouse.token.';
export const terminalPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}/terminal`;

export type TerminalMessage =
	{ type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

/** Close codes the server ends a terminal socket with (4000-4999 are the application's). */
export const TERMINAL_CLOSE = {
	/** The tmux client detached or exited (the session ended, or was detached elsewhere). */
	detached: 4000,
	/** The terminal could not start (for example, no pty support). */
	failed: 4001,
	/** Wheelhouse is shutting down. */
	shutdown: 4002
} as const;
