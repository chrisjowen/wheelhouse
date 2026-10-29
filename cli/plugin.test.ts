import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInstalled } from '../src/lib/server/plugins/installed';
import { loadInstalledPlugins } from '../src/lib/server/plugins/loader';
import { parseSource, type RestartOutcome, type Source } from '../src/lib/server/plugins/install';
import { pluginCommand } from './plugin';

/**
 * The plugin commands against a local repository standing in for GitHub: the
 * bundled Project links plugin, committed and tagged, fetched through a
 * `gitUrl` that points `acme/links` at it. Nothing touches the network, and
 * restarting a running Wheelhouse is a stand-in that records each call.
 */

const EXAMPLE = path.resolve('plugins/project-links');
const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', ['-C', cwd, ...args], {
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	})
		.toString()
		.trim();

let root: string;
let upstream: string;
let dir: string;
let configDir: string;
let lines: string[];
let answers: boolean[];
let replies: (string | null)[];
let asked: string[];
let restarts: number;
let restartOutcome: RestartOutcome;
/** A running Wheelhouse with work in progress, which restarts only when the command agrees. */
let busyAt: { url: string; busy: string[] } | null;

function cli(...args: string[]) {
	const cmd = pluginCommand({
		gitUrl: (s: Source) =>
			s.org === 'acme' && s.repo === 'links' ? upstream : path.join(root, 'nowhere'),
		confirm: async (q) => {
			asked.push(q);
			return answers.shift() ?? false;
		},
		ask: async (q) => {
			asked.push(q);
			return replies.shift() ?? null;
		},
		restart: async (proceed) => {
			restarts++;
			if (!busyAt) return restartOutcome;
			return (await proceed(busyAt.url, busyAt.busy))
				? { restarted: [busyAt.url], failed: [], kept: [] }
				: { restarted: [], failed: [], kept: [busyAt.url] };
		},
		log: (l) => lines.push(l)
	});
	cmd.exitOverride();
	process.exitCode = 0;
	return cmd.parseAsync(['--plugins-dir', dir, '--config-dir', configDir, ...args], {
		from: 'user'
	});
}

const pluginsFile = () => path.join(configDir, 'plugins.json');
const readPluginsFile = () => JSON.parse(readFileSync(pluginsFile(), 'utf8'));

/** Give the upstream plugin's manifest these declared settings, committed. */
function declareSettings(settings: Record<string, unknown>, message = 'settings') {
	const file = path.join(upstream, '.wheelhouse-plugin', 'plugin.json');
	const m = JSON.parse(readFileSync(file, 'utf8'));
	m.wheelhouse.settings = settings;
	writeFileSync(file, `${JSON.stringify(m, null, '\t')}\n`);
	git(upstream, 'commit', '-q', '-am', message);
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-plugin-cli-'));
	upstream = path.join(root, 'links');
	dir = path.join(root, 'plugins');
	configDir = path.join(root, 'config');
	cpSync(EXAMPLE, upstream, { recursive: true });
	git(root, 'init', '-q', '-b', 'main', upstream);
	git(upstream, 'add', '-A');
	git(upstream, 'commit', '-q', '-m', 'v0.2.0');
	git(upstream, 'tag', 'v0.2.0');
	lines = [];
	answers = [];
	replies = [];
	asked = [];
	restarts = 0;
	restartOutcome = { restarted: [], failed: [], kept: [] };
	busyAt = null;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	process.exitCode = 0;
});

