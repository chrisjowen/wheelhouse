import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectInstallKind } from './kind';

let root: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-kind-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('detectInstallKind', () => {
	it('returns unknown when no dir', async () => {
		const r = await detectInstallKind(null);
		expect(r.kind).toBe('unknown');
		expect(r.dir).toBeNull();
	});

	it('detects npm when no .git ancestor', async () => {
		const d = path.join(root, 'pkg');
		mkdirSync(d, { recursive: true });
		writeFileSync(path.join(d, 'package.json'), '{"version":"1.2.3"}');
		const r = await detectInstallKind(d);
		expect(r.kind).toBe('npm');
		expect(r.version).toBe('1.2.3');
	});

	it('detects clone when .git is present as directory', async () => {
		const d = path.join(root, 'clone');
		mkdirSync(path.join(d, '.git'), { recursive: true });
		writeFileSync(path.join(d, 'package.json'), '{"version":"9.9.9"}');
		const r = await detectInstallKind(d);
		expect(r.kind).toBe('clone');
		expect(r.version).toBe('9.9.9');
	});

	it('detects clone when .git is a file (worktree)', async () => {
		const d = path.join(root, 'wt');
		mkdirSync(d, { recursive: true });
		writeFileSync(path.join(d, '.git'), 'gitdir: /some/where');
		const r = await detectInstallKind(d);
		expect(r.kind).toBe('clone');
	});

	it('is npm when .git is only in a parent (an npm prefix inside a git work tree)', async () => {
		mkdirSync(path.join(root, '.git'));
		const d = path.join(root, 'lib', 'node_modules', '@chrisjowen', 'wheelhouse');
		mkdirSync(d, { recursive: true });
		expect((await detectInstallKind(d)).kind).toBe('npm');
	});
});
