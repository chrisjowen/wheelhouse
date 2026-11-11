import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRestart } from '../restart';
import { UpdateService } from './service';
import { handoffFile, takeHandoff } from './settings';

/**
 * The update source: how Wheelhouse checks, upgrades and switches itself, with
 * npm and git stood in. `npm view` answers `published`, `npm root -g` answers
 * `globalRoot`, `npm install -g` exits `installCode`; `git clone` makes the
 * directory it is given.
 */

let root: string;
let install: string;
let config: string;
let globalRoot: string;
let restarts: number;
let npmCalls: string[];
let gitCalls: string[];
let published: string;
let installCode: number;

const settingsFile = () => path.join(config, 'update', 'settings.json');
const writeSource = (source: string) =>
	writeFileSync(
		settingsFile(),
		JSON.stringify({ schema: 'wheelhouse-update-settings.v1', source }) + '\n'
	);
const savedSource = () => {
	try {
		return JSON.parse(readFileSync(settingsFile(), 'utf8')).source as string | null;
	} catch {
		return null;
	}
};
const handoff = () => {
	try {
		return readFileSync(handoffFile(config), 'utf8').trim();
	} catch {
		return null;
	}
};

function svc() {
	const npmLog = npmCalls;
	const gitLog = gitCalls;
	return new UpdateService({
		env: { WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_INSTALL_DIR: install },
		npm: async (cmd, args, cwd) => {
			npmLog.push([cmd, ...args].join(' ') + (cwd ? ` @ ${cwd}` : ''));
			if (args[0] === 'view') return { code: 0, output: `${published}\n` };
			if (args[0] === 'root') return { code: 0, output: `${globalRoot}\n` };
			if (args[0] === 'install') return { code: installCode, output: installCode ? 'EACCES' : '' };
			return { code: 0, output: '' };
		},
		clone: {
			git: async (args) => {
				gitLog.push(args.join(' '));
				if (args[0] === 'clone') {
					mkdirSync(path.join(args[args.length - 1], '.git'), { recursive: true });
					return { code: 0, stdout: '', stderr: '' };
				}
				return { code: 1, stdout: '', stderr: 'offline' };
			}
		},
		busy: async () => [],
		log: () => {}
	});
}

/** Make the install directory a git clone, as `detectInstallKind` sees one. */
const makeClone = () => mkdirSync(path.join(install, '.git'));

/** The job's state once it stops running. */
const settle = async (s: UpdateService) => {
	await vi.waitFor(async () => expect((await s.wheelhouse()).job?.state).not.toBe('running'));
	return s.wheelhouse();
};

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-src-'));
	install = path.join(root, 'wheelhouse');
	config = path.join(root, 'config');
	globalRoot = path.join(root, 'global', 'lib', 'node_modules');
	mkdirSync(install);
	writeFileSync(path.join(install, 'package.json'), '{"version":"0.5.0"}');
	mkdirSync(path.join(config, 'update'), { recursive: true });
	restarts = 0;
	npmCalls = [];
	gitCalls = [];
	published = '0.6.0';
	installCode = 0;
	setRestart(() => restarts++);
	vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
	setRestart(null);
	rmSync(root, { recursive: true, force: true });
});

describe('the source before one is chosen', () => {
	it('is published for an npm install', async () => {
		expect((await svc().wheelhouse()).source).toBe('published');
	});

	it('is github for a clone, so an existing clone keeps its updater', async () => {
		makeClone();
		const v = await svc().wheelhouse();
		expect(v).toMatchObject({ source: 'github', installKind: 'clone', mismatch: false });
	});

	it('is what was chosen, once chosen', async () => {
		makeClone();
		writeSource('published');
		expect((await svc().wheelhouse()).source).toBe('published');
	});
});

describe('published source on an npm install', () => {
	it('the header check reports the newer published version', async () => {
		const s = svc();
		expect(await s.checkWheelhouse()).toMatchObject({
			state: 'available',
			current: { version: '0.5.0' },
			latest: { version: '0.6.0' }
		});
		expect((await s.wheelhouse()).check?.state).toBe('available');
	});

	it('checks npm only when the last check is stale', async () => {
		const s = svc();
		await s.checkWheelhouse();
		await s.wheelhouse();
		await s.wheelhouse();
		expect(npmCalls.filter((c) => c.startsWith('npm view'))).toHaveLength(1);
	});

	it('upgrades with npm install -g to the checked version, shows npm steps, then restarts into the global install', async () => {
		const s = svc();
		await s.checkWheelhouse();
		expect(await s.startUpgrade()).toEqual({ ok: true });
		expect((await s.wheelhouse()).job?.steps.map((x) => x.step)).toEqual([
			'npm-install',
			'restart'
		]);
		const v = await settle(s);
		expect(v.job?.state).toBe('restarting');
		expect(npmCalls).toContain('npm install -g @chrisjowen/wheelhouse@0.6.0');
		expect(handoff()).toBe(path.join(globalRoot, '@chrisjowen', 'wheelhouse'));
		vi.runAllTimers();
		expect(restarts).toBe(1);
	});

	it('leaves no handoff when it already runs from the global install', async () => {
		install = path.join(globalRoot, '@chrisjowen', 'wheelhouse');
		mkdirSync(install, { recursive: true });
		const s = svc();
		await s.startUpgrade();
		expect((await settle(s)).job?.state).toBe('restarting');
		expect(handoff()).toBeNull();
	});
});

