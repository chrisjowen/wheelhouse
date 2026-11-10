/**
 * The setup wizard (`/setup`): what the page and `/api/setup` share. It runs
 * when Wheelhouse finds no Firstmate home, and again from Settings → Setup.
 * Its steps, in order:
 *
 *   location  where Firstmate lives: clone it to a new or empty folder, or use one already there
 *   tools     what Firstmate needs, from Firstmate's own bootstrap check, with how to install each
 *   claude    Claude Code installed, signed in and answering
 *   check     Firstmate's own checks, and Wheelhouse's, against the chosen home
 *   plugins   which plugins to turn on, and some to install
 *   finish    start Firstmate and open its chat
 *
 * The step state machine below is pure, so the page and the tests share it.
 */

export const SETUP_STEPS = ['location', 'tools', 'claude', 'check', 'plugins', 'finish'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const STEP_TITLES: Record<SetupStep, string> = {
	location: 'Where Firstmate lives',
	tools: 'Tools Firstmate needs',
	claude: 'Claude Code',
	check: 'Firstmate’s own checks',
	plugins: 'Plugins',
	finish: 'Start Firstmate'
};

export const isSetupStep = (s: unknown): s is SetupStep =>
	typeof s === 'string' && (SETUP_STEPS as readonly string[]).includes(s);

/** The public Firstmate repository the wizard clones. */
export const FIRSTMATE_REPOSITORY = 'https://github.com/kunchenguid/firstmate.git';

export type OsKind = 'macos' | 'linux' | 'windows' | 'other';
export type PackageManager = 'brew' | 'apt' | 'dnf' | 'pacman';

export interface PlatformView {
	os: OsKind;
	/** For people: "macOS", "Linux (apt)". */
	label: string;
	/** The system package manager Wheelhouse found, if any. */
	packageManager: PackageManager | null;
}

export type DepStatus = 'ok' | 'missing' | 'outdated' | 'needs-auth' | 'optional' | 'unknown';

/** One tool, and what to do about it. */
export interface DepItem {
	tool: string;
	/** What Firstmate uses it for, in a few words. */
	what: string;
	status: DepStatus;
	/** The installed version, a requirement, or why it is flagged. */
	detail: string | null;
	/** Firstmate cannot run without it (optional tools only improve it). */
	required: boolean;
	/**
	 * One click: the exact command, shown before it runs, and run by Wheelhouse
	 * only after the captain confirms. Only well-known package managers, never
	 * sudo, never a shell.
	 */
	oneClick: { command: string } | null;
	/** Commands for the captain's own terminal: anything with sudo, a script or a login. */
	terminal: string[];
	/** Where its own install instructions are. */
	link: string | null;
	note: string | null;
}

export interface ToolsReport {
	/** Firstmate's resolved runtime backend (tmux by default). */
	backend: string | null;
	items: DepItem[];
	/** Other lines Firstmate's check printed, as it printed them. */
	notes: string[];
	/** The check could not run at all: why. */
	error: string | null;
	checkedAt: string;
}

export type LocationKind =
	/** Nothing there: Firstmate can be cloned there. */
	| 'new'
	/** An empty folder: Firstmate can be cloned into it. */
	| 'empty'
	/** A Firstmate checkout already: use it. */
	| 'firstmate'
	/** Something else is there: never overwritten. */
	| 'occupied'
	/** Not a usable path at all. */
	| 'invalid';

export interface LocationCheck {
	dir: string;
	kind: LocationKind;
	message: string;
}

export interface InstallView {
	firstmateDir: string;
	homeDir: string;
	/** Where Wheelhouse found it: --firstmate, the folder it ran in, or setup's own record. */
	source: 'flag' | 'cwd' | 'remembered';
}

export interface SetupView {
	schema: 'wheelhouse-setup.v1';
	platform: PlatformView;
	/** Installs only say what they would run (WHEELHOUSE_SETUP_DRY_RUN=1). */
	dryRun: boolean;
	/** The Firstmate Wheelhouse is connected to, if any. */
	install: InstallView | null;
	/** Why Wheelhouse is not connected, when it is not. */
	problem: string | null;
	/**
	 * Whether the page may change which Firstmate Wheelhouse uses. Not when
	 * `wheelhouse open` was given one (--firstmate, or the folder it ran in).
	 */
	canChoose: boolean;
	/** Where the wizard suggests cloning Firstmate. */
	defaultDir: string;
	/** Existing Firstmate checkouts found in the usual places. */
	found: string[];
	repository: string;
	/** git, which cloning needs. */
	git: DepItem;
	/** tmux is on PATH: Wheelhouse runs the Firstmate session in it. */
	tmux: boolean;
	/** Wheelhouse can restart itself (it runs under `wheelhouse open`). */
	canRestart: boolean;
}

export interface ClaudeStatus {
	installed: boolean;
	path: string | null;
	version: string | null;
	/** null until a test has run. */
	signedIn: boolean | null;
	/** What the last test said, in one line. */
	detail: string | null;
	install: DepItem;
}

export interface CheckLine {
	label: string;
	ok: boolean;
	detail: string | null;
}

export interface CheckReport {
	ok: boolean;
	lines: CheckLine[];
	checkedAt: string;
}

export interface SetupPlugin {
	id: string;
	name: string;
	description: string | null;
	/** Bundled with Wheelhouse, or a suggestion to install from GitHub. */
	source: 'bundled' | 'installable';
	/** Bundled: whether it is on now. Installable: whether it is installed. */
	on: boolean;
	/** Installable: its GitHub org/repo. */
	repository: string | null;
}

/** What finishing reports about the Firstmate session it started (or found). */
export interface FirstmateSessionViewLike {
	state: 'ours' | 'external' | 'starting' | 'none' | 'unavailable';
	reason: string | null;
	attach: string | null;
}

/** What the page has learned so far, step by step; `unknown` until it has looked. */
export interface SetupFacts {
	home: boolean;
	tools: 'unknown' | 'ok' | 'missing';
	claude: 'unknown' | 'ok' | 'missing' | 'signed-out';
	check: 'unknown' | 'ok' | 'problems';
	plugins: 'unknown' | 'seen';
	/** tmux is on this computer: Wheelhouse runs the Firstmate session in it. */
	tmux: boolean;
}

export const NO_FACTS: SetupFacts = {
	home: false,
	tools: 'unknown',
	claude: 'unknown',
	check: 'unknown',
	plugins: 'unknown',
	tmux: false
};

export type StepState = 'done' | 'attention' | 'todo' | 'locked';

/**
 * Each step's state. Every step after `location` waits for a home; `finish`
 * waits for Claude Code to answer and for tmux. A step with something left to
 * fix is `attention`, never `locked`: the captain may move on and come back.
 */
export function stepStates(f: SetupFacts): Record<SetupStep, StepState> {
	const after = (s: StepState): StepState => (f.home ? s : 'locked');
	const of = (v: string, ok: string): StepState =>
		v === ok ? 'done' : v === 'unknown' ? 'todo' : 'attention';
	return {
		location: f.home ? 'done' : 'todo',
		tools: after(of(f.tools, 'ok')),
		claude: after(of(f.claude, 'ok')),
		check: after(of(f.check, 'ok')),
		plugins: after(f.plugins === 'seen' ? 'done' : 'todo'),
		finish: canFinish(f).ok ? 'todo' : 'locked'
	};
}

/** Whether Firstmate can be started now, or what is in the way. */
export function canFinish(f: SetupFacts): { ok: true } | { ok: false; why: string } {
	if (!f.home) return { ok: false, why: 'Choose where Firstmate lives first.' };
	if (!f.tmux) return { ok: false, why: 'Install tmux first: Wheelhouse runs Firstmate in it.' };
	if (f.claude !== 'ok') {
		return {
			ok: false,
			why:
				f.claude === 'missing'
					? 'Install Claude Code first.'
					: 'Sign in to Claude Code first, and test it.'
		};
	}
	return { ok: true };
}

/** Whether the captain may open `step` now. */
export const canOpen = (step: SetupStep, f: SetupFacts): boolean =>
	stepStates(f)[step] !== 'locked';

/** The step after `step` that can be opened, else `step` itself. */
export function nextStep(step: SetupStep, f: SetupFacts): SetupStep {
	const states = stepStates(f);
	const i = SETUP_STEPS.indexOf(step);
	return SETUP_STEPS.slice(i + 1).find((s) => states[s] !== 'locked') ?? step;
}

/** Where the wizard opens: the first step not done yet that can be opened. */
export function firstOpenStep(f: SetupFacts): SetupStep {
	const states = stepStates(f);
	return SETUP_STEPS.find((s) => states[s] === 'todo' || states[s] === 'attention') ?? 'finish';
}

/** The tools facts from a report: every required tool present and current. */
export function toolsFact(r: ToolsReport | null): SetupFacts['tools'] {
	if (!r || r.error) return 'unknown';
	return r.items.some((i) => i.required && i.status !== 'ok') ? 'missing' : 'ok';
}

export function claudeFact(c: ClaudeStatus | null): SetupFacts['claude'] {
	if (!c) return 'unknown';
	if (!c.installed) return 'missing';
	if (c.signedIn === true) return 'ok';
	return c.signedIn === false ? 'signed-out' : 'unknown';
}

/** Setup's own terminal, for signing in to Claude Code (see src/lib/server/setup/terminal.ts). */
export const SETUP_TERMINAL_PATH = '/api/setup/terminal';