describe('wheelhouse plugin install', () => {
	it('shows the manifest, asks, then installs at the exact commit', async () => {
		const tagged = git(upstream, 'rev-parse', 'HEAD');
		answers = [true];
		await cli('install', 'acme/links@v0.2.0');
		expect(process.exitCode).toBe(0);
		expect(asked).toEqual(['Install project-links?']);
		const shown = lines.join('\n');
		expect(shown).toContain('Project links (project-links) 0.2.0');
		expect(shown).toContain('From:      acme/links (v0.2.0)');
		expect(shown).toContain(`Commit:    ${tagged}`);
		expect(shown).toContain(
			'Slots:     project.tab (links), harbour.card (summary), task.section (task-links), step.evidence (compare), bridge.card (repo)'
		);
		expect(shown).toContain('Services:  none');
		expect(shown).toContain('Settings:  none');
		expect(shown).toContain('UI bundle: wheelhouse/ui/index.js');
		expect(shown).toContain('runs with your permissions');

		const r = await readInstalled(dir);
		expect(r).toMatchObject({
			ok: true,
			installed: {
				plugins: {
					'project-links': {
						repository: 'acme/links',
						ref: 'v0.2.0',
						commit: tagged,
						version: '0.2.0',
						enabled: true
					}
				}
			}
		});
		expect(existsSync(path.join(dir, 'project-links', '.wheelhouse-plugin', 'plugin.json'))).toBe(
			true
		);
		expect(existsSync(path.join(dir, 'project-links', '.git'))).toBe(false);
		expect(readdirSync(dir).sort()).toEqual(['installed.json', 'project-links']);
		// A plugin that declares no settings leaves the plugins file alone.
		expect(existsSync(pluginsFile())).toBe(false);
		expect(restarts).toBe(1);
		expect(lines.slice(-2)).toEqual([
			`Installed project-links 0.2.0 at ${tagged.slice(0, 12)}.`,
			'Wheelhouse is not running; it will load project-links when it next starts.'
		]);

		// And Wheelhouse loads what was installed.
		const loaded = await loadInstalledPlugins(dir);
		expect(loaded.installed.map((i) => [i.plugin.id, i.commit])).toEqual([
			['project-links', tagged]
		]);
	});

	it('keeps nothing when the captain declines', async () => {
		answers = [false];
		await cli('install', 'acme/links');
		expect(process.exitCode).toBe(1);
		expect(lines.at(-1)).toBe('wheelhouse: not installed.');
		expect(readdirSync(dir)).toEqual([]);
		expect(restarts).toBe(0);
	});

	it('installs without asking only with --yes', async () => {
		await cli('install', 'acme/links', '--yes');
		expect(asked).toEqual([]);
		expect(await installed()).toMatchObject({ repository: 'acme/links', ref: null });
	});

	it('refuses a repository that is not a Wheelhouse plugin, a bad source, or a second install', async () => {
		rmSync(path.join(upstream, '.wheelhouse-plugin'), { recursive: true });
		git(upstream, 'commit', '-q', '-am', 'not a plugin');
		await cli('install', 'acme/links', '--yes');
		expect(lines.at(-1)).toBe(
			'wheelhouse: it has no .wheelhouse-plugin/plugin.json, so it is not a Wheelhouse plugin.'
		);
		expect(process.exitCode).toBe(1);

		await cli('install', 'acme/links@v0.2.0', '--yes');
		expect(process.exitCode).toBe(0);
		await cli('install', 'acme/links@v0.2.0', '--yes');
		expect(lines.at(-1)).toMatch(
			/already installed from acme\/links@v0.2.0; use `wheelhouse plugin update project-links`/
		);

		await cli('install', 'not-a-repo', '--yes');
		expect(lines.at(-1)).toBe('wheelhouse: "not-a-repo" is not org/repo or org/repo@ref.');
		await cli('install', 'acme/missing', '--yes');
		expect(lines.at(-1)).toMatch(/^wheelhouse: could not fetch acme\/missing/);
		expect(readdirSync(dir).sort()).toEqual(['installed.json', 'project-links']);
	});

	it('refuses a manifest for a contract this Wheelhouse does not load', async () => {
		const file = path.join(upstream, '.wheelhouse-plugin', 'plugin.json');
		writeFileSync(file, readFileSync(file, 'utf8').replace('"apiVersion": 1', '"apiVersion": 9'));
		git(upstream, 'commit', '-q', '-am', 'future');
		await cli('install', 'acme/links', '--yes');
		expect(lines.at(-1)).toMatch(/its manifest is not valid: it was written for plugin contract 9/);
	});
});

