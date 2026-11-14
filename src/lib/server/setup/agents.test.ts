import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { which } from '../sessions/tmux';
import {
	agentStatus,
	piProvider,
	redactKey,
	savedPiProvider,
	signInArgv,
	signInWithKey,
	testAgent,
	withPiKey
} from './agents';
import { writeSavedChoice } from './agentchoice';

describe('signing in to each agent', () => {
	it('runs each agent’s own sign-in, and none for an API key', () => {
		const sub = (agent: 'claude' | 'codex' | 'pi', provider: 'claude' | 'chatgpt') =>
			({ agent, auth: 'subscription', provider }) as const;
		expect(signInArgv(sub('claude', 'claude'), '/b/claude', false)).toEqual({
			ok: true,
			argv: ['/b/claude']
		});
		expect(signInArgv(sub('codex', 'chatgpt'), '/b/codex', false)).toEqual({
			ok: true,
			argv: ['/b/codex', 'login']
		});
		// A cloud machine has no browser of its own: Codex's device code sign-in.
		expect(signInArgv(sub('codex', 'chatgpt'), '/b/codex', true)).toEqual({
			ok: true,
			argv: ['/b/codex', 'login', '--device-auth']
		});
		expect(signInArgv(sub('pi', 'chatgpt'), '/b/pi', false)).toEqual({
			ok: true,
			argv: ['/b/pi', '--no-session']
		});
		expect(
			signInArgv({ agent: 'codex', auth: 'apikey', provider: 'openai' }, '/b/codex', false).ok
		).toBe(false);
	});

	it('gives Pi the provider chosen', () => {
		expect(piProvider({ agent: 'pi', auth: 'subscription', provider: 'chatgpt' })).toBe(
			'openai-codex'
		);
		expect(piProvider({ agent: 'pi', auth: 'apikey', provider: 'anthropic' })).toBe('anthropic');
		expect(piProvider({ agent: 'codex', auth: 'apikey', provider: 'openai' })).toBeNull();
	});

	it('adds Pi’s API key to its auth.json, keeping every other entry', () => {
		const before = JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'x' } });
		expect(JSON.parse(withPiKey(before, 'openai', 'sk-1'))).toEqual({
			'openai-codex': { type: 'oauth', access: 'x' },
			openai: { type: 'api_key', key: 'sk-1' }
		});
		expect(JSON.parse(withPiKey(null, 'anthropic', 'k'))).toEqual({
			anthropic: { type: 'api_key', key: 'k' }
		});
		// Never the parser's own message, which could quote the file.
		expect(() => withPiKey('{"openai": "sk-secret', 'openai', 'k')).toThrow(/^it is not JSON$/);
	});

	it('never shows what looks like an API key', () => {
		expect(redactKey('Incorrect API key provided: sk-proj-abc123XYZ.')).toBe(
			'Incorrect API key provided: [redacted].'
		);
		expect(redactKey('Incorrect API key provided: sk-fake-****-123')).toBe(
			'Incorrect API key provided: [redacted]'
		);
	});
});

