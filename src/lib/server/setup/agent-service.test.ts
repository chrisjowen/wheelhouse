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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_PRODUCT } from '../../agent';
import type { VaultChange } from '../../vault';
import { ANSWERS_SCHEMA, answersFile } from './answers';
import { SetupService } from './service';

const runtime = vi.hoisted(() => ({ current: { configured: false } as Record<string, unknown> }));
vi.mock('../runtime', () => ({
	getRuntime: async () => runtime.current,
	reconnectRuntime: async () => runtime.current
}));
const restart = vi.hoisted(() => ({ soon: vi.fn(() => true) }));
vi.mock('../restart', () => ({ canRestart: () => true, restartSoon: restart.soon }));

let root: string;
let config: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-agent-setup-'));
	config = path.join(root, 'config');
	mkdirSync(config);
	mkdirSync(path.join(root, 'bin'));
	env = {
		HOME: root,
		PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
		FAKE: root,
		WHEELHOUSE_CONFIG_DIR: config,
		WHEELHOUSE_STATE_DIR: path.join(root, 'state')
	};
	runtime.current = { configured: false, error: 'Choose where Firstmate lives first.' };
	restart.soon.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const answer = (v: Record<string, unknown>) =>
	writeFileSync(answersFile(config), JSON.stringify({ schema: ANSWERS_SCHEMA, ...v }));