describe('wheelhouse plugin list, update, enable, disable and remove', () => {
	beforeEach(async () => {
		await cli('install', 'acme/links@main', '--yes');
		lines = [];
	});

	it('lists what is installed and where it is pinned', async () => {
		const commit = git(upstream, 'rev-parse', 'HEAD');
		await cli('list');
		expect(lines).toEqual([
			`project-links  0.2.0     on   ${commit.slice(0, 12)}  acme/links@main`
		]);
	});

	it('updates to the ref’s new commit only after asking, and says when there is nothing new', async () => {
		await cli('update', 'project-links', '--yes');
		expect(lines.at(-1)).toMatch(/^project-links is already at [0-9a-f]{12}\.$/);

		const file = path.join(upstream, '.wheelhouse-plugin', 'plugin.json');
		writeFileSync(
			file,
			readFileSync(file, 'utf8').replace('"version": "0.2.0"', '"version": "0.3.0"')
		);
		git(upstream, 'commit', '-q', '-am', 'v0.3.0');
		const next = git(upstream, 'rev-parse', 'HEAD');

		answers = [false];
		await cli('update', 'project-links');
		expect(asked).toEqual(['Update project-links?']);
		expect(lines.at(-1)).toBe('wheelhouse: not updated.');
		expect((await installed()).version).toBe('0.2.0');

		answers = [true];
		await cli('update', 'project-links');
		expect(await installed()).toMatchObject({ version: '0.3.0', commit: next, ref: 'main' });
		expect(
			readFileSync(path.join(dir, 'project-links', '.wheelhouse-plugin', 'plugin.json'), 'utf8')
		).toContain('0.3.0');
		expect(readdirSync(dir).sort()).toEqual(['installed.json', 'project-links']);
	});

	it('records a new ref even when it names the commit already installed', async () => {
		await cli('update', 'project-links', '--ref', 'v0.2.0', '--yes');
		expect(lines.at(-1)).toMatch(/^project-links is already at [0-9a-f]{12}\.$/);
		expect((await installed()).ref).toBe('v0.2.0');
	});

	it('turns a plugin off and on, and the loader follows', async () => {
		await cli('disable', 'project-links');
		expect(lines.slice(-2)).toEqual([
			'project-links is off.',
			'Wheelhouse is not running; it will unload project-links when it next starts.'
		]);
		expect((await loadInstalledPlugins(dir)).problems).toMatchObject([
			{ id: 'project-links', state: 'disabled' }
		]);
		await cli('enable', 'project-links');
		expect((await loadInstalledPlugins(dir)).installed).toHaveLength(1);
	});

	it('removes the copy and its record', async () => {
		await cli('remove', 'project-links');
		expect(lines.slice(-2)).toEqual([
			'Removed project-links.',
			'Wheelhouse is not running; it will unload project-links when it next starts.'
		]);
		expect(readdirSync(dir)).toEqual(['installed.json']);
		lines = [];
		await cli('list');
		expect(lines).toEqual([`No plugins installed in ${dir}.`]);
		await cli('remove', 'project-links');
		expect(lines.at(-1)).toBe('wheelhouse: project-links is not installed.');
		expect(process.exitCode).toBe(1);
	});
});

