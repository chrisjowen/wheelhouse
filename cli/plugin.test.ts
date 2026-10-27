import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
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
import { parseSource, type Source } from '../src/lib/server/plugins/install';
import { pluginCommand } from './plugin';

/**
 * The plugin commands against a local repository standing in for GitHub: the
 * bundled Project links plugin, committed and tagged, fetched through a
 * `gitUrl` that points `acme/links` at it. Nothing touches the network.
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
let lines: string[];
let answers: boolean[];
let asked: string[];

function cli(...args: string[]) {
	const cmd = pluginCommand({
		gitUrl: (s: Source) =>
			s.org === 'acme' && s.repo === 'links' ? upstream : path.join(root, 'nowhere'),
		confirm: async (q) => {
			asked.push(q);
			return answers.shift() ?? false;
		},
		log: (l) => lines.push(l)
	});
	cmd.exitOverride();
	process.exitCode = 0;
	return cmd.parseAsync(['--plugins-dir', dir, ...args], { from: 'user' });
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-plugin-cli-'));
	upstream = path.join(root, 'links');
	dir = path.join(root, 'plugins');
	cpSync(EXAMPLE, upstream, { recursive: true });
	git(root, 'init', '-q', '-b', 'main', upstream);
	git(upstream, 'add', '-A');
	git(upstream, 'commit', '-q', '-m', 'v0.2.0');
	git(upstream, 'tag', 'v0.2.0');
	lines = [];
	answers = [];
	asked = [];
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
		expect(lines.at(-1)).toBe('project-links is off. Restart Wheelhouse to unload it.');
		expect((await loadInstalledPlugins(dir)).problems).toMatchObject([
			{ id: 'project-links', state: 'disabled' }
		]);
		await cli('enable', 'project-links');
		expect((await loadInstalledPlugins(dir)).installed).toHaveLength(1);
	});

	it('removes the copy and its record', async () => {
		await cli('remove', 'project-links');
		expect(lines.at(-1)).toBe('Removed project-links. Restart Wheelhouse to unload it.');
		expect(readdirSync(dir)).toEqual(['installed.json']);
		lines = [];
		await cli('list');
		expect(lines).toEqual([`No plugins installed in ${dir}.`]);
		await cli('remove', 'project-links');
		expect(lines.at(-1)).toBe('wheelhouse: project-links is not installed.');
		expect(process.exitCode).toBe(1);
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
