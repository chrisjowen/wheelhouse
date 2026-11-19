import type { Harness } from '../../../harness';
import type {
	FirstmateSessionView,
	Picker,
	ScreenMenu,
	SignIn,
	TerminalWait,
	TranscriptSource
} from '../../../types';
import type { SessionKey } from '../backend';
import type { ConversationSnapshot, TranscriptRecord } from '../transcript';

/**
 * A primary agent: the interactive harness (Claude Code, Codex, Pi, Grok,
 * OpenCode) Wheelhouse runs as Firstmate's session. Each one is a module under
 * this directory, registered in AGENTS (index.ts), so what an agent has to
 * provide is said once, here, instead of in branches across FirstmateSession.
 *
 * Two objects, so per-launch state is owned rather than loose: the static
 * PrimaryAgent starts a launch or recovers a running one, and the AgentLaunch
 * it returns holds that launch's own state (a nonce, a conversation id, a
 * connection) and answers for it. FirstmateSession keeps everything the agents
 * share: the session lock, the backend, one input at a time, input checks and
 * the settle before a screen counts as waiting in the terminal.
 *
 * Internal for now; an agent only sees AgentIO and AgentContext, never
 * FirstmateSession, so this could later become a plugin role.
 */

export type SendResult =
	{ ok: true } | { ok: false; status: 400 | 409 | 413 | 500 | 503; error: string };

/**
 * What the session's screen shows: a menu (and its choices, when numbered),
 * whether the agent is busy and, when it waits on the captain some other way,
 * its sign-in or anything else it waits on in its terminal.
 */
export type OnScreen = {
	picker: Picker | null;
	menu: ScreenMenu | null;
	busy: boolean;
	signIn?: SignIn | null;
	terminal?: TerminalWait | null;
};

/** What FirstmateSession lends an agent: its one session's terminal, already checked to be Wheelhouse's own. */
export interface AgentIO {
	/** The session's screen as text, or null. */
	screen(): Promise<string | null>;
	/** Press keys in order, with a gap between them. */
	keys(keys: SessionKey[]): Promise<SendResult>;
	/** A variable the running session was launched with: '' when it has none, null when the backend cannot say. */
	variable(name: string): Promise<string | null>;
	sleep(ms: number): Promise<void>;
	/** The screen is one the chat reads: any settle towards waiting in the terminal starts afresh. */
	read(): void;
	/** The screen is one the chat cannot read or drive: whether it has stayed long enough to count as waiting in the terminal. */
	unread(): boolean;
}

/** Where and how a launch runs, for an agent starting, recovering or reading one. */
export interface AgentContext {
	/** Firstmate's checkout: the session's working directory. */
	firstmateDir: string;
	/** Firstmate's operational home (FM_HOME when it differs from the checkout). */
	homeDir: string;
	/** Wheelhouse's state directory (outside the Firstmate home). */
	stateDir: string;
	/** The hook record this launch writes or wrote. */
	hookFile: string;
	/** Claude Code's config store for workspace trust, or null to leave it alone. */
	trustStore: string | null;
	/** Whether Claude Code starts with --dangerously-skip-permissions. */
	skipPermissions: boolean;
	/** Pi's provider as the setup wizard chose it, read at each launch; null: Pi's own default. */
	piProvider: () => string | null;
	/** The environment, for where an agent keeps its own files (CODEX_HOME, HOME). */
	env: NodeJS.ProcessEnv;
}

/**
 * How the chat finds and reads an agent's conversation, given the launch
 * running (null when none of this agent's runs here, such as a session another
 * terminal holds): a transcript it follows as it grows, found for the
 * session's state, whose lines `decode` turns into the chat's records; or a
 * conversation read whole each time, since its messages or active branch can
 * change in place.
 */
export type AgentChat<L extends AgentLaunch = AgentLaunch> =
	| {
			kind: 'stream';
			locate(
				ctx: AgentContext,
				launch: L | null,
				state: FirstmateSessionView['state']
			): Promise<Omit<TranscriptSource, 'truncated'> | null>;
			decode(raw: unknown): TranscriptRecord[];
	  }
	| {
			kind: 'snapshot';
			/** The conversation of the session Wheelhouse runs; null when it cannot be bound yet. */
			read(ctx: AgentContext, launch: L | null): Promise<ConversationSnapshot | null>;
	  };

/** A new launch: the command to run, the variables that mark it, and the launch they start. */
export interface AgentStart<L extends AgentLaunch = AgentLaunch> {
	argv: string[];
	/** Variables that let a later Wheelhouse recover this launch (besides WHEELHOUSE_HARNESS and FM_HOME). */
	env: Record<string, string>;
	launch: L;
}

/** One primary agent, as AGENTS registers it, with the kind of launch it starts. */
export interface PrimaryAgent<L extends AgentLaunch = AgentLaunch> {
	readonly id: Harness;
	/**
	 * Prepare a new launch (files it reads, trust) and say how to run it.
	 * `binary` is the agent's command found on PATH; `nonce` is fresh for this launch.
	 * A thrown error is shown as "Could not prepare <agent>".
	 */
	start(ctx: AgentContext, binary: string, nonce: string): Promise<AgentStart<L>>;
	/**
	 * The launch a running session was started with, read back from its
	 * variables. `current` is the launch this Wheelhouse already holds, which may
	 * be kept when the variables still name it. Never throws: a session it cannot
	 * trust comes back with `chatReady` false.
	 */
	recover(ctx: AgentContext, io: AgentIO, current: L | null): Promise<L>;
	/** Why nothing is typed while a menu or choice of this agent's is open. */
	readonly menuOpen: string;
	/** Why nothing is typed into a launch that is not `chatReady`. */
	readonly restartToChat: string;
	/** Where its conversation is read from; without this, the chat shows none. */
	readonly chat?: AgentChat<L>;
}

/** One running launch of one agent. */
export interface AgentLaunch {
	/**
	 * Whether the chat can talk to it: false for a session that predates chat
	 * integration or belongs to another Wheelhouse state directory, which stays
	 * terminal-accessible only.
	 */
	readonly chatReady: boolean;
	/**
	 * What the screen shows. A screen it cannot read counts as waiting in the
	 * terminal once it has stayed, or at once when `settled` (before typing,
	 * where a screen caught halfway must not be typed into).
	 */
	screen(io: AgentIO, settled: boolean): Promise<OnScreen>;
	/** The choice it waits on, with the keys the screen expects, or null. */
	picker(io: AgentIO): Promise<Picker | null>;
	/** Close a menu of its own; without this, menus are closed in the terminal. */
	dismiss?(io: AgentIO): Promise<SendResult>;
}
