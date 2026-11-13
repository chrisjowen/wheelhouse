import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHarness } from './harness';

let configDir: string;
beforeEach(() => {
	configDir = mkdtempSync(path.join(tmpdir(), 'wh-harness-choice-'));
});
afterEach(() => rmSync(configDir, { recursive: true, force: true }));

const options = () => ({ configDir, env: {}, interactive: true });
const file = () => path.join(configDir, 'harness.json');
const saved = () => JSON.parse(readFileSync(file(), 'utf8'));

describe('primary tool choice', () => {
	it('gives an explicit choice priority over environment and saved choices, and remembers it', async () => {
		writeFileSync(file(), JSON.stringify({ harness: 'pi' }));
		expect(
			await resolveHarness({
				...options(),
				explicit: 'codex',
				env: { WHEELHOUSE_HARNESS: 'opencode' }
			})
		).toBe('codex');
		expect(saved()).toEqual({ harness: 'codex' });
	});

	it('uses and remembers the environment choice ahead of a saved preference', async () => {
		writeFileSync(file(), JSON.stringify({ harness: 'claude' }));
		expect(await resolveHarness({ ...options(), env: { WHEELHOUSE_HARNESS: 'pi' } })).toBe('pi');
		expect(saved()).toEqual({ harness: 'pi' });
	});

	it('reloads a saved preference without prompting or checking availability', async () => {
		await resolveHarness({ ...options(), explicit: 'opencode' });
		const choose = vi.fn();
		const find = vi.fn();
		expect(await resolveHarness({ ...options(), choose, find })).toBe('opencode');
		expect(choose).not.toHaveBeenCalled();
		expect(find).not.toHaveBeenCalled();
	});

	it('defaults to Claude without a TTY, without prompting or saving that default', async () => {
		const choose = vi.fn();
		const find = vi.fn();
		expect(await resolveHarness({ ...options(), interactive: false, choose, find })).toBe('claude');
		expect(choose).not.toHaveBeenCalled();
		expect(find).not.toHaveBeenCalled();
		expect(readdirSync(configDir)).toEqual([]);
	});

	it('offers only installed tools, and saves the selected one privately without temporary files', async () => {
		const choose = vi.fn(async () => 'codex');
		const find = (name: string) => (['claude', 'codex'].includes(name) ? `/bin/${name}` : null);
		expect(await resolveHarness({ ...options(), choose, find })).toBe('codex');
		expect(choose).toHaveBeenCalledExactlyOnceWith(['claude', 'codex']);
		expect(saved()).toEqual({ harness: 'codex' });
		expect(statSync(file()).mode & 0o777).toBe(0o600);
		expect(readdirSync(configDir)).toEqual(['harness.json']);
	});

	it('chooses and remembers the only installed tool without prompting', async () => {
		const choose = vi.fn();
		expect(
			await resolveHarness({
				...options(),
				choose,
				find: (name) => (name === 'pi' ? '/bin/pi' : null)
			})
		).toBe('pi');
		expect(choose).not.toHaveBeenCalled();
		expect(saved()).toEqual({ harness: 'pi' });
	});

	it('leaves the existing missing-Claude diagnostic to the launcher when no tools are installed', async () => {
		const choose = vi.fn();
		expect(await resolveHarness({ ...options(), choose, find: () => null })).toBe('claude');
		expect(choose).not.toHaveBeenCalled();
		expect(readdirSync(configDir)).toEqual([]);
	});

	it.each(['not JSON', 'null', '[]', '{}', '{"harness":42}', '{"harness":"unknown"}'])(
		'rejects an invalid saved choice with a recovery instruction: %s',
		async (text) => {
			writeFileSync(file(), text);
			await expect(resolveHarness(options())).rejects.toThrow(
				`Invalid saved tool choice in ${file()}`
			);
			await expect(resolveHarness(options())).rejects.toThrow('Set --harness to replace it');
			expect(readFileSync(file(), 'utf8')).toBe(text);
		}
	);

	it('lets an explicit choice replace a corrupt saved preference', async () => {
		writeFileSync(file(), 'broken');
		expect(await resolveHarness({ ...options(), explicit: 'codex' })).toBe('codex');
		expect(saved()).toEqual({ harness: 'codex' });
	});

	it.each([
		{ explicit: '' },
		{ explicit: 'unknown' },
		{ env: { WHEELHOUSE_HARNESS: 'codex --flag' } }
	])('rejects invalid explicit/environment input without saving it', async (extra) => {
		await expect(resolveHarness({ ...options(), ...extra })).rejects.toThrow('Unknown harness');
		expect(readdirSync(configDir)).toEqual([]);
	});

	it('aborts a cancelled choice without launching or saving a default', async () => {
		await expect(
			resolveHarness({ ...options(), find: (name) => `/bin/${name}`, choose: async () => null })
		).rejects.toThrow('Tool selection cancelled');
		expect(readdirSync(configDir)).toEqual([]);
	});

	it('rejects a chooser result outside the installed choices', async () => {
		await expect(
			resolveHarness({
				...options(),
				find: (name) => (['claude', 'codex'].includes(name) ? `/bin/${name}` : null),
				choose: async () => 'pi'
			})
		).rejects.toThrow('not installed');
		expect(readdirSync(configDir)).toEqual([]);
	});

	it('uses an installed fzf process and accepts only one of its offered tool names', async () => {
		const fzf = path.join(configDir, 'fzf');
		writeFileSync(fzf, '#!/bin/sh\ncat >/dev/null\nprintf "codex\\n"\n', { mode: 0o700 });
		const find = (name: string) =>
			name === 'fzf' ? fzf : ['claude', 'codex'].includes(name) ? `/bin/${name}` : null;
		expect(await resolveHarness({ ...options(), find })).toBe('codex');
		expect(saved()).toEqual({ harness: 'codex' });
	});

	it.each([1, 130])('aborts when the fzf process is cancelled with exit %s', async (status) => {
		const fzf = path.join(configDir, 'fzf');
		writeFileSync(fzf, `#!/bin/sh\ncat >/dev/null\nexit ${status}\n`, { mode: 0o700 });
		const find = (name: string) =>
			name === 'fzf' ? fzf : ['claude', 'codex'].includes(name) ? `/bin/${name}` : null;
		await expect(resolveHarness({ ...options(), find })).rejects.toThrow(
			'Tool selection cancelled'
		);
		expect(readdirSync(configDir)).toEqual(['fzf']);
	});
});
