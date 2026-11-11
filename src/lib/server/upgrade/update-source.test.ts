import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './service';
import { setRestart } from '../restart';

let root: string;
let restarts: number;
let now: number;

function svc(over: Record<string, string> = {}, cloneRun?: any) {
	return new UpdateService({
		env: {
			WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'),
			...over
		},
		clone: cloneRun ? { run: cloneRun } : undefined,
		busy: async () => [],
		now: () => now,
		log: () => {}
	});
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-src-'));
	restarts = 0;
	now = Date.now();
	setRestart(() => restarts++);
	vi.useFakeTimers({ toFake: ['setTimeout'] });
	mkdirSync(path.join(root, 'config', 'update'), { recursive: true });
});

afterEach(() => {
	vi.useRealTimers();
	setRestart(null);
	rmSync(root, { recursive: true, force: true });
});

describe('update source (published vs github)', () => {
	it('detects install kind from location', async () => {
		// no .git -> npm
		const s = svc({ WHEELHOUSE_INSTALL_DIR: root });
		const v = await s.wheelhouse();
		expect(v.installKind).toBe('npm');
		expect(v.source).toBe('published');
	});

	it('mismatch true when source=github but install is npm', async () => {
		// write github source
		writeFileSync(
			path.join(root, 'config', 'update', 'settings.json'),
			JSON.stringify({ schema: 'wheelhouse-update-settings.v1', source: 'github' }) + '\n'
		);
		const s = svc({ WHEELHOUSE_INSTALL_DIR: root });
		const v = await s.wheelhouse();
		expect(v.mismatch).toBe(true);
	});

	it('setSource to published runs npm path (stubbed)', async () => {
		const calls: string[] = [];
		const run = async (cmd: string, args: string[]) => {
			calls.push([cmd, ...args].join(' '));
			return { code: 0, output: '' };
		};
		// start as github so switching to published triggers the npm path
		writeFileSync(
			path.join(root, 'config', 'update', 'settings.json'),
			JSON.stringify({ schema: 'wheelhouse-update-settings.v1', source: 'github' }) + '\n'
		);
		const s = svc({ WHEELHOUSE_INSTALL_DIR: root }, run);
		const r = await s.setSource('published');
		expect(r).toEqual({ ok: true });
		expect(calls.some((c) => c.includes('npm install -g'))).toBe(true);
	});

	it('setSource to github on npm install refuses with helpful message', async () => {
		const s = svc({ WHEELHOUSE_INSTALL_DIR: root });
		const r = await s.setSource('github');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/not running from a git clone/i);
	});
});
