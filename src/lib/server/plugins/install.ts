import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PLUGINS_FILE, readPluginSettings, writePluginSettings } from './config';
import { readInstalled, writeInstalled, type InstalledRecord } from './installed';
import { manifestPath, parseManifest, type PluginManifest } from './manifest';
import { gatherSettings, parseGiven, type Ask } from './settings';

/**
 * `wheelhouse plugin install|update|configure|remove|enable|disable|list`:
 * installed plugins come from GitHub repositories, fetched at one tag, branch
 * or commit and kept at the exact commit that was fetched. Install and update
 * show the manifest and ask before anything is kept, then ask for the settings
 * the manifest declares and write them to the plugins file; nothing here runs
 * the plugin's code. A change loads when Wheelhouse restarts: each command that
 * makes one restarts any Wheelhouse running from the same plugins directory
 * (see cli/running.ts), else says it loads at the next start.
 */

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{7,40}$/;

export interface Source {
	org: string;
	repo: string;
	ref: string | null;
}

/** `org/repo` or `org/repo@ref`, or null. */
export function parseSource(spec: string): Source | null {
	const m = /^([^/@\s]+)\/([^/@\s]+?)(?:\.git)?(?:@(\S+))?$/.exec(spec.trim());
	if (!m || !NAME.test(m[1]) || !NAME.test(m[2]) || m[1].startsWith('-') || m[2].startsWith('.')) {
		return null;
	}
	const ref = m[3] ?? null;
	if (ref !== null && (ref.startsWith('-') || !/^[A-Za-z0-9_./-]+$/.test(ref))) return null;
	return { org: m[1], repo: m[2], ref };
}

