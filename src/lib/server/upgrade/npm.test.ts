import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNpm, upgradeNpm, readInstalledVersion } from './npm';

let root: string;
let dir: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-npm-'));
	dir = path.join(root, 'pkg');
	mkdirSync(dir, { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('readInstalledVersion', () => {
	it('reads version when present', async () => {
		writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}');
		expect(await readInstalledVersion(dir)).toBe('1.2.3');
	});
	it('returns null when missing or bad', async () => {
		expect(await readInstalledVersion(dir)).toBeNull();
		writeFileSync(path.join(dir, 'package.json'), '{}');
		expect(await readInstalledVersion(dir)).toBeNull();
	});
});

describe('checkNpm', () => {
	it('is current when versions match', async () => {
		writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}');
		const run = vi.fn(async () => ({ code: 0, output: '1.2.3\n' }));
		const c = await checkNpm(dir, run as never);
		expect(c.state).toBe('current');
		expect(c.current.version).toBe('1.2.3');
		expect(c.latest?.version).toBe('1.2.3');
	});

	it('is available when published is newer', async () => {
		writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}');
		const run = vi.fn(async () => ({ code: 0, output: '1.3.0\n' }));
		const c = await checkNpm(dir, run as never);
		expect(c.state).toBe('available');
		expect(c.latest?.version).toBe('1.3.0');
	});

	it('surfaces npm view error', async () => {
		writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}');
		const run = vi.fn(async () => ({ code: 1, output: 'E404' }));
		const c = await checkNpm(dir, run as never);
		expect(c.state).toBe('error');
		expect(c.reason).toMatch(/E404/);
	});

	it('handles unknown dir gracefully', async () => {
		const c = await checkNpm(null);
		expect(c.state).toBe('error');
		expect(c.reason).toMatch(/does not know/);
	});
});

describe('upgradeNpm', () => {
	it('calls npm install -g with latest when no target', async () => {
		const calls: string[] = [];
		const run = async (cmd: string, args: string[]) => {
			calls.push([cmd, ...args].join(' '));
			return { code: 0, output: '' };
		};
		const r = await upgradeNpm(dir, null, run as never);
		expect(r.ok).toBe(true);
		expect(calls).toContain('npm install -g @chrisjowen/wheelhouse');
	});

	it('surfaces npm error', async () => {
		const run = async () => ({ code: 1, output: 'EACCES' });
		const r = await upgradeNpm(dir, '1.2.3', run as never);
		if (!r.ok) {
			expect(r.error).toMatch(/failed.*1/);
			expect(r.output).toBe('EACCES');
		} else {
			throw new Error('expected failure');
		}
	});
});

describe('checkNpm version order', () => {
	const at = async (installed: string, latest: string) => {
		writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: installed }));
		return (await checkNpm(dir, async () => ({ code: 0, output: `${latest}\n` }))).state;
	};

	it('does not offer an older published version (semver: 0.6.0-dev > 0.5.0)', async () => {
		expect(await at('0.6.0-dev', '0.5.0')).toBe('current');
		expect(await at('0.10.0', '0.9.0')).toBe('current');
	});

	it('offers a release over its own pre-release (semver: 1.0.0-rc.1 < 1.0.0)', async () => {
		expect(await at('1.0.0-rc.1', '1.0.0')).toBe('available');
		expect(await at('0.9.0', '0.10.0')).toBe('available');
	});
});