describe('the agent step', () => {
	it('is the normal wizard without setup answers: Claude Code, no cloud', async () => {
		const view = (await new SetupService({ env }).view()).agent;
		expect(view).toEqual({
			choice: { agent: 'claude', auth: 'subscription', provider: 'claude' },
			cloud: null,
			answersProblem: null,
			fixed: null
		});
	});

	it('starts pre-filled from the setup answers, labelled as the cloud product’s setup', async () => {
		answer({ agent: 'codex', auth: 'apikey', size: 's' });
		const view = (await new SetupService({ env: { ...env, WHEELHOUSE_HARNESS: 'codex' } }).view())
			.agent;
		expect(view?.choice).toEqual({ agent: 'codex', auth: 'apikey', provider: 'openai' });
		expect(view?.cloud).toEqual({
			product: CLOUD_PRODUCT,
			answered: { agent: 'codex', auth: 'apikey', provider: 'openai' }
		});
	});

	it('says why setup answers cannot be used, and stays the normal wizard', async () => {
		writeFileSync(answersFile(config), '{"agent":"codex"}');
		const view = (await new SetupService({ env }).view()).agent;
		expect(view?.cloud).toBeNull();
		expect(view?.answersProblem).toContain('schema');
	});

	it('keeps a chosen agent, and restarts a connected Wheelhouse running another', async () => {
		const service = new SetupService({ env });
		const choice = { agent: 'pi', auth: 'apikey', provider: 'anthropic' } as const;
		expect(await service.chooseAgent(choice)).toMatchObject({
			ok: true,
			value: { restarting: false, agent: { choice } }
		});
		expect(env.WHEELHOUSE_HARNESS).toBe('pi');
		expect(JSON.parse(readFileSync(path.join(config, 'harness.json'), 'utf8'))).toEqual({
			harness: 'pi',
			auth: 'apikey',
			provider: 'anthropic'
		});
		expect(restart.soon).not.toHaveBeenCalled();
		runtime.current = { configured: true, firstmate: { harness: 'pi' } };
		const codex = { agent: 'codex', auth: 'subscription', provider: 'chatgpt' } as const;
		expect(await service.chooseAgent(codex)).toMatchObject({ value: { restarting: true } });
		expect(restart.soon).toHaveBeenCalledOnce();
	});

	it('refuses a way that is coming soon, and paying through the cloud product', async () => {
		answer({ agent: 'claude', auth: 'ours' });
		const service = new SetupService({ env });
		for (const c of [
			{ agent: 'pi', auth: 'subscription', provider: 'claude' },
			{ agent: 'claude', auth: 'ours', provider: null }
		] as const) {
			expect(await service.chooseAgent(c)).toEqual({
				ok: false,
				error: 'That way to pay for it is not offered yet.'
			});
		}
	});

	it('does not change an agent given with --harness', async () => {
		const service = new SetupService({
			env: { ...env, WHEELHOUSE_HARNESS: 'claude', WHEELHOUSE_HARNESS_FIXED: '1' }
		});
		expect((await service.view()).agent?.fixed).toMatch(/--harness/);
		const r = await service.chooseAgent({
			agent: 'codex',
			auth: 'subscription',
			provider: 'chatgpt'
		});
		expect(r.ok).toBe(false);
	});

	const fakeCodex = () => {
		const codex = path.join(root, 'bin', 'codex');
		writeFileSync(
			codex,
			[
				'#!/usr/bin/env bash',
				'if [ "$1" = --version ]; then echo "codex-cli 0.169.0"; exit 0; fi',
				'if [ "$1" = login ]; then cat > "$FAKE/stdin"; exit 0; fi',
				'exit 1'
			].join('\n')
		);
		chmodSync(codex, 0o755);
		answer({ agent: 'codex', auth: 'apikey' });
	};

	it('keeps an API key in the vault under the agent’s own name, for no project, and signs the agent in with it', async () => {
		fakeCodex();
		const change = vi.fn(async () => ({
			ok: true as const,
			message: 'Stored WHEELHOUSE_AGENT_OPENAI_API_KEY in the vault. No project can use it yet.',
			secrets: [],
			observedAt: ''
		}));
		const service = new SetupService({
			env: { ...env, WHEELHOUSE_HARNESS: 'codex' },
			vault: { change }
		});
		const key = 'sk-proj-a-real-looking-key';
		const r = await service.agentKey(`  ${key}\n`);
		expect(r).toEqual({
			ok: true,
			value: {
				name: 'WHEELHOUSE_AGENT_OPENAI_API_KEY',
				message:
					'Stored WHEELHOUSE_AGENT_OPENAI_API_KEY in the vault. No project can use it yet. Codex is signed in with it.',
				exists: false
			}
		});
		expect(JSON.stringify(r)).not.toContain(key);
		expect(change).toHaveBeenCalledWith({
			action: 'set',
			name: 'WHEELHOUSE_AGENT_OPENAI_API_KEY',
			value: key,
			projects: [],
			replace: false
		});
		expect(readFileSync(path.join(root, 'stdin'), 'utf8')).toBe(key);
	});

	it('asks before replacing an agent key the vault already holds, and replaces it once told to', async () => {
		fakeCodex();
		const held =
			'The vault already has a secret named WHEELHOUSE_AGENT_OPENAI_API_KEY. Storing this replaces its value.';
		const change = vi.fn(async (c: VaultChange) =>
			c.action === 'set' && c.replace === false
				? { ok: false as const, status: 409, message: held }
				: {
						ok: true as const,
						message: 'Replaced the value of WHEELHOUSE_AGENT_OPENAI_API_KEY.',
						secrets: [],
						observedAt: ''
					}
		);
		const service = new SetupService({
			env: { ...env, WHEELHOUSE_HARNESS: 'codex' },
			vault: { change }
		});
		const key = 'sk-proj-a-real-looking-key';
		expect(await service.agentKey(key)).toEqual({
			ok: true,
			value: { name: 'WHEELHOUSE_AGENT_OPENAI_API_KEY', message: held, exists: true }
		});
		expect(existsSync(path.join(root, 'stdin'))).toBe(false);
		expect(await service.agentKey(key, true)).toMatchObject({ ok: true, value: { exists: false } });
		expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }));
		expect(readFileSync(path.join(root, 'stdin'), 'utf8')).toBe(key);
	});

	it('takes no API key for an agent signed in with a subscription', async () => {
		const change = vi.fn();
		const service = new SetupService({ env, vault: { change } });
		expect((await service.agentKey('sk-x')).ok).toBe(false);
		expect(change).not.toHaveBeenCalled();
	});
});
