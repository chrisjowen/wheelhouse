import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './service';
import { setRestart } from '../restart';

/**
 * The update source: which way Wheelhouse checks and upgrades itself, with npm
 * stood in (`npm view` answers `published`, `npm install -g` answers `install`).
 */

let root: string;
let install: string;
let restarts: number;
let npmCalls: string[];
let published: string;
let installCode: number;

const settingsFile = () => path.join(root, 'config', 'update', 'settings.json');
const writeSource = (source: string) =>
	writeFileSync(
		settingsFile(),
		JSON.stringify({ schema: 'wheelhouse-update-settings.v1', source }) + '\n'
	);
const savedSource = () => {
	try {
		return JSON.parse(readFileSync(settingsFile(), 'utf8')).source as string;
	} catch {
		return null;
	}
};

function svc() {
	return new UpdateService({
		env: { WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'), WHEELHOUSE_INSTALL_DIR: install },
		npm: async (cmd, args) => {
			npmCalls.push([cmd, ...args].join(' '));
			if (args[0] === 'view') return { code: 0, output: `${published}\n` };
			return { code: installCode, output: installCode ? 'EACCES' : '' };
		},
		clone: {
			run: async () => {
				throw new Error('the clone path must not run');
			}
		},
		busy: async () => [],
		log: () => {}
	});
}

/** Make the install directory a git clone, as `detectInstallKind` sees one. */
const makeClone = () => mkdirSync(path.join(install, '.git'));

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-src-'));
	install = path.join(root, 'wheelhouse');
	mkdirSync(install);
	writeFileSync(path.join(install, 'package.json'), '{"version":"0.5.0"}');
	mkdirSync(path.join(root, 'config', 'update'), { recursive: true });
	restarts = 0;
	npmCalls = [];
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

describe('published source on an npm install', () => {
	it('is the default and the header check reports the newer published version', async () => {
		const s = svc();
		const c = await s.checkWheelhouse();
		expect(c).toMatchObject({
			state: 'available',
			current: { version: '0.5.0' },
			latest: { version: '0.6.0' }
		});
		const v = await s.wheelhouse();
		expect(v).toMatchObject({ source: 'published', installKind: 'npm', mismatch: false });
		expect(v.check?.state).toBe('available');
	});

	it('checks npm only when the last check is stale', async () => {
		const s = svc();
		await s.checkWheelhouse();
		await s.wheelhouse();
		await s.wheelhouse();
		expect(npmCalls.filter((c) => c.startsWith('npm view'))).toHaveLength(1);
	});

	it('upgrades with npm install -g to the checked version, then restarts', async () => {
		const s = svc();
		await s.checkWheelhouse();
		expect(await s.startUpgrade()).toEqual({ ok: true });
		await vi.waitFor(async () => expect((await s.wheelhouse()).job?.state).toBe('restarting'));
		expect(npmCalls).toContain('npm install -g @chrisjowen/wheelhouse@0.6.0');
		vi.runAllTimers();
		expect(restarts).toBe(1);
	});
});

describe('published source on a clone', () => {
	it('says the install does not match and refuses to npm install over the clone', async () => {
		makeClone();
		const s = svc();
		expect((await s.checkWheelhouse()).state).toBe('unsupported');
		expect((await s.wheelhouse()).mismatch).toBe(true);
		const r = await s.startUpgrade();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/git clone/);
		expect(npmCalls).toEqual([]);
		expect((await s.wheelhouse()).job).toBeNull();
	});
});

describe('setSource', () => {
	it('to published reinstalls from npm, saves the choice and restarts', async () => {
		writeSource('github');
		const s = svc();
		expect(await s.setSource('published')).toEqual({ ok: true });
		expect(npmCalls).toContain('npm install -g @chrisjowen/wheelhouse');
		expect(savedSource()).toBe('published');
		vi.runAllTimers();
		expect(restarts).toBe(1);
	});

	it('keeps refusing other changes until the restart once it switched', async () => {
		writeSource('github');
		const s = svc();
		await s.setSource('published');
		const r = await s.startUpgrade();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/^Wait for/);
	});

	it('keeps the old source when npm install fails', async () => {
		writeSource('github');
		installCode = 243;
		const s = svc();
		const r = await s.setSource('published');
		expect(r.ok).toBe(false);
		expect(savedSource()).toBe('github');
		expect((await s.wheelhouse()).source).toBe('github');
		vi.runAllTimers();
		expect(restarts).toBe(0);
		installCode = 0;
		expect(await s.setSource('published')).toEqual({ ok: true });
	});

	it('to github on an npm install refuses and saves nothing', async () => {
		const s = svc();
		const r = await s.setSource('github');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/not running from a git clone/i);
		expect(savedSource()).toBeNull();
		expect((await s.wheelhouse()).source).toBe('published');
	});
});
