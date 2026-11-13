import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	backendMismatch,
	firstmateBackend,
	parseSessionBackend,
	readSavedBackend,
	resolveSessionBackend,
	savedBackendFile,
	writeSavedBackend
} from './choice';

describe('the session backend setting', () => {
	let dir: string;
	let configDir: string;
	let homeDir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-choice-'));
		configDir = path.join(dir, 'config');
		homeDir = path.join(dir, 'home');
		mkdirSync(path.join(homeDir, 'config'), { recursive: true });
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const firstmateSays = (text: string) =>
		writeFileSync(path.join(homeDir, 'config', 'backend'), text);
	const resolve = (env: NodeJS.ProcessEnv = {}) =>
		resolveSessionBackend({ env, configDir, homeDir });

	it('is tmux when nothing is set, so tmux users see no change', () => {
		expect(resolve()).toEqual({
			backend: 'tmux',
			source: 'default',
			firstmate: null,
			herdrSession: null,
			warning: null,
			error: null
		});
	});

	it("follows Firstmate's config/backend when Wheelhouse sets none", () => {
		firstmateSays('\n  herdr  \n');
		expect(resolve()).toMatchObject({ backend: 'herdr', source: 'firstmate', firstmate: 'herdr' });
		firstmateSays('zellij\n');
		expect(resolve()).toMatchObject({
			backend: 'tmux',
			source: 'firstmate',
			firstmate: 'zellij',
			warning: null
		});
		firstmateSays('tmux');
		expect(resolve()).toMatchObject({ backend: 'tmux', source: 'firstmate', warning: null });
	});

	it("puts the flag or variable before the wizard's choice, and that before Firstmate's", () => {
		firstmateSays('herdr');
		writeSavedBackend(configDir, 'tmux');
		expect(resolve()).toMatchObject({ backend: 'tmux', source: 'saved' });
		expect(resolve({ WHEELHOUSE_SESSION_BACKEND: 'herdr' })).toMatchObject({
			backend: 'herdr',
			source: 'env'
		});
		writeSavedBackend(configDir, null);
		expect(existsSync(savedBackendFile(configDir))).toBe(false);
		expect(resolve()).toMatchObject({ backend: 'herdr', source: 'firstmate' });
	});

	it('passes the herdr session name on as given', () => {
		expect(resolve({ WHEELHOUSE_HERDR_SESSION: 'crew-wh' }).herdrSession).toBe('crew-wh');
	});

	it('warns when Wheelhouse and Firstmate are set to different backends', () => {
		firstmateSays('tmux');
		const herdr = resolve({ WHEELHOUSE_SESSION_BACKEND: 'herdr' });
		expect(herdr.warning).toMatch(/herdr.*config\/backend is tmux.*crew/);
		firstmateSays('herdr');
		writeSavedBackend(configDir, 'tmux');
		expect(resolve().warning).toMatch(/tmux.*config\/backend is herdr/);
		expect(backendMismatch('herdr', 'herdr')).toBeNull();
		// With no config/backend Firstmate follows the session it runs in.
		expect(backendMismatch('herdr', null)).toBeNull();
		// tmux against another non-herdr backend is as it always was.
		expect(backendMismatch('tmux', 'zellij')).toBeNull();
		expect(backendMismatch('herdr', 'zellij')).toMatch(/zellij/);
	});

	it('refuses an unknown name, and an unreadable saved choice, instead of guessing', () => {
		expect(() => parseSessionBackend('zellij')).toThrow(/tmux, or herdr/);
		expect(resolve({ WHEELHOUSE_SESSION_BACKEND: 'screen' }).error).toMatch(/Unknown session/);
		mkdirSync(configDir, { recursive: true });
		writeFileSync(savedBackendFile(configDir), '{"backend":"screen"}');
		expect(readSavedBackend(configDir)).toMatchObject({ ok: false });
		expect(resolve().error).toMatch(/--session-backend/);
		expect(resolve({ WHEELHOUSE_SESSION_BACKEND: 'tmux' }).error).toBeNull();
	});

	it('keeps the choice as a small JSON file in the config directory', () => {
		writeSavedBackend(configDir, 'herdr');
		expect(JSON.parse(readFileSync(savedBackendFile(configDir), 'utf8'))).toEqual({
			backend: 'herdr'
		});
		expect(readSavedBackend(configDir)).toEqual({ ok: true, backend: 'herdr' });
	});

	it('reads no config/backend without a home', () => {
		expect(firstmateBackend(null)).toBeNull();
		expect(firstmateBackend(path.join(dir, 'nowhere'))).toBeNull();
	});
});
