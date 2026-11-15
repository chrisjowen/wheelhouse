import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { helperNotice } from '../helperchoice';
import { claudeSignInFile, grokSignInFile, resolveHelperProgram } from './helperprogram';

const missing = {
	claude: helperNotice('claude', false, false),
	grok: helperNotice('grok', false, false)
};
const signedOut = {
	claude: helperNotice('claude', true, false),
	grok: helperNotice('grok', true, false)
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
		).toMatchObject({ choice: 'grok', runs: 'grok', fallback: null, notice: signedOut.grok });

		save(config, { harness: 'grok', helper: 'claude' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				found('claude')
			)
		).toMatchObject({ choice: 'claude', runs: 'claude', fallback: null, notice: signedOut.claude });

		save(config, { harness: 'grok' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				() => null
			)
		).toEqual({ choice: null, runs: 'claude', fallback: null, notice: missing.claude });

		save(config, { harness: 'grok', helper: 'same' });
		expect(
			resolveHelperProgram(
				{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'grok' },
				found('grok')
			)
		).toMatchObject({ choice: 'same', runs: 'grok', fallback: null });

		save(config, { harness: 'codex', helper: 'same' });
		const followed = resolveHelperProgram(
			{ WHEELHOUSE_CONFIG_DIR: config, WHEELHOUSE_HARNESS: 'codex' },
			() => null
		);
		expect(followed.runs).toBe('claude');
		expect(followed.fallback).toMatch(/Codex/);
		expect(followed.notice).toBe(missing.claude);
	});

	it('stays on Claude Code when there is no config directory', () => {
		expect(resolveHelperProgram({}, () => '/bin/claude')).toEqual({
			choice: null,
			runs: 'claude',
			fallback: null,
			notice: signedOut.claude
		});
		expect(resolveHelperProgram({}, () => null).notice).toBe(missing.claude);
		const home = dir();
		mkdirSync(path.join(home, '.claude'));
		writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
		expect(resolveHelperProgram({ HOME: home }, () => '/bin/claude').notice).toBeNull();
	});

	it('says the program is not installed before it says it is not signed in', () => {
		const config = dir();
		const grokHome = path.join(config, 'grok');
		mkdirSync(grokHome);
		writeFileSync(path.join(grokHome, 'auth.json'), 'token');
		save(config, { harness: 'claude', helper: 'grok' });
		const env = {
			WHEELHOUSE_CONFIG_DIR: config,
			WHEELHOUSE_HARNESS: 'claude',
			GROK_HOME: grokHome
		};
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

	it('reads a Claude sign-in from CLAUDE_CONFIG_DIR, else ~/.claude', () => {
		const home = dir();
		expect(claudeSignInFile({ HOME: home })).toBeNull();
		const named = path.join(home, 'claude-config');
		mkdirSync(named);
		const creds = path.join(named, '.credentials.json');
		writeFileSync(creds, '{}');
		expect(claudeSignInFile({ HOME: home, CLAUDE_CONFIG_DIR: named })).toBe(creds);
		expect(claudeSignInFile({ HOME: home })).toBeNull();
		mkdirSync(path.join(home, '.claude'));
		const own = path.join(home, '.claude', '.credentials.json');
		writeFileSync(own, '{}');
		expect(claudeSignInFile({ HOME: home })).toBe(own);
	});
});
