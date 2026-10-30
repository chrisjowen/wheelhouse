import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readInstalled, writeInstalled } from '../plugins/installed';
import type { Source } from '../plugins/install';
import { setRestart } from '../restart';
import { CHECK_EVERY_MS, UpdateService } from './service';

/**
 * The update service against local repositories standing in for GitHub: a
 * Wheelhouse clone of a bare origin, and the bundled Project links plugin as
 * `acme/links`. npm and the server's own restart are stand-ins.
 */

const EXAMPLE = path.resolve('plugins/project-links');
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@t',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@t'
};
const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim();

let root: string;
let links: string;
let restarts: number;
let now: number;
let ran: string[];

function service(over: Record<string, string> = {}) {
	return new UpdateService({
		env: {
			WHEELHOUSE_PLUGINS_DIR: path.join(root, 'plugins'),
			WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'),
			...over
		},
		plugins: {
			gitUrl: (s: Source) =>
				s.org === 'acme' && s.repo === 'links' ? links : path.join(root, 'nowhere')
		},
		clone: {
			run: async (cmd, args) => {
				ran.push([cmd, ...args].join(' '));
				return { code: 0, output: '' };
			}
		},
		busy: async () => ['a PR review agent on wheelhouse#70'],
		now: () => now,
		log: () => {}
	});
}

function commitLinks(message: string) {
	const file = path.join(links, 'README.md');
	writeFileSync(file, `${message}\n`);
	git(links, 'add', 'README.md');
	git(links, 'commit', '-q', '-m', message);
	return git(links, 'rev-parse', 'HEAD');
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-updates-'));
	links = path.join(root, 'links');
	cpSync(EXAMPLE, links, { recursive: true });
	git(root, 'init', '-q', '-b', 'main', links);
	git(links, 'add', '-A');
	git(links, 'commit', '-q', '-m', 'v0.2.0');
	git(links, 'tag', 'v0.2.0');
	restarts = 0;
	ran = [];
	now = Date.parse('2026-10-30T09:00:00Z');
	setRestart(() => restarts++);
	vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => {
	vi.useRealTimers();
	setRestart(null);
	rmSync(root, { recursive: true, force: true });
});

async function lookUpAndInstall(s: UpdateService, ref: string | null) {
	const p = await s.inspectInstall('acme/links', ref);
	if (!p.ok) throw new Error(p.error);
	const r = await s.installPlugin({
		repo: 'acme/links',
		ref,
		commit: p.preview.commit,
		settings: {}
	});
	expect(r).toEqual({ ok: true, restarting: true });
	vi.runAllTimers();
	return p.preview;
}