describe('a source that does not match the install', () => {
	it('published on a clone: says so, and the header never npm installs over the clone', async () => {
		makeClone();
		writeSource('published');
		const s = svc();
		expect((await s.checkWheelhouse()).state).toBe('unsupported');
		expect((await s.wheelhouse()).mismatch).toBe(true);
		const r = await s.startUpgrade();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/runs from a git clone/);
		expect(npmCalls).toEqual([]);
	});

	it('github on an npm install: says so and refuses the header upgrade', async () => {
		writeSource('github');
		const s = svc();
		expect((await s.wheelhouse()).mismatch).toBe(true);
		const r = await s.startUpgrade();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/installed from npm/);
	});
});

describe('switching to published', () => {
	it('from a clone: npm installs, saves the source, restarts into the global install, leaves the clone', async () => {
		makeClone();
		const s = svc();
		expect(await s.setSource('published')).toEqual({ ok: true });
		const v = await settle(s);
		expect(v.job?.state).toBe('restarting');
		expect(npmCalls).toContain('npm install -g @chrisjowen/wheelhouse');
		expect(savedSource()).toBe('published');
		expect(handoff()).toBe(path.join(globalRoot, '@chrisjowen', 'wheelhouse'));
		expect(gitCalls).toEqual([]);
		expect(existsSync(path.join(install, '.git'))).toBe(true);
		vi.runAllTimers();
		expect(restarts).toBe(1);
		const again = await s.startUpgrade();
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error).toMatch(/^Wait for/);
	});

	it('keeps the old source when npm install fails, and lets the captain try again', async () => {
		makeClone();
		installCode = 243;
		const s = svc();
		expect(await s.setSource('published')).toEqual({ ok: true });
		const v = await settle(s);
		expect(v.job).toMatchObject({ state: 'failed', output: 'EACCES' });
		expect(savedSource()).toBeNull();
		expect(v.source).toBe('github');
		expect(handoff()).toBeNull();
		vi.runAllTimers();
		expect(restarts).toBe(0);
		installCode = 0;
		expect(await s.setSource('published')).toEqual({ ok: true });
		expect((await settle(s)).job?.state).toBe('restarting');
		expect(savedSource()).toBe('published');
	});
});

describe('switching to github from an npm install', () => {
	const cloneDir = () => path.join(config, 'update', 'wheelhouse');

	it('clones, installs, builds and links, saves the source and restarts from the clone', async () => {
		const s = svc();
		expect(await s.setSource('github')).toEqual({ ok: true });
		expect((await s.wheelhouse()).job?.steps.map((x) => x.step)).toEqual([
			'clone',
			'install',
			'build',
			'link',
			'restart'
		]);
		const v = await settle(s);
		expect(v.job?.state).toBe('restarting');
		expect(gitCalls).toEqual([
			`clone --quiet https://github.com/chrisjowen/wheelhouse.git ${cloneDir()}`
		]);
		expect(npmCalls).toEqual([
			`npm ci @ ${cloneDir()}`,
			`npm run build @ ${cloneDir()}`,
			`npm link @ ${cloneDir()}`
		]);
		expect(savedSource()).toBe('github');
		expect(handoff()).toBe(cloneDir());
		vi.runAllTimers();
		expect(restarts).toBe(1);
	});

	it('choosing github again while it does not match does the switch', async () => {
		writeSource('github');
		const s = svc();
		expect(await s.setSource('github')).toEqual({ ok: true });
		expect((await settle(s)).job?.state).toBe('restarting');
		expect(handoff()).toBe(cloneDir());
	});

	it('never clones over a directory that is not empty, and saves nothing', async () => {
		mkdirSync(cloneDir());
		writeFileSync(path.join(cloneDir(), 'notes.txt'), 'mine');
		const s = svc();
		await s.setSource('github');
		const v = await settle(s);
		expect(v.job?.state).toBe('failed');
		expect(v.job?.error).toMatch(/not empty/);
		expect(readFileSync(path.join(cloneDir(), 'notes.txt'), 'utf8')).toBe('mine');
		expect(gitCalls).toEqual([]);
		expect(savedSource()).toBeNull();
		expect(handoff()).toBeNull();
		expect(restarts).toBe(0);
	});
});

describe('takeHandoff', () => {
	const built = (dir: string) => {
		mkdirSync(path.join(dir, 'dist'), { recursive: true });
		mkdirSync(path.join(dir, 'build'), { recursive: true });
		writeFileSync(path.join(dir, 'dist', 'cli.js'), '');
		writeFileSync(path.join(dir, 'build', 'handler.js'), '');
	};

	it('names a built install once, then is gone', async () => {
		const next = path.join(root, 'next');
		built(next);
		writeFileSync(handoffFile(config), `${next}\n`);
		expect(takeHandoff(config)).toBe(next);
		expect(takeHandoff(config)).toBeNull();
	});

	it('ignores an install that is not built', () => {
		const next = path.join(root, 'next');
		mkdirSync(next);
		writeFileSync(handoffFile(config), `${next}\n`);
		expect(takeHandoff(config)).toBeNull();
		expect(existsSync(handoffFile(config))).toBe(false);
	});
});
