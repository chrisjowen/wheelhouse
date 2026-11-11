/**
 * What the pages and the server share about new versions: Wheelhouse's own
 * update check and upgrade, each installed plugin's update state, and the
 * look-up shown before installing or updating a plugin. The server builds
 * these (src/lib/server/upgrade/, src/lib/server/plugins/); the header's
 * update menu and the Plugins page show them.
 */

export interface Commit {
	sha: string;
	subject: string;
	/** ISO 8601 commit date. */
	date: string;
}

export interface UpdateCheck {
	schema: 'wheelhouse-update.v1';
	checkedAt: string;
	/**
	 * current: nothing new. available: newer commits that can be fast-forwarded to.
	 * refused: newer commits, but the clone cannot take them as it is.
	 * unsupported: not a git clone Wheelhouse can upgrade. error: the check failed.
	 */
	state: 'current' | 'available' | 'refused' | 'unsupported' | 'error';
	/** Why it is refused, unsupported or failed. */
	reason: string | null;
	/** The clone Wheelhouse runs from. */
	dir: string;
	/** `org/repo` when origin is on GitHub. */
	repository: string | null;
	branch: string | null;
	current: { commit: string | null; version: string | null };
	latest: { commit: string; version: string | null } | null;
	/** The newest commits not in the clone, newest first. */
	commits: Commit[];
	/** How many commits the clone is behind. */
	behind: number;
	/** Local changes, as `git status --short` lists them, when they refuse it. */
	changes: string[];
}

export type UpgradeStep =
	'fetch' | 'fast-forward' | 'install' | 'build' | 'npm-install' | 'clone' | 'link';

export type StepList = { step: UpgradeStep | 'restart'; label: string }[];

/** Upgrading a clone from GitHub. */
export const UPGRADE_STEPS: StepList = [
	{ step: 'fetch', label: 'Fetch from GitHub' },
	{ step: 'fast-forward', label: 'Fast-forward the clone' },
	{ step: 'install', label: 'Install packages (npm ci)' },
	{ step: 'build', label: 'Build' },
	{ step: 'restart', label: 'Restart Wheelhouse' }
];

/** Upgrading (or switching to) the published npm package. */
export const NPM_STEPS: StepList = [
	{ step: 'npm-install', label: 'Install from npm' },
	{ step: 'restart', label: 'Restart Wheelhouse' }
];

const LINK = { step: 'link', label: 'Link the clone (npm link)' } as const;

/** Switching to GitHub source with a clone already there: bring it up to date, then link it. */
export const CLONE_SWITCH_STEPS: StepList = [...UPGRADE_STEPS.slice(0, -1), LINK, UPGRADE_STEPS[4]];

/** Switching to GitHub source without a clone: clone, build and link it. */
export const CLONE_SETUP_STEPS: StepList = [
	{ step: 'clone', label: 'Clone from GitHub' },
	UPGRADE_STEPS[2],
	UPGRADE_STEPS[3],
	LINK,
	UPGRADE_STEPS[4]
];

export interface UpgradeJob {
	state: 'running' | 'failed' | 'restarting';
	step: UpgradeStep | 'restart';
	/** The steps this job runs, in order. */
	steps: StepList;
	/** The commit (or version) the upgrade moves to, once known. */
	to: string | null;
	error: string | null;
	/** The end of what the failed step printed. */
	output: string | null;
	startedAt: string;
}

export type UpdateSource = 'published' | 'github';

export interface WheelhouseUpdateView {
	schema: 'wheelhouse-self-update.v1';
	/** Chosen update source (unset: github for a clone, else published). */
	source: UpdateSource;
	/** Detected install kind from the running package location. */
	installKind: 'npm' | 'clone' | 'unknown';
	/** True when the chosen source does not match how Wheelhouse is installed. */
	mismatch: boolean;
	check: UpdateCheck | null;
	checking: boolean;
	job: UpgradeJob | null;
	/** Run by `wheelhouse open`, so it can restart itself; else upgrading is refused. */
	canRestart: boolean;
	/** What a restart would stop. */
	busy: string[];
}

export interface PluginUpdateView {
	id: string;
	repository: string;
	/** What it was installed from: a tag, a branch, a commit, or null for the default branch. */
	ref: string | null;
	commit: string;
	version: string;
	/**
	 * current: nothing newer. available: its branch (or tag) names a newer commit.
	 * newer-tag: installed at a release tag, and a newer one exists.
	 * pinned: installed at a commit, so never checked. error: the check failed.
	 */
	state: 'current' | 'available' | 'newer-tag' | 'pinned' | 'error';
	/** What updating moves to: the ref to fetch (null for the default branch) and its commit. */
	latest: { ref: string | null; commit: string } | null;
	reason: string | null;
}

export interface PluginUpdatesView {
	schema: 'wheelhouse-plugin-updates.v1';
	checkedAt: string | null;
	plugins: PluginUpdateView[];
	error: string | null;
}

export type PluginSettingValue = string | number | boolean | string[];

export interface PluginSettingView {
	key: string;
	title: string;
	description: string | null;
	/** `list` is a list of short texts, entered separated by commas. */
	type: 'text' | 'number' | 'boolean' | 'list';
	required: boolean;
	default?: PluginSettingValue;
	/** A text setting that is one of these values, each with what pages call it. */
	options?: { value: string; label: string }[];
	/** What the plugins file holds for it already. */
	current?: PluginSettingValue;
}

/** What a page shows before the captain agrees to install or update a plugin. */
export interface PluginPreview {
	id: string;
	name: string;
	version: string;
	description: string | null;
	repository: string;
	ref: string | null;
	/** The exact commit fetched: installing or updating keeps this one or refuses. */
	commit: string;
	author: string | null;
	homepage: string | null;
	apiVersion: number;
	slots: string[];
	services: string[];
	/** What it does with addresses, in plain words (see plugins/words.ts addressWords). */
	addresses: string[];
	/** What it may do beyond reading, in plain words (see plugins/words.ts capabilityWords). */
	capabilities: string[];
	ui: string | null;
	/** Where it is on by default. */
	on: string;
	settings: PluginSettingView[];
	/** What is installed now, for an update. */
	installed: { version: string; commit: string; ref: string | null } | null;
}
