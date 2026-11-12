import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SetupService } from './service';

const runtime = vi.hoisted(() => ({
	current: { configured: false, missing: true, error: 'Choose Firstmate' } as Record<
		string,
		unknown
	>
}));
vi.mock('../runtime', () => ({
	getRuntime: async () => runtime.current,
	reconnectRuntime: async () => runtime.current
}));
let root: string;
let env: NodeJS.ProcessEnv;
let code: string;
let target: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-skill-setup-'));
	code = path.join(root, 'firstmate');
	env = {
		HOME: path.join(root, 'user'),
		PATH: '',
		WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'),
		WHEELHOUSE_STATE_DIR: path.join(root, 'state'),
		WHEELHOUSE_PLUGINS_DIR: path.join(root, 'plugins'),
		WHEELHOUSE_INSTALL_DIR: process.cwd()
	};
	target = path.join(env.HOME!, '.claude/skills/manage-wheelhouse/SKILL.md');
	await mkdir(path.join(code, 'bin'), { recursive: true });
	await writeFile(path.join(code, 'bin/fm-fleet-snapshot.sh'), '');
	await writeFile(path.join(code, 'bin/fm-inbox.sh'), '');
	runtime.current = {
		configured: true,
		source: 'remembered',
		install: { firstmateDir: code, homeDir: code }
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it('installs on setup connection and exposes the result in the setup view', async () => {
	const service = new SetupService({ env });
	expect((await service.use(code)).ok).toBe(true);
	expect(await readFile(target, 'utf8')).toContain('name: manage-wheelhouse');
	expect((await service.view()).skillMessage).toContain('installed');
	await writeFile(target, 'my customised instructions');
	expect((await service.use(code)).ok).toBe(true);
	expect((await service.view()).skillMessage).toContain('locally edited');
	expect(await readFile(target, 'utf8')).toBe('my customised instructions');
});

it('does not install from a read-only setup view or dry-run connection', async () => {
	const service = new SetupService({ env: { ...env, WHEELHOUSE_SETUP_DRY_RUN: '1' } });
	await service.view();
	expect((await service.use(code)).ok).toBe(true);
	await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
});