describe('restarting Wheelhouse after a change', () => {
	it('restarts each running Wheelhouse, and says which would not', async () => {
		restartOutcome = {
			restarted: ['http://127.0.0.1:4310/'],
			failed: [{ url: 'http://127.0.0.1:4311/', reason: 'it answered 403' }],
			kept: []
		};
		await cli('install', 'acme/links', '--yes');
		expect(process.exitCode).toBe(0);
		expect(lines.slice(-2)).toEqual([
			'Restarting Wheelhouse at http://127.0.0.1:4310/ to load project-links.',
			'Could not restart Wheelhouse at http://127.0.0.1:4311/ (it answered 403); restart it to load project-links.'
		]);
	});

	it('names the work a restart would stop and asks first', async () => {
		await cli('install', 'acme/links', '--yes');
		const url = 'http://127.0.0.1:4310/';
		busyAt = {
			url,
			busy: ['a PR review agent on t-1', 'the docket-viewer service, still starting']
		};
		lines = [];
		asked = [];
		answers = [false];
		await cli('disable', 'project-links');
		expect(process.exitCode).toBe(0);
		expect(asked).toEqual(['Restart it now?']);
		expect(lines).toEqual([
			'project-links is off.',
			`Restarting Wheelhouse at ${url} stops what it is running:`,
			'  - a PR review agent on t-1',
			'  - the docket-viewer service, still starting',
			`Left Wheelhouse at ${url} running; restart it to unload project-links.`
		]);

		lines = [];
		answers = [true];
		await cli('enable', 'project-links');
		expect(lines.at(-1)).toBe(`Restarting Wheelhouse at ${url} to load project-links.`);
	});

	it('restarts mid-work with --yes, still saying what it stops', async () => {
		await cli('install', 'acme/links', '--yes');
		const url = 'http://127.0.0.1:4310/';
		busyAt = { url, busy: ['a PR review agent on t-1'] };
		lines = [];
		asked = [];
		await cli('remove', 'project-links', '--yes');
		expect(asked).toEqual([]);
		expect(lines).toEqual([
			'Removed project-links.',
			`Restarting Wheelhouse at ${url} stops what it is running:`,
			'  - a PR review agent on t-1',
			`Restarting Wheelhouse at ${url} to unload project-links.`
		]);
	});

	it('does not restart when an update finds nothing new', async () => {
		await cli('install', 'acme/links', '--yes');
		await cli('update', 'project-links', '--yes');
		expect(restarts).toBe(1);
	});
});