describe.skipIf(!which('bash', process.env.PATH))('Codex and Pi in setup', () => {
	let dir: string;
	let env: NodeJS.ProcessEnv;
	const commandEnv = { packageManager: null, npmWritable: true };
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-agents-')));
		mkdirSync(path.join(dir, 'bin'));
		env = {
			HOME: dir,
			PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`,
			FAKE: dir,
			PI_CODING_AGENT_DIR: path.join(dir, 'pi-agent'),
			WHEELHOUSE_CONFIG_DIR: path.join(dir, 'config')
		};
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const opts = () => ({ env, workDir: path.join(dir, 'work'), commandEnv });

	/** A fake agent: its version; a one-word answer once signed in; Codex's key login. */
	const fake = (name: 'codex' | 'pi') => {
		const file = path.join(dir, 'bin', name);
		writeFileSync(
			file,
			[
				'#!/usr/bin/env bash',
				`if [ "$1" = --version ]; then echo "${name === 'codex' ? 'codex-cli 0.169.0' : '0.80.10'}"; exit 0; fi`,
				'if [ "$1" = login ] && [ "$2" = --with-api-key ]; then cat > "$FAKE/stdin"; echo "$@" > "$FAKE/login-args"; touch "$FAKE/signed-in"; echo "API key saved."; exit 0; fi',
				'pwd > "$FAKE/cwd"; printf "%s\\n" "$@" > "$FAKE/args"',
				'if [ -e "$FAKE/signed-in" ] || [ -e "$PI_CODING_AGENT_DIR/auth.json" ]; then echo ok; exit 0; fi',
				'echo "Working..." >&2; echo "ERROR: 401 Unauthorized: Incorrect API key provided: sk-proj-abcdef123" >&2; exit 1'
			].join('\n')
		);
		chmodSync(file, 0o755);
	};
	const args = () => readFileSync(path.join(dir, 'args'), 'utf8').trim().split('\n');

	it('offers to install each with npm when it is missing', async () => {
		const codex = await agentStatus('codex', opts());
		expect(codex).toMatchObject({ installed: false, version: null });
		expect(codex.install.oneClick).toEqual({ command: 'npm install -g @openai/codex' });
		const pi = await agentStatus('pi', opts());
		expect(pi.install.oneClick).toEqual({
			command: 'npm install -g @earendil-works/pi-coding-agent'
		});
	});

	it('tests Codex with `codex exec` in Wheelhouse’s own folder: signed out, then in', async () => {
		fake('codex');
		const c = { agent: 'codex', auth: 'subscription', provider: 'chatgpt' } as const;
		const out = await testAgent(c, opts());
		expect(out).toMatchObject({ installed: true, version: '0.169.0', signedIn: false });
		expect(out.detail).toBe('ERROR: 401 Unauthorized: Incorrect API key provided: [redacted]');
		expect(args().slice(0, 4)).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only']);
		writeFileSync(path.join(dir, 'signed-in'), '');
		expect(await testAgent(c, opts())).toMatchObject({
			signedIn: true,
			detail: 'Codex answered.'
		});
		expect(readFileSync(path.join(dir, 'cwd'), 'utf8').trim()).toBe(path.join(dir, 'work'));
	});

	it('tests Pi with `pi -p` and the provider chosen', async () => {
		fake('pi');
		const c = { agent: 'pi', auth: 'subscription', provider: 'chatgpt' } as const;
		expect(await testAgent(c, opts())).toMatchObject({ version: '0.80.10', signedIn: false });
		expect(args()).toEqual(expect.arrayContaining(['-p', '--no-session', '--provider']));
		expect(args()[args().indexOf('--provider') + 1]).toBe('openai-codex');
	});

	it('signs Codex in with a key on its standard input, never on its command line', async () => {
		fake('codex');
		const key = 'sk-proj-test-key-123456';
		const c = { agent: 'codex', auth: 'apikey', provider: 'openai' } as const;
		expect(await signInWithKey(c, 'openai', key, opts())).toEqual({ ok: true });
		expect(readFileSync(path.join(dir, 'stdin'), 'utf8')).toBe(key);
		expect(readFileSync(path.join(dir, 'login-args'), 'utf8')).not.toContain(key);
		expect(await testAgent(c, opts())).toMatchObject({ signedIn: true });
	});

	it('signs Pi in with a key in its own auth.json, private to the captain', async () => {
		fake('pi');
		const auth = path.join(dir, 'pi-agent', 'auth.json');
		mkdirSync(path.dirname(auth));
		writeFileSync(auth, JSON.stringify({ 'openai-codex': { type: 'oauth' } }));
		const c = { agent: 'pi', auth: 'apikey', provider: 'anthropic' } as const;
		expect(await signInWithKey(c, 'anthropic', 'sk-ant-xyz', opts())).toEqual({ ok: true });
		expect(JSON.parse(readFileSync(auth, 'utf8'))).toEqual({
			'openai-codex': { type: 'oauth' },
			anthropic: { type: 'api_key', key: 'sk-ant-xyz' }
		});
		expect(statSync(auth).mode & 0o777).toBe(0o600);
		expect(await testAgent(c, opts())).toMatchObject({ signedIn: true });
		expect(args()[args().indexOf('--provider') + 1]).toBe('anthropic');
	});

	it('starts Firstmate’s Pi with the provider only when one was chosen', () => {
		expect(savedPiProvider({ ...env, WHEELHOUSE_HARNESS: 'pi' })).toBeNull();
		writeSavedChoice(env.WHEELHOUSE_CONFIG_DIR!, {
			agent: 'pi',
			auth: 'apikey',
			provider: 'openai'
		});
		expect(savedPiProvider({ ...env, WHEELHOUSE_HARNESS: 'pi' })).toBe('openai');
		expect(savedPiProvider({ ...env, WHEELHOUSE_HARNESS: 'codex' })).toBeNull();
	});
});
