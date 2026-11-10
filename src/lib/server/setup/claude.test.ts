import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { which } from '../sessions/tmux';
import { answeredOk, claudeStatus, parseClaudeVersion, redact, testClaude } from './claude';

describe('reading Claude Code', () => {
	it('reads the version it reports', () => {
		expect(parseClaudeVersion('2.1.322 (Claude Code)\n')).toBe('2.1.322');
		expect(parseClaudeVersion('nonsense')).toBeNull();
	});

	it('takes only a plain ok as an answer', () => {
		expect(answeredOk('ok')).toBe(true);
		expect(answeredOk(' OK.\n')).toBe(true);
		expect(answeredOk('Invalid API key · Please run /login')).toBe(false);
		expect(answeredOk('ok, but')).toBe(false);
	});

	it('never shows what looks like a credential', () => {
		expect(redact('key sk-ant-api03-abcDEF_123 refused')).toBe('key [redacted] refused');
		expect(redact(`token ${'a'.repeat(48)}`)).toBe('token [redacted]');
		expect(redact('Please run /login')).toBe('Please run /login');
	});
});

describe.skipIf(!which('bash', process.env.PATH))('the Claude Code test', () => {
	let dir: string;
	let env: NodeJS.ProcessEnv;
	const commandEnv = { packageManager: null, npmWritable: true };
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-claude-'));
		mkdirSync(path.join(dir, 'bin'));
		env = { ...process.env, PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`, FAKE: dir };
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	/** A fake claude: --version, and -p answering ok once "signed-in" exists. */
	const fake = () => {
		const file = path.join(dir, 'bin', 'claude');
		writeFileSync(
			file,
			[
				'#!/usr/bin/env bash',
				'if [ "$1" = --version ]; then echo "2.0.1 (Claude Code)"; exit 0; fi',
				'if [ "$1" = -p ]; then pwd > "$FAKE/cwd"; [ -e "$FAKE/signed-in" ] && { echo ok; exit 0; }',
				'  echo "Invalid API key · Please run /login"; exit 1; fi'
			].join('\n')
		);
		chmodSync(file, 0o755);
	};

	it('offers to install it when it is missing', async () => {
		const s = await claudeStatus({ env, workDir: path.join(dir, 'work'), commandEnv });
		expect(s).toMatchObject({ installed: false, version: null });
		expect(s.install.oneClick).toEqual({ command: 'npm install -g @anthropic-ai/claude-code' });
		expect(s.install.terminal).toContain('curl -fsSL https://claude.ai/install.sh | bash');
	});

	it('says signed out, then signed in, running in Wheelhouse’s own folder', async () => {
		fake();
		const workDir = path.join(dir, 'work');
		const out = await testClaude({ env, workDir, commandEnv });
		expect(out).toMatchObject({ installed: true, version: '2.0.1', signedIn: false });
		expect(out.detail).toMatch(/login/);
		writeFileSync(path.join(dir, 'signed-in'), '');
		const inn = await testClaude({ env, workDir, commandEnv });
		expect(inn).toMatchObject({ signedIn: true });
		expect(readFileSync(path.join(dir, 'cwd'), 'utf8').trim()).toBe(workDir);
		expect(existsSync(workDir)).toBe(true);
	});
});
