import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { helperNotice } from '../helperchoice';
import { grokSignInFile, resolveHelperProgram } from './helperprogram';

const missing = {
	claude: helperNotice('claude', false),
	grok: helperNotice('grok', false)
};

describe('which helper program runs', () => {
	let root: string;
	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	const dir = () => {
		root = mkdtempSync(path.join(tmpdir(), 'wh-helper-program-'));
		return root;
	};

	const save = (config: string, body: Record<string, string>) =>
		writeFileSync(path.join(config, 'harness.json'), JSON.stringify(body));

	const found =
		(have: string) =>
		(name: string): string | null =>
			name === have ? `/bin/${name}` : null;

	it('reads the helper on its own, apart from the agent Firstmate runs in', () => {
		const config = dir();
		save(config, { harness: 'claude', helper: 'grok' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'claude' },
				found('grok')
			)
		).toEqual({ choice: 'grok', runs: 'grok', notice: null });

		save(config, { harness: 'grok', helper: 'claude' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				found('claude')
			)
		).toEqual({ choice: 'claude', runs: 'claude', notice: null });

		save(config, { harness: 'grok' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				() => null
			)
		).toEqual({ choice: null, runs: 'claude', notice: missing.claude });

		save(config, { harness: 'grok', helper: 'same' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				found('grok')
			)
		).toEqual({ choice: null, runs: 'claude', notice: missing.claude });
	});

	it('stays on Claude Code when there is no config directory', () => {
		expect(resolveHelperProgram({}, () => '/bin/claude')).toEqual({
			choice: null,
			runs: 'claude',
			notice: null
		});
		expect(resolveHelperProgram({}, () => null).notice).toBe(missing.claude);
	});

	it('says the program is not installed, and stays quiet once it is', () => {
		const config = dir();
		save(config, { harness: 'claude', helper: 'grok' });
		const env = { WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'claude' };
		expect(resolveHelperProgram(env, () => null).notice).toBe(missing.grok);
		expect(resolveHelperProgram(env, found('grok')).notice).toBeNull();
	});

	it('reads a Grok sign-in from GROK_HOME, else ~/.grok, and ignores a directory', () => {
		const home = dir();
		expect(grokSignInFile({ HOME: home })).toBeNull();
		mkdirSync(path.join(home, '.grok'));
		const auth = path.join(home, '.grok', 'auth.json');
		mkdirSync(auth);
		expect(grokSignInFile({ HOME: home })).toBeNull();
		rmSync(auth, { recursive: true });
		writeFileSync(auth, 'token');
		expect(grokSignInFile({ HOME: home })).toBe(auth);
		const elsewhere = path.join(home, 'other');
		mkdirSync(elsewhere);
		writeFileSync(path.join(elsewhere, 'auth.json'), 'other');
		expect(grokSignInFile({ HOME: home, GROK_HOME: elsewhere })).toBe(
			path.join(elsewhere, 'auth.json')
		);
	});
});
