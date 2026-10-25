/**
 * The terminal drawer: a WebSocket at TERMINAL_PATH bridged to the Firstmate
 * session's tmux pane. Browsers cannot put custom headers on a WebSocket, so
 * the page offers two subprotocols: TERMINAL_PROTOCOL, which the server
 * echoes, and the launch's session token as `TOKEN_PROTOCOL_PREFIX + token`.
 * The server sends the terminal's output as binary frames; the page sends
 * TerminalMessage JSON as text frames.
 */
export const TERMINAL_PROTOCOL = 'wheelhouse.terminal.v1';
export const TOKEN_PROTOCOL_PREFIX = 'wheelhouse.token.';
export const TERMINAL_PATH = '/api/firstmate/terminal';

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