describe('gathering the settings a plugin declares', () => {
	const SETTINGS = {
		board: {
			title: 'Board URL',
			description: "Where the team's board lives.",
			required: true
		},
		timeoutMs: { title: 'Timeout (ms)', type: 'number', default: 8000 },
		verbose: { title: 'Verbose', type: 'boolean' }
	};

	it('shows them, asks for each after the captain agrees, and keeps the answers', async () => {
		declareSettings(SETTINGS);
		// The captain's own entries in the plugins file stay as they were.
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			pluginsFile(),
			JSON.stringify({ plugins: { docket: { settings: { bin: '/bin/docket' } } } })
		);
		answers = [true];
		replies = ['', 'https://board.test', 'soon', '5000', ''];
		await cli('install', 'acme/links');
		expect(process.exitCode).toBe(0);
		expect(lines.join('\n')).toContain('Settings:  board (required), timeoutMs, verbose');
		expect(asked).toEqual([
			'Install project-links?',
			'Board URL: ',
			'Board URL: ',
			'Timeout (ms) (optional) [8000]: ',
			'Timeout (ms) (optional) [8000]: ',
			'Verbose (optional) (y/n): '
		]);
		expect(lines).toContain("  Where the team's board lives.");
		expect(lines).toContain('  Board URL is needed.');
		expect(lines).toContain('  Timeout (ms) must be a number.');
		expect(readPluginsFile()).toEqual({
			plugins: {
				docket: { settings: { bin: '/bin/docket' } },
				'project-links': { settings: { board: 'https://board.test', timeoutMs: 5000 } }
			}
		});
		expect(lines).toContain(`Kept project-links's settings in ${pluginsFile()}.`);
		expect(await installed()).toMatchObject({ version: '0.2.0' });
	});

	it('with --yes, takes defaults and --setting answers, and refuses a required one it lacks', async () => {
		declareSettings(SETTINGS);
		await cli('install', 'acme/links', '--yes');
		expect(process.exitCode).toBe(1);
		expect(lines.at(-1)).toBe(
			'wheelhouse: project-links needs Board URL; pass --setting board=<value>.'
		);
		expect(existsSync(path.join(dir, 'project-links'))).toBe(false);
		expect(existsSync(pluginsFile())).toBe(false);

		await cli(
			'install',
			'acme/links',
			'--yes',
			'--setting',
			'board=https://b.test',
			'-s',
			'verbose=yes'
		);
		expect(process.exitCode).toBe(0);
		expect(asked).toEqual([]);
		expect(readPluginsFile().plugins['project-links'].settings).toEqual({
			board: 'https://b.test',
			timeoutMs: 8000,
			verbose: true
		});
	});

	it('refuses a --setting the plugin does not declare, or one that does not fit', async () => {
		declareSettings(SETTINGS);
		await cli('install', 'acme/links', '--yes', '-s', 'board=x', '-s', 'colour=red');
		expect(lines.at(-1)).toBe('wheelhouse: project-links has no setting "colour".');
		await cli('install', 'acme/links', '--yes', '-s', 'board=x', '-s', 'timeoutMs=soon');
		expect(lines.at(-1)).toBe('wheelhouse: --setting timeoutMs: Timeout (ms) must be a number.');
		await cli('install', 'acme/links', '--yes', '-s', 'board');
		expect(lines.at(-1)).toBe('wheelhouse: --setting "board" is not key=value.');
		expect(existsSync(path.join(dir, 'project-links'))).toBe(false);
	});

	it('keeps settings already in the plugins file, and asks nothing it knows', async () => {
		declareSettings(SETTINGS);
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			pluginsFile(),
			JSON.stringify({
				plugins: {
					'project-links': { enabled: true, settings: { board: 'https://old.test', extra: 1 } }
				}
			})
		);
		answers = [true];
		replies = ['', 'n'];
		await cli('install', 'acme/links');
		expect(asked).toEqual([
			'Install project-links?',
			'Timeout (ms) (optional) [8000]: ',
			'Verbose (optional) (y/n): '
		]);
		expect(readPluginsFile().plugins['project-links']).toEqual({
			enabled: true,
			settings: { board: 'https://old.test', extra: 1, timeoutMs: 8000, verbose: false }
		});
	});

	it('refuses to install over a plugins file it cannot read', async () => {
		declareSettings(SETTINGS);
		mkdirSync(configDir, { recursive: true });
		writeFileSync(pluginsFile(), '{ nope');
		await cli('install', 'acme/links', '--yes', '-s', 'board=x');
		expect(lines.at(-1)).toMatch(/^wheelhouse: .*plugins\.json is not valid: not valid JSON/);
		expect(readFileSync(pluginsFile(), 'utf8')).toBe('{ nope');
		expect(existsSync(path.join(dir, 'project-links'))).toBe(false);
	});

	it('asks at update only for settings the new version adds', async () => {
		declareSettings({ board: SETTINGS.board });
		await cli('install', 'acme/links', '--yes', '-s', 'board=https://b.test');
		declareSettings({ board: SETTINGS.board, region: { title: 'Region', required: true } }, 'v2');
		answers = [true];
		replies = ['eu'];
		asked = [];
		await cli('update', 'project-links');
		expect(process.exitCode).toBe(0);
		expect(asked).toEqual(['Update project-links?', 'Region: ']);
		expect(readPluginsFile().plugins['project-links'].settings).toEqual({
			board: 'https://b.test',
			region: 'eu'
		});
	});

	it('stops without keeping anything when the terminal goes away mid-question', async () => {
		declareSettings(SETTINGS);
		answers = [true];
		replies = [null];
		await cli('install', 'acme/links');
		expect(lines.at(-1)).toBe('wheelhouse: stopped before Board URL was answered.');
		expect(existsSync(path.join(dir, 'project-links'))).toBe(false);
		expect(existsSync(pluginsFile())).toBe(false);
	});
});

describe('plugin sources', () => {
	it('reads org/repo with an optional ref, and refuses anything else', () => {
		expect(parseSource('acme/links')).toEqual({ org: 'acme', repo: 'links', ref: null });
		expect(parseSource('acme/links.git@v1.2.0')).toEqual({
			org: 'acme',
			repo: 'links',
			ref: 'v1.2.0'
		});
		expect(parseSource('acme/links@feature/x')).toEqual({
			org: 'acme',
			repo: 'links',
			ref: 'feature/x'
		});
		for (const bad of [
			'acme',
			'acme/links/extra',
			'-x/links',
			'acme/links@--upload-pack=x',
			'a b/c',
			'acme/..'
		]) {
			expect(parseSource(bad), bad).toBeNull();
		}
	});
});

async function installed() {
	const r = await readInstalled(dir);
	if (!r.ok) throw new Error(r.error);
	return r.installed.plugins['project-links'];
}
