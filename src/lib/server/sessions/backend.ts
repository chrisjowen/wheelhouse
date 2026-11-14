import type { AttachTarget } from './terminal';

/**
 * What runs the Firstmate session: the terminal multiplexer Wheelhouse starts
 * it in and talks to it through. FirstmateSession decides what to do (the
 * session lock, never typing into a menu, one input at a time, the size limit);
 * a backend only does it, always on the one session it owns and never on any
 * other session or server.
 *
 * tmux (tmux.ts) is the default; herdr (herdr.ts) is experimental.
 */

/** A key the session understands, by name. Each backend maps these to its own key names. */
export type SessionKey = 'Enter' | 'Escape' | 'C-c' | 'Up' | 'Down' | Digit;
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** Whether a backend call worked; on failure, a sentence the page can show as it is. */
export type BackendResult = { ok: true } | { ok: false; error: string };

/** How to start the session. */
export interface LaunchSpec {
	/** The working directory: Firstmate's checkout. */
	cwd: string;
	/** The command, as an argument array (the harness and its flags). */
	argv: string[];
	/** Variables to set in the session on top of what it inherits (FM_HOME, the harness markers). */
	env: Record<string, string>;
}

export interface SessionBackend {
	/** The backend's name as messages give it ("tmux could not start Firstmate: …"). */
	readonly label: string;
	/** Why this backend cannot run here (missing program, bad configuration), or null. */
	unavailable(): string | null;
	/** Whether the session is running; null when the backend cannot say. */
	running(): Promise<boolean | null>;
	/** Why running() last answered null, as a sentence the page can show as it is, if the backend knows. */
	problem?(): string | null;
	/** Start the session detached. Called only when running() said false. */
	start(spec: LaunchSpec): Promise<BackendResult>;
	/**
	 * A variable the running session was started with (LaunchSpec.env), so a
	 * restarted Wheelhouse can tell how it was launched: its value, '' when the
	 * session has no such variable, or null when the backend cannot say.
	 */
	variable(name: string): Promise<string | null>;
	/** The session's visible screen as plain text, or null when it cannot be read. */
	screen(): Promise<string | null>;
	/**
	 * Type `text` into the session as one paste (a multi-line message stays one
	 * message), without submitting it.
	 */
	paste(text: string): Promise<BackendResult>;
	/** Press one key in the session. */
	key(key: SessionKey): Promise<BackendResult>;
	/** What the terminal drawer runs in its pty to show the session (FirstmateSession adds the cwd). */
	attach(): Omit<AttachTarget, 'cwd'>;
	/** The command a captain can copy to attach their own terminal. */
	attachHint(): string;
}
