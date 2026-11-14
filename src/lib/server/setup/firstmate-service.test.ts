import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { which, type Run } from '../sessions/tmux';
import { readRemembered } from './remembered';
import { SetupService } from './service';

const runtime = vi.hoisted(() => ({
	current: { configured: false } as Record<string, unknown>,
	connected: { configured: false } as Record<string, unknown>
}));
vi.mock('../runtime', () => ({
	getRuntime: async () => runtime.current,
	reconnectRuntime: async () => runtime.connected
}));
vi.mock('../restart', () => ({ canRestart: () => true, restartSoon: () => false }));

let root: string;
let config: string;
let env: NodeJS.ProcessEnv;
let target: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-get-firstmate-'));
	config = path.join(root, 'config');
	mkdirSync(config);
	target = path.join(root, 'firstmate');
	env = {
		HOME: root,
		PATH: process.env.PATH,
		WHEELHOUSE_CONFIG_DIR: config,
		WHEELHOUSE_STATE_DIR: path.join(root, 'wh-state'),
		WHEELHOUSE_SETUP_REPOSITORY: 'https://example.com/firstmate.git',
		// No bundled skills to install into the stand-in checkout.
		WHEELHOUSE_SETUP_DRY_RUN: '1'
	};
	runtime.current = { configured: false, error: 'Could not find a Firstmate checkout.' };
	runtime.connected = {
		configured: true,
		install: { firstmateDir: target, homeDir: target },
		source: 'remembered'
	};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** `git clone` as far as the wizard can see: a checkout that looks like Firstmate. Nothing else answers. */
const cloned: string[][] = [];
const fakeGit: Run = async (_file, args) => {
	if (args[0] !== 'clone') return { ok: true, stdout: '', stderr: '', durationMs: 1 };
	cloned.push([...args]);
	const dir = args.at(-1) as string;
	mkdirSync(path.join(dir, 'bin'), { recursive: true });
	writeFileSync(path.join(dir, 'bin', 'fm-fleet-snapshot.sh'), '#!/bin/sh\n');
	return { ok: true, stdout: '', stderr: `Cloning into '${dir}'...\n`, durationMs: 1 };
};

const looksLikeFirstmate = (dir: string) => {
	mkdirSync(path.join(dir, 'bin'), { recursive: true });
	writeFileSync(path.join(dir, 'bin', 'fm-fleet-snapshot.sh'), '#!/bin/sh\n');
};

describe.skipIf(!which('git', process.env.PATH))('Get Firstmate', () => {
	beforeEach(() => {
		cloned.length = 0;
	});

	it('clones Firstmate to ~/firstmate and uses it, in one step', async () => {
		const service = new SetupService({ env, run: fakeGit });
		expect((await service.view()).defaultDir).toBe(target);
		const r = await service.getFirstmate();
		expect(r).toEqual({
			ok: true,
			value: { dir: target, output: expect.stringContaining('Cloning'), restarting: false }
		});
		expect(cloned).toEqual([['clone', '--', 'https://example.com/firstmate.git', target]]);
		expect(existsSync(path.join(target, 'state'))).toBe(true);
		expect(readRemembered(config)).toMatchObject({ firstmate: target, home: target });
	});

	it('uses the Firstmate already at ~/firstmate instead of cloning again', async () => {
		looksLikeFirstmate(target);
		const r = await new SetupService({ env, run: fakeGit }).getFirstmate();
		expect(r).toEqual({ ok: true, value: { dir: target, output: '', restarting: false } });
		expect(cloned).toEqual([]);
		expect(readRemembered(config)).toMatchObject({ firstmate: target });
	});

	it('never touches something else already at ~/firstmate', async () => {
		mkdirSync(target);
		writeFileSync(path.join(target, 'notes.txt'), 'mine\n');
		const r = await new SetupService({ env, run: fakeGit }).getFirstmate();
		expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/never overwrites/) });
		expect(cloned).toEqual([]);
		expect(readdirSync(target)).toEqual(['notes.txt']);
		expect(readRemembered(config)).toBeNull();
	});
});
