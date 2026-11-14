import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentChoice, madeChoice, readSavedChoice, writeSavedChoice } from './agentchoice';
import { ANSWERS_SCHEMA, answersFile, readAnswers } from './answers';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-answers-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const answer = (v: unknown) =>
	writeFileSync(answersFile(dir), typeof v === 'string' ? v : JSON.stringify(v));

describe('the setup answers', () => {
	it('are none on an install of the captain’s own (no file)', () => {
		expect(readAnswers(dir)).toEqual({ state: 'none' });
	});

	it('choose the agent and how it is paid for, ignoring the cloud’s other fields', () => {
		answer({ schema: ANSWERS_SCHEMA, agent: 'codex', auth: 'apikey', size: 'm' });
		expect(readAnswers(dir)).toEqual({
			state: 'ok',
			choice: { agent: 'codex', auth: 'apikey', provider: 'openai' },
			fleetyard: null
		});
		answer({ schema: ANSWERS_SCHEMA, agent: 'pi', auth: 'apikey', provider: 'anthropic' });
		expect(readAnswers(dir)).toMatchObject({ choice: { provider: 'anthropic' } });
		answer({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'ours' });
		expect(readAnswers(dir)).toMatchObject({ choice: { auth: 'ours', provider: null } });
	});

	it('say where the cloud product’s site is, when they give an http(s) address', () => {
		const base = { schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' };
		answer({ ...base, fleetyardUrl: 'https://fleetyard.example.com/machines' });
		expect(readAnswers(dir)).toMatchObject({
			fleetyard: 'https://fleetyard.example.com/machines'
		});
		for (const fleetyardUrl of ['javascript:alert(1)', 'https://me:pw@x.example', 'not a url', 7]) {
			answer({ ...base, fleetyardUrl });
			expect(readAnswers(dir)).toMatchObject({ state: 'ok', fleetyard: null });
		}
	});

	it.each([
		['not JSON', 'not JSON'],
		[[], 'not an object'],
		[{ agent: 'claude', auth: 'subscription' }, 'schema'],
		[{ schema: ANSWERS_SCHEMA, agent: 'opencode', auth: 'subscription' }, 'agent'],
		[{ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'free' }, 'auth'],
		[{ schema: ANSWERS_SCHEMA, agent: 'pi', auth: 'apikey', provider: 'gemini' }, 'provider']
	])('says why %j cannot be used', (v, why) => {
		answer(v);
		const r = readAnswers(dir);
		expect(r.state).toBe('invalid');
		expect(r.state === 'invalid' && r.problem).toContain(why);
	});
});

describe('the agent choice the wizard works with', () => {
	it('is the running agent on its subscription when nobody chose', () => {
		expect(currentChoice('codex', dir)).toEqual({
			agent: 'codex',
			auth: 'subscription',
			provider: 'chatgpt'
		});
		expect(madeChoice('pi', dir)).toBeNull();
		expect(currentChoice('opencode', dir)).toBeNull();
	});

	it('takes the setup answers for the agent they chose', () => {
		answer({ schema: ANSWERS_SCHEMA, agent: 'pi', auth: 'apikey', provider: 'openai' });
		expect(currentChoice('pi', dir)).toEqual({ agent: 'pi', auth: 'apikey', provider: 'openai' });
		expect(currentChoice('claude', dir)?.auth).toBe('subscription');
	});

	it('prefers what the wizard saved over the answers', () => {
		answer({ schema: ANSWERS_SCHEMA, agent: 'codex', auth: 'subscription' });
		writeSavedChoice(dir, { agent: 'codex', auth: 'apikey', provider: 'openai' });
		expect(currentChoice('codex', dir)).toEqual({
			agent: 'codex',
			auth: 'apikey',
			provider: 'openai'
		});
	});

	it('keeps the CLI’s saved tool choice readable, and reads the CLI’s own', () => {
		writeSavedChoice(dir, { agent: 'pi', auth: 'apikey', provider: 'anthropic' });
		expect(readSavedChoice(dir)).toEqual({ harness: 'pi', auth: 'apikey', provider: 'anthropic' });
		writeFileSync(path.join(dir, 'harness.json'), JSON.stringify({ harness: 'codex' }));
		expect(readSavedChoice(dir)).toEqual({ harness: 'codex', auth: null, provider: null });
		expect(madeChoice('codex', dir)).toBeNull();
	});
});