describe('installing from a page', () => {
	it('looks a plugin up without installing it', async () => {
		const s = service();
		const p = await s.inspectInstall('acme/links', 'v0.2.0');
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		expect(p.preview).toMatchObject({
			id: 'project-links',
			version: '0.2.0',
			repository: 'acme/links',
			ref: 'v0.2.0',
			commit: git(links, 'rev-parse', 'HEAD'),
			installed: null
		});
		expect(p.preview.slots).toContain('project.tab');
		const r = await readInstalled(path.join(root, 'plugins'));
		expect(r.ok && Object.keys(r.installed.plugins)).toEqual([]);
	});

	it('says why a repository is not a plugin', async () => {
		const p = await service().inspectInstall('acme/other', null);
		expect(p.ok).toBe(false);
		if (!p.ok) expect(p.error).toMatch(/could not fetch acme\/other/);
	});

	it('installs exactly the commit it showed, then restarts', async () => {
		const s = service();
		const shown = await lookUpAndInstall(s, null);
		expect(restarts).toBe(1);
		const r = await readInstalled(path.join(root, 'plugins'));
		expect(r.ok && r.installed.plugins['project-links'].commit).toBe(shown.commit);
	});

	it('refuses when the repository moved on since the look-up', async () => {
		const s = service();
		const p = await s.inspectInstall('acme/links', null);
		if (!p.ok) throw new Error(p.error);
		commitLinks('moved');
		const r = await s.installPlugin({
			repo: 'acme/links',
			ref: null,
			commit: p.preview.commit,
			settings: {}
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/is at \w+ now, not \w+ as when you looked/);
		expect(restarts).toBe(0);
		// A refused change does not hold the next one back.
		expect((await lookUpAndInstall(s, null)).id).toBe('project-links');
	});

	it('keeps the settings the page sent', async () => {
		const file = path.join(links, '.wheelhouse-plugin', 'plugin.json');
		const m = JSON.parse(readFileSync(file, 'utf8'));
		m.wheelhouse.settings = { token: { title: 'Token', required: true } };
		writeFileSync(file, JSON.stringify(m));
		git(links, 'commit', '-q', '-am', 'settings');
		const s = service();
		const p = await s.inspectInstall('acme/links', null);
		if (!p.ok) throw new Error(p.error);
		expect(p.preview.settings).toMatchObject([{ key: 'token', required: true }]);
		const r = await s.installPlugin({
			repo: 'acme/links',
			ref: null,
			commit: p.preview.commit,
			settings: { token: 'abc' }
		});
		expect(r.ok).toBe(true);
		const kept = JSON.parse(readFileSync(path.join(root, 'config', 'plugins.json'), 'utf8'));
		expect(kept.plugins['project-links'].settings).toEqual({ token: 'abc' });
	});

	it('refuses to change anything when the server cannot restart itself', async () => {
		setRestart(null);
		const s = service();
		const p = await s.inspectInstall('acme/links', null);
		if (!p.ok) throw new Error(p.error);
		const r = await s.installPlugin({
			repo: 'acme/links',
			ref: null,
			commit: p.preview.commit,
			settings: {}
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/not started by `wheelhouse open`/);
	});
});

describe('loading a plugin that is turned off, from its page', () => {
	it('turns it back on, then restarts to load it', async () => {
		const plugins = path.join(root, 'plugins');
		await lookUpAndInstall(service(), null);
		const before = await readInstalled(plugins);
		if (!before.ok) throw new Error(before.error);
		before.installed.plugins['project-links'].enabled = false;
		await writeInstalled(plugins, before.installed);
		const s = service();
		expect(await s.loadPlugin('project-links')).toEqual({ ok: true, restarting: true });
		vi.runAllTimers();
		expect(restarts).toBe(2);
		const after = await readInstalled(plugins);
		expect(after.ok && after.installed.plugins['project-links'].enabled).toBe(true);
		const other = await service().loadPlugin('nope');
		expect(other).toEqual({ ok: false, error: 'nope is not installed' });
	});
});

describe('plugin updates', () => {
	it('finds new commits on the branch a plugin was installed from, and updates to them', async () => {
		const s = service();
		await lookUpAndInstall(s, null);
		s.reset();
		expect((await s.checkPlugins()).plugins[0]).toMatchObject({ state: 'current' });
		const next = commitLinks('newer');
		expect((await s.checkPlugins()).plugins[0]).toMatchObject({
			id: 'project-links',
			state: 'available',
			latest: { ref: null, commit: next }
		});
		const p = await s.inspectUpdate('project-links', null);
		if (!p.ok) throw new Error(p.error);
		expect(p.preview.installed?.commit).not.toBe(next);
		const r = await s.updatePlugin('project-links', {
			ref: null,
			commit: p.preview.commit,
			settings: {}
		});
		expect(r.ok).toBe(true);
		const rec = await readInstalled(path.join(root, 'plugins'));
		expect(rec.ok && rec.installed.plugins['project-links'].commit).toBe(next);
	});

	it('offers a newer release tag to a plugin installed at a tag, and moves it there', async () => {
		const s = service();
		await lookUpAndInstall(s, 'v0.2.0');
		s.reset();
		const next = commitLinks('release');
		git(links, 'tag', 'v0.3.0');
		const v = (await s.checkPlugins()).plugins[0];
		expect(v).toMatchObject({ state: 'newer-tag', latest: { ref: 'v0.3.0', commit: next } });
		const p = await s.inspectUpdate('project-links', 'v0.3.0');
		if (!p.ok) throw new Error(p.error);
		const r = await s.updatePlugin('project-links', {
			ref: 'v0.3.0',
			commit: p.preview.commit,
			settings: {}
		});
		expect(r.ok).toBe(true);
		const rec = await readInstalled(path.join(root, 'plugins'));
		expect(rec.ok && rec.installed.plugins['project-links']).toMatchObject({
			ref: 'v0.3.0',
			commit: next
		});
	});

	it('does not check a plugin pinned to a commit', async () => {
		const s = service();
		const sha = git(links, 'rev-parse', 'HEAD');
		await lookUpAndInstall(s, sha);
		s.reset();
		commitLinks('newer');
		expect((await s.checkPlugins()).plugins[0]).toMatchObject({ state: 'pinned', latest: null });
	});

	it('keeps a check for six hours, then checks again when a page asks', async () => {
		const s = service();
		await lookUpAndInstall(s, null);
		s.reset();
		await s.checkPlugins();
		const first = (await s.plugins()).checkedAt;
		now += CHECK_EVERY_MS - 1;
		expect((await s.plugins()).checking).toBe(false);
		now += 1;
		const v = await s.plugins();
		expect(v.checking).toBe(true);
		expect(v.checkedAt).toBe(first);
		expect(v.busy).toEqual(['a PR review agent on wheelhouse#70']);
	});
});

describe('upgrading Wheelhouse from a page', () => {
	let clone: string;
	let upstream: string;
	beforeEach(() => {
		const origin = path.join(root, 'origin.git');
		upstream = path.join(root, 'wh-upstream');
		clone = path.join(root, 'wh');
		execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
		execFileSync('git', ['clone', '-q', origin, upstream], { stdio: 'ignore' });
		git(upstream, 'checkout', '-q', '-b', 'main');
		writeFileSync(path.join(upstream, 'package.json'), '{"version":"0.1.0"}');
		git(upstream, 'add', '-A');
		git(upstream, 'commit', '-q', '-m', 'start');
		git(upstream, 'push', '-q', 'origin', 'main');
		execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
		writeFileSync(path.join(upstream, 'package.json'), '{"version":"0.2.0"}');
		git(upstream, 'commit', '-q', '-am', 'feat: two');
		git(upstream, 'push', '-q', 'origin', 'main');
	});

	/** The upgrade's state once it stops running (git runs for real, so this takes a moment). */
	const settle = async (s: UpdateService) => {
		const until = performance.now() + 15_000;
		while (performance.now() < until) {
			const v = await s.wheelhouse();
			if (v.job?.state !== 'running') return v;
			await new Promise((r) => setImmediate(r));
		}
		throw new Error('the upgrade did not finish');
	};

	it('runs the upgrade, then restarts', async () => {
		const s = service({ WHEELHOUSE_INSTALL_DIR: clone });
		expect((await s.checkWheelhouse()).state).toBe('available');
		expect(s.startUpgrade()).toEqual({ ok: true });
		expect(s.startUpgrade()).toEqual({
			ok: false,
			error: 'Wait for the Wheelhouse upgrade to finish.'
		});
		const v = await settle(s);
		expect(v.job).toMatchObject({ state: 'restarting', step: 'restart' });
		expect(ran).toEqual(['npm ci', 'npm run build']);
		vi.runAllTimers();
		expect(restarts).toBe(1);
	});

	it('reports a refused upgrade on the job and changes nothing', async () => {
		writeFileSync(path.join(clone, 'package.json'), '{}');
		const s = service({ WHEELHOUSE_INSTALL_DIR: clone });
		expect(s.startUpgrade()).toEqual({ ok: true });
		const v = await settle(s);
		expect(v.job).toMatchObject({ state: 'failed' });
		expect(v.job?.error).toMatch(/local changes/);
		expect(v.check?.changes).toEqual([' M package.json']);
		expect(ran).toEqual([]);
		expect(restarts).toBe(0);
		// A check that is merely due leaves the failure showing; checking now clears it.
		now += CHECK_EVERY_MS;
		await s.wheelhouse();
		await s.checkWheelhouse();
		expect((await s.wheelhouse()).job?.state).toBe('failed');
		await s.checkWheelhouseNow();
		expect((await s.wheelhouse()).job).toBeNull();
	});

	it('cannot upgrade a Wheelhouse that does not know where it is installed', async () => {
		const s = service();
		expect((await s.checkWheelhouse()).state).toBe('unsupported');
		expect(s.startUpgrade().ok).toBe(false);
	});
});
