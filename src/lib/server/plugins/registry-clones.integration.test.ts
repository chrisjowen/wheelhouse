import { execFileSync } from 'node:child_process';
import {
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
import { OFFICIAL_REGISTRY_REPO, REGISTRY_SCHEMA } from '../../plugins/marketplace';
import { Marketplace, REGISTRIES_FILE } from './marketplace';
import { readCloneFile, runGitTimed, syncClone } from './registry-clones';

/**
 * Wheelhouse's clones of plugin registries against local bare repositories
 * standing in for GitHub: cloning, resyncing as the registry moves forward or
 * is rewritten, and what a failure leaves. No network.
 */

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

const manifest = (plugins: string[]) =>
	JSON.stringify({
		schema: REGISTRY_SCHEMA,
		name: 'Acme',
		plugins: plugins.map((p) => ({
			name: p,
			description: `The ${p} plugin.`,
			repository: `acme/${p}`,
			icon: `icons/${p}.svg`
		}))
	});

let root: string;
let origin: string;
let work: string;
let clone: string;

/** Commit `files` to the registry's working copy and push them to its "GitHub". */
function publish(files: Record<string, string>, message = 'update', branch = 'main') {
	for (const [f, body] of Object.entries(files)) {
		mkdirSync(path.dirname(path.join(work, f)), { recursive: true });
		writeFileSync(path.join(work, f), body);
	}
	git(work, 'add', '-A');
	git(work, 'commit', '-q', '-m', message);
	git(work, 'push', '-q', '-f', 'origin', `HEAD:${branch}`);
	return git(work, 'rev-parse', 'HEAD');
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-registry-clone-'));
	origin = path.join(root, 'acme', 'plugins.git');
	work = path.join(root, 'work');
	clone = path.join(root, 'state', 'acme--plugins');
	mkdirSync(path.dirname(origin), { recursive: true });
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['init', '-q', '-b', 'main', work]);
	git(work, 'remote', 'add', 'origin', origin);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (file = 'wheelhouse-registry.json') => readFileSync(path.join(clone, file), 'utf8');

describe('a registry’s clone', () => {
	it('is a shallow clone of the default branch, read from disk', async () => {
		const commit = publish({
			'wheelhouse-registry.json': manifest(['a']),
			'icons/a.svg': '<svg/>'
		});
		const r = await syncClone(clone, origin, null, runGitTimed());
		expect(r).toEqual({ ok: true, commit });
		expect(read()).toBe(manifest(['a']));
		expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true');
		const icon = await readCloneFile(clone, 'icons/a.svg', 1024);
		expect(icon.ok && icon.body.toString()).toBe('<svg/>');
	});

	it('moves forward on resync, and follows a branch that was rewritten', async () => {
		publish({ 'wheelhouse-registry.json': manifest(['a']) });
		await syncClone(clone, origin, null, runGitTimed());
		const next = publish({ 'wheelhouse-registry.json': manifest(['a', 'b']) });
		expect(await syncClone(clone, origin, null, runGitTimed())).toEqual({ ok: true, commit: next });
		expect(read()).toBe(manifest(['a', 'b']));
		// Rewrite history: the branch no longer contains what the clone has.
		git(work, 'reset', '-q', '--hard', 'HEAD~1');
		const rewritten = publish({ 'wheelhouse-registry.json': manifest(['c']) }, 'rewrite');
		expect(await syncClone(clone, origin, null, runGitTimed())).toEqual({
			ok: true,
			commit: rewritten
		});
		expect(read()).toBe(manifest(['c']));
		expect(git(clone, 'status', '--porcelain')).toBe('');
	});

	it('reads a registry at a branch, and says when it has no such branch', async () => {
		publish({ 'wheelhouse-registry.json': manifest(['main-only']) });
		publish({ 'wheelhouse-registry.json': manifest(['stable']) }, 'stable', 'stable');
		expect((await syncClone(clone, origin, 'stable', runGitTimed())).ok).toBe(true);
		expect(read()).toBe(manifest(['stable']));
		const missing = await syncClone(path.join(root, 'other'), origin, 'nope', runGitTimed());
		expect(missing).toMatchObject({
			ok: false,
			notFound: true,
			error: expect.stringMatching(/no "nope" branch, tag or commit/)
		});
	});

	it('says there is no such repository, and leaves nothing behind', async () => {
		const r = await syncClone(clone, path.join(root, 'acme', 'missing.git'), null, runGitTimed());
		expect(r).toMatchObject({ ok: false, notFound: true });
		expect(existsSync(clone)).toBe(false);
		expect(existsSync(path.dirname(clone)) ? readdirSync(path.dirname(clone)) : []).toEqual([]);
	});

	it('keeps the last good copy when a resync fails', async () => {
		publish({ 'wheelhouse-registry.json': manifest(['a']) });
		await syncClone(clone, origin, null, runGitTimed());
		rmSync(origin, { recursive: true, force: true });
		const r = await syncClone(clone, origin, null, runGitTimed());
		expect(r.ok).toBe(false);
		expect(read()).toBe(manifest(['a']));
	});

	it('runs none of the registry’s hooks', async () => {
		publish({ 'wheelhouse-registry.json': manifest(['a']) });
		await syncClone(clone, origin, null, runGitTimed());
		const marker = path.join(root, 'ran');
		const hook = path.join(clone, '.git', 'hooks', 'post-checkout');
		mkdirSync(path.dirname(hook), { recursive: true });
		writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
		publish({ 'wheelhouse-registry.json': manifest(['b']) });
		expect((await syncClone(clone, origin, null, runGitTimed())).ok).toBe(true);
		expect(existsSync(marker)).toBe(false);
	});
});

describe('the marketplace over real clones', () => {
	it('reads every registry from its clone and resyncs on request', async () => {
		publish({ 'wheelhouse-registry.json': manifest(['a']), 'icons/a.svg': '<svg/>' });
		const official = path.join(root, OFFICIAL_REGISTRY_REPO + '.git');
		mkdirSync(path.dirname(official), { recursive: true });
		execFileSync('git', ['init', '-q', '--bare', '-b', 'main', official]);
		const configDir = path.join(root, 'config');
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			path.join(configDir, REGISTRIES_FILE),
			JSON.stringify({ registries: [OFFICIAL_REGISTRY_REPO] })
		);
		const m = new Marketplace({
			configDir,
			cacheDir: path.join(root, 'state', 'plugin-registries'),
			known: async () => [],
			gitUrl: (repo) => path.join(root, `${repo}.git`)
		});
		// The official registry is an empty repository: not published yet.
		expect((await m.view()).registries[0]).toMatchObject({ unpublished: true, error: null });
		expect(await m.addRegistry('acme/plugins')).toEqual({ ok: true, source: 'acme/plugins' });
		let v = await m.view();
		expect(v.plugins.map((p) => [p.name, p.registry])).toEqual([['a', 'acme/plugins']]);
		expect(new TextDecoder().decode((await m.icon('a'))!.body)).toBe('<svg/>');
		publish({ 'wheelhouse-registry.json': manifest(['a', 'b']) });
		expect((await m.view()).plugins).toHaveLength(1);
		v = await m.view({ refresh: true });
		expect(v.plugins.map((p) => p.name)).toEqual(['a', 'b']);
		expect(v.registries[1].syncError).toBeNull();
	});
});