export type Git = (
	args: string[],
	cwd: string
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** What asking running Wheelhouses to restart came to. */
export interface RestartOutcome {
	/** The address of each Wheelhouse that is restarting. */
	restarted: string[];
	/** Each one that is running but would not, and why. */
	failed: { url: string; reason: string }[];
}

export interface PluginCliDeps {
	/** Where installed plugins live. */
	dir: string;
	/** Wheelhouse's config directory, whose plugins file keeps each plugin's settings. */
	configDir: string;
	/** Where `org/repo` is fetched from; tests point it at a local repository. */
	gitUrl?: (s: Source) => string;
	git?: Git;
	/** Asks the captain, after showing the manifest; false refuses. */
	confirm(question: string): Promise<boolean>;
	/** Asks the captain for a setting; without it, settings take their defaults. */
	ask?: Ask;
	/** Restarts each running Wheelhouse that loads from `dir`; without it, the captain is told to. */
	restart?: () => Promise<RestartOutcome>;
	log(line: string): void;
	now?: () => Date;
}

const runGit: Git = (args, cwd) =>
	new Promise((resolve) => {
		execFile(
			'git',
			args,
			{
				cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
				maxBuffer: 4 * 1024 * 1024
			},
			(err, stdout, stderr) =>
				resolve({
					code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
					stdout: String(stdout),
					stderr: String(stderr)
				})
		);
	});

const githubUrl = (s: Source) => `https://github.com/${s.org}/${s.repo}.git`;
const short = (commit: string) => commit.slice(0, 12);
const label = (r: { repository: string; ref: string | null }) =>
	`${r.repository}${r.ref ? `@${r.ref}` : ''}`;

class Refused extends Error {}

/** Fetch `source` into the empty directory `into` at its ref, drop the git metadata, and return the commit. */
async function fetchSource(source: Source, into: string, deps: PluginCliDeps): Promise<string> {
	const git = deps.git ?? runGit;
	const url = (deps.gitUrl ?? githubUrl)(source);
	const step = async (args: string[]) => {
		const r = await git(args, into);
		if (r.code !== 0)
			throw new Refused(r.stderr.trim().split('\n').pop() || `git ${args[0]} failed`);
		return r.stdout.trim();
	};
	await step(['init', '-q']);
	const want = source.ref ?? 'HEAD';
	const shallow = await git(['fetch', '-q', '--depth', '1', url, want], into);
	if (shallow.code !== 0) {
		// A commit a server will not hand out shallowly: fetch its history and check it out.
		if (!source.ref || !SHA.test(source.ref)) {
			throw new Refused(
				`could not fetch ${source.org}/${source.repo}${source.ref ? ` at ${source.ref}` : ''}: ${shallow.stderr.trim().split('\n').pop() ?? ''}`
			);
		}
		await step(['fetch', '-q', url]);
		await step(['checkout', '-q', '--detach', source.ref]);
	} else {
		await step(['checkout', '-q', '--detach', 'FETCH_HEAD']);
	}
	const commit = await step(['rev-parse', 'HEAD']);
	await rm(path.join(into, '.git'), { recursive: true, force: true });
	return commit;
}

/** The fetched manifest, checked, with its entries present; or why the copy is not a plugin. */
async function checkCopy(dir: string): Promise<PluginManifest> {
	let text: string;
	try {
		text = await readFile(manifestPath(dir), 'utf8');
	} catch {
		throw new Refused('it has no .wheelhouse-plugin/plugin.json, so it is not a Wheelhouse plugin');
	}
	const parsed = parseManifest(text);
	if (!parsed.ok) throw new Refused(`its manifest is not valid: ${parsed.error}`);
	const m = parsed.manifest;
	const base = await realpath(dir);
	for (const [what, rel] of [
		['server entry', m.wheelhouse.server],
		['ui bundle', m.wheelhouse.ui]
	] as const) {
		if (!rel) continue;
		let file: string;
		try {
			file = await realpath(path.join(base, rel));
			if (!(await stat(file)).isFile()) throw new Error();
		} catch {
			throw new Refused(`its ${what} ${rel} is missing`);
		}
		if (!file.startsWith(base + path.sep))
			throw new Refused(`its ${what} leads outside the plugin`);
	}
	return m;
}

/** What the captain agrees to: who wrote it, where it comes from, what it adds and that it runs as them. */
export function describeManifest(m: PluginManifest, from: string, commit: string): string[] {
	const w = m.wheelhouse;
	const enabled = w.enabledWhenHomeFile
		? `while the Firstmate home has ${w.enabledWhenHomeFile}`
		: w.enabledWhenFile
			? `for projects whose clone has ${w.enabledWhenFile}`
			: w.enabledByDefault
				? 'for every project'
				: 'only where your plugins file turns it on';
	return [
		`${m.displayName} (${m.name}) ${m.version}`,
		...(m.description ? [`  ${m.description}`] : []),
		`  From:      ${from}`,
		`  Commit:    ${commit}`,
		...(m.author
			? [`  Author:    ${m.author.name}${m.author.url ? ` <${m.author.url}>` : ''}`]
			: []),
		...(m.repository ? [`  Homepage:  ${m.repository}`] : []),
		`  Contract:  plugin API ${w.apiVersion}`,
		`  Slots:     ${w.contributions.map((c) => `${c.slot} (${c.id})`).join(', ') || 'none'}`,
		`  Services:  ${w.services.map((s) => `${s.id} (${s.scope})`).join(', ') || 'none'}`,
		`  Settings:  ${w.settings.map((s) => `${s.key}${s.required ? ' (required)' : ''}`).join(', ') || 'none'}`,
		`  UI bundle: ${w.ui ?? 'none'}`,
		`  On:        ${enabled}`,
		'',
		'Its code runs with your permissions: its server entry inside Wheelhouse, and',
		'its UI bundle in Wheelhouse’s pages. Wheelhouse gives it read-only helpers, but',
		'does not sandbox it. Install only plugins you trust.'
	];
}

async function withStaging<T>(dir: string, work: (staging: string) => Promise<T>): Promise<T> {
	await mkdir(dir, { recursive: true });
	const staging = await mkdtemp(path.join(dir, '.staging-'));
	try {
		return await work(staging);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

export type Outcome = { ok: true } | { ok: false; error: string };

async function guarded(work: () => Promise<Outcome>): Promise<Outcome> {
	try {
		return await work();
	} catch (e) {
		if (e instanceof Refused) return { ok: false, error: e.message };
		throw e;
	}
}

function given(pairs: string[] | undefined): Record<string, string> {
	const g = parseGiven(pairs ?? []);
	if (!g.ok) throw new Refused(g.error);
	return g.given;
}

/**
 * The plugin's settings once the captain has answered for those its manifest
 * declares (all of them with `revisit`, else only those it has no value for),
 * or null when it declares none and none were given. Asks nobody with `yes`.
 */
async function settle(
	m: PluginManifest,
	deps: PluginCliDeps,
	o: { yes?: boolean; given: Record<string, string>; revisit: boolean }
): Promise<Record<string, unknown> | null> {
	if (!m.wheelhouse.settings.length && !Object.keys(o.given).length) return null;
	const current = await readPluginSettings(deps.configDir, m.name);
	if (!current.ok) throw new Refused(current.error);
	const r = await gatherSettings(m.name, m.wheelhouse.settings, {
		current: current.settings,
		given: o.given,
		ask: o.yes ? null : (deps.ask ?? null),
		revisit: o.revisit,
		intro: `${m.displayName} needs some settings (Enter keeps the one in brackets):`,
		log: deps.log
	});
	if (!r.ok) throw new Refused(r.error);
	return r.settings;
}

async function keepSettings(id: string, settings: Record<string, unknown>, deps: PluginCliDeps) {
	const w = await writePluginSettings(deps.configDir, id, settings);
	if (!w.ok) throw new Refused(`could not keep ${id}'s settings: ${w.error}`);
	deps.log(`Kept ${id}'s settings in ${path.join(deps.configDir, PLUGINS_FILE)}.`);
}

/** Restart each running Wheelhouse so the change loads now, or say when it will. */
async function reload(deps: PluginCliDeps, what: string) {
	if (!deps.restart) {
		deps.log(`Restart Wheelhouse to ${what}.`);
		return;
	}
	const r = await deps.restart();
	for (const url of r.restarted) deps.log(`Restarting Wheelhouse at ${url} to ${what}.`);
	for (const f of r.failed) {
		deps.log(`Could not restart Wheelhouse at ${f.url} (${f.reason}); restart it to ${what}.`);
	}
	if (!r.restarted.length && !r.failed.length) {
		deps.log(`Wheelhouse is not running; it will ${what} when it next starts.`);
	}
}

async function record(deps: PluginCliDeps) {
	const r = await readInstalled(deps.dir);
	if (!r.ok) throw new Refused(r.error);
	return r.installed;
}

/** Fetch, show, ask, then keep: `org/repo[@ref]`. */
export function install(
	spec: string,
	deps: PluginCliDeps,
	o: { yes?: boolean; settings?: string[] } = {}
): Promise<Outcome> {
	return guarded(async () => {
		const source = parseSource(spec);
		if (!source) throw new Refused(`"${spec}" is not org/repo or org/repo@ref`);
		const answers = given(o.settings);
		const installed = await record(deps);
		const repository = `${source.org}/${source.repo}`;
		return withStaging(deps.dir, async (staging) => {
			deps.log(`Fetching ${repository}${source.ref ? ` at ${source.ref}` : ''}…`);
			const commit = await fetchSource(source, staging, deps);
			const m = await checkCopy(staging);
			const target = path.join(deps.dir, m.name);
			if (installed.plugins[m.name]) {
				throw new Refused(
					`${m.name} is already installed from ${label(installed.plugins[m.name])}; use \`wheelhouse plugin update ${m.name}\``
				);
			}
			if (await exists(target)) {
				throw new Refused(`${target} already exists; remove it first`);
			}
			for (const line of describeManifest(
				m,
				`${repository}${source.ref ? ` (${source.ref})` : ''}`,
				commit
			))
				deps.log(line);
			if (!o.yes && !(await deps.confirm(`Install ${m.name}?`))) {
				throw new Refused('not installed');
			}
			const settings = await settle(m, deps, { yes: o.yes, given: answers, revisit: false });
			if (settings) await keepSettings(m.name, settings, deps);
			await rename(staging, target);
			installed.plugins[m.name] = {
				repository,
				ref: source.ref,
				commit,
				version: m.version,
				installedAt: (deps.now?.() ?? new Date()).toISOString(),
				enabled: true
			};
			await writeInstalled(deps.dir, installed);
			deps.log(`Installed ${m.name} ${m.version} at ${short(commit)}.`);
			await reload(deps, `load ${m.name}`);
			return { ok: true };
		});
	});
}

/** Fetch the recorded ref again (or a new one), show what changes, ask, then replace. */
export function update(
	id: string,
	deps: PluginCliDeps,
	o: { yes?: boolean; ref?: string; settings?: string[] } = {}
): Promise<Outcome> {
	return guarded(async () => {
		const answers = given(o.settings);
		const installed = await record(deps);
		const was = installed.plugins[id];
		if (!was) throw new Refused(`${id} is not installed`);
		const [org, repo] = was.repository.split('/');
		const source: Source = { org, repo, ref: o.ref ?? was.ref };
		if (!parseSource(`${org}/${repo}${source.ref ? `@${source.ref}` : ''}`)) {
			throw new Refused(`"${source.ref}" is not a ref`);
		}
		return withStaging(deps.dir, async (staging) => {
			deps.log(`Fetching ${was.repository}${source.ref ? ` at ${source.ref}` : ''}…`);
			const commit = await fetchSource(source, staging, deps);
			if (commit === was.commit) {
				if (source.ref !== was.ref) {
					installed.plugins[id] = { ...was, ref: source.ref };
					await writeInstalled(deps.dir, installed);
				}
				deps.log(`${id} is already at ${short(commit)}.`);
				return { ok: true };
			}
			const m = await checkCopy(staging);
			if (m.name !== id) {
				throw new Refused(`${was.repository} now names its plugin "${m.name}", not "${id}"`);
			}
			deps.log(
				`Update ${id} from ${was.version} (${short(was.commit)}) to ${m.version} (${short(commit)}):`
			);
			for (const line of describeManifest(
				m,
				`${was.repository}${source.ref ? ` (${source.ref})` : ''}`,
				commit
			))
				deps.log(line);
			if (!o.yes && !(await deps.confirm(`Update ${id}?`))) throw new Refused('not updated');
			const settings = await settle(m, deps, { yes: o.yes, given: answers, revisit: false });
			if (settings) await keepSettings(id, settings, deps);
			const target = path.join(deps.dir, id);
			const old = await mkdtemp(path.join(deps.dir, '.old-'));
			const parked = path.join(old, id);
			if (await exists(target)) await rename(target, parked);
			try {
				await rename(staging, target);
			} catch (e) {
				if (await exists(parked)) await rename(parked, target);
				throw e;
			} finally {
				await rm(old, { recursive: true, force: true });
			}
			installed.plugins[id] = {
				...was,
				ref: source.ref,
				commit,
				version: m.version,
				installedAt: (deps.now?.() ?? new Date()).toISOString()
			};
			await writeInstalled(deps.dir, installed);
			deps.log(`Updated ${id} to ${m.version} at ${short(commit)}.`);
			await reload(deps, `load ${id} ${m.version}`);
			return { ok: true };
		});
	});
}

/** Delete the plugin's copy and its record. */
export function remove(id: string, deps: PluginCliDeps): Promise<Outcome> {
	return guarded(async () => {
		if (!ID.test(id)) throw new Refused(`"${id}" is not a plugin id`);
		const installed = await record(deps);
		if (!installed.plugins[id]) throw new Refused(`${id} is not installed`);
		await rm(path.join(deps.dir, id), { recursive: true, force: true });
		delete installed.plugins[id];
		await writeInstalled(deps.dir, installed);
		deps.log(`Removed ${id}.`);
		await reload(deps, `unload ${id}`);
		return { ok: true };
	});
}

/** Turn an installed plugin on or off without removing it. */
export function setEnabled(id: string, enabled: boolean, deps: PluginCliDeps): Promise<Outcome> {
	return guarded(async () => {
		const installed = await record(deps);
		const r = installed.plugins[id];
		if (!r) throw new Refused(`${id} is not installed`);
		installed.plugins[id] = { ...r, enabled };
		await writeInstalled(deps.dir, installed);
		deps.log(`${id} is ${enabled ? 'on' : 'off'}.`);
		await reload(deps, `${enabled ? 'load' : 'unload'} ${id}`);
		return { ok: true };
	});
}

/**
 * Ask again for every setting an installed plugin declares, offering the ones
 * it has. Wheelhouse re-reads the plugins file as it changes, so this needs no
 * restart.
 */
export function configure(
	id: string,
	deps: PluginCliDeps,
	o: { yes?: boolean; settings?: string[] } = {}
): Promise<Outcome> {
	return guarded(async () => {
		const answers = given(o.settings);
		const installed = await record(deps);
		if (!installed.plugins[id]) throw new Refused(`${id} is not installed`);
		const m = await checkCopy(path.join(deps.dir, id));
		const settings = await settle(m, deps, { yes: o.yes, given: answers, revisit: true });
		if (!settings) {
			deps.log(`${id} declares no settings.`);
			return { ok: true };
		}
		await keepSettings(id, settings, deps);
		deps.log('Wheelhouse reads them as they change; nothing needs a restart.');
		return { ok: true };
	});
}

/** One line per installed plugin. */
export function list(deps: PluginCliDeps): Promise<Outcome> {
	return guarded(async () => {
		const installed = await record(deps);
		const rows = Object.entries(installed.plugins).sort(([a], [b]) => a.localeCompare(b));
		if (!rows.length) {
			deps.log(`No plugins installed in ${deps.dir}.`);
			return { ok: true };
		}
		const width = Math.max(...rows.map(([id]) => id.length));
		for (const [id, r] of rows) deps.log(row(id, r, width));
		return { ok: true };
	});
}

function row(id: string, r: InstalledRecord, width: number) {
	return `${id.padEnd(width)}  ${r.version.padEnd(8)}  ${r.enabled ? 'on ' : 'off'}  ${short(r.commit)}  ${label(r)}`;
}

async function exists(p: string) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}
