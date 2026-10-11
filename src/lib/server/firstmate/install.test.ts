import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCompatibility, findFirstmateDir, resolveInstall } from './install';
import { createFakeFirstmate, type FakeFirstmate } from '../../../../tests/helpers/fake-firstmate';

let fm: FakeFirstmate;
beforeEach(() => {
	fm = createFakeFirstmate();
});
afterEach(() => fm.cleanup());

describe('resolveInstall', () => {
	it('finds the Firstmate checkout above the working directory', () => {
		const deep = path.join(fm.root, 'projects', 'x');
		mkdirSync(deep, { recursive: true });
		expect(findFirstmateDir(deep)).toBe(fm.root);
		const r = resolveInstall({ cwd: deep, env: {} });
		expect(r.ok && r.install).toEqual({ firstmateDir: fm.root, homeDir: fm.root });
	});

	it('honours --home, then FM_HOME', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'wh-home-'));
		mkdirSync(path.join(home, 'state'));
		try {
			const viaFlag = resolveInstall({ firstmate: fm.root, home, cwd: '/', env: {} });
			expect(viaFlag.ok && viaFlag.install.homeDir).toBe(home);
			const viaEnv = resolveInstall({ firstmate: fm.root, cwd: '/', env: { FM_HOME: home } });
			expect(viaEnv.ok && viaEnv.install.homeDir).toBe(home);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it('explains what is wrong', () => {
		const empty = mkdtempSync(path.join(tmpdir(), 'wh-empty-'));
		try {
			expect(resolveInstall({ cwd: empty, env: {} })).toMatchObject({
				ok: false,
				error: expect.stringMatching(/--firstmate/)
			});
			expect(resolveInstall({ firstmate: empty, cwd: '/', env: {} })).toMatchObject({
				ok: false,
				error: expect.stringMatching(/not a Firstmate checkout/)
			});
			expect(resolveInstall({ firstmate: fm.root, home: empty, cwd: '/', env: {} })).toMatchObject({
				ok: false,
				error: expect.stringMatching(/no state\//)
			});
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});

describe('checkCompatibility', () => {
	it('accepts scripts that declare the supported contracts', async () => {
		const c = await checkCompatibility({ firstmateDir: fm.root, homeDir: fm.root });
		expect(c.compatible).toBe(true);
		expect(c.scripts.map((s) => `${s.name}: ${s.purpose}`)).toEqual([
			'fm-fleet-snapshot.sh: fleet and current task state',
			'fm-inbox.sh: supervisor readiness',
			'fm-inbox.sh: messages to Firstmate',
			'fm-peek.sh: worker terminal output'
		]);
	});

	it('reports an inbox that predates request ids and receipts as a messaging problem only', async () => {
		writeFileSync(
			path.join(fm.root, 'bin', 'fm-inbox.sh'),
			'#!/bin/sh\n#   fm-inbox.sh ready\n# fm-primary-ready.v1\n'
		);
		const c = await checkCompatibility({ firstmateDir: fm.root, homeDir: fm.root });
		const inbox = c.scripts.filter((s) => s.name === 'fm-inbox.sh');
		expect(inbox.map((s) => [s.purpose, s.ok])).toEqual([
			['supervisor readiness', true],
			['messages to Firstmate', false]
		]);
		expect(inbox[1].problem).toMatch(/fm-inbox-note\.v1/);
	});

	it('reports a changed contract, a missing script and a non-executable one', async () => {
		writeFileSync(
			path.join(fm.root, 'bin', 'fm-fleet-snapshot.sh'),
			'#!/bin/sh\n# fm-fleet-snapshot.v2 `--json`\n'
		);
		rmSync(path.join(fm.root, 'bin', 'fm-inbox.sh'));
		chmodSync(path.join(fm.root, 'bin', 'fm-peek.sh'), 0o644);
		const c = await checkCompatibility({ firstmateDir: fm.root, homeDir: fm.root });
		expect(c.compatible).toBe(false);
		expect(c.problems.join('\n')).toMatch(/fm-fleet-snapshot.sh does not declare/);
		expect(c.problems.join('\n')).toMatch(/fm-inbox.sh is missing/);
		expect(c.problems.join('\n')).toMatch(/fm-peek.sh is not executable/);
	});
});
