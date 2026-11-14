import { describe, expect, it } from 'vitest';
import {
	authOptions,
	choiceWords,
	CLOUD_PRODUCT,
	completeChoice,
	defaultChoice,
	isReady,
	SETUP_AGENTS
} from './agent';

describe('the agent choices', () => {
	it('offers paying through the cloud product only on a machine it made, never ready yet', () => {
		for (const agent of SETUP_AGENTS) {
			expect(authOptions(agent, false).some((o) => o.auth === 'ours')).toBe(false);
			const ours = authOptions(agent, true).find((o) => o.auth === 'ours');
			expect(ours).toMatchObject({ ready: false, label: `Paid by ${CLOUD_PRODUCT}` });
		}
	});

	it('builds the subscription and key ways, and shows the rest as coming soon', () => {
		const ready = (agent: (typeof SETUP_AGENTS)[number]) =>
			authOptions(agent, false)
				.filter((o) => o.ready)
				.map((o) => `${o.auth}/${o.provider}`);
		expect(ready('claude')).toEqual(['subscription/claude']);
		expect(ready('codex')).toEqual(['subscription/chatgpt', 'apikey/openai']);
		expect(ready('pi')).toEqual(['subscription/chatgpt', 'apikey/openai', 'apikey/anthropic']);
		expect(isReady({ agent: 'pi', auth: 'subscription', provider: 'claude' }, false)).toBe(false);
		expect(isReady({ agent: 'claude', auth: 'apikey', provider: 'anthropic' }, false)).toBe(false);
	});

	it('starts each agent on its subscription', () => {
		expect(defaultChoice('claude')).toEqual({
			agent: 'claude',
			auth: 'subscription',
			provider: 'claude'
		});
		expect(defaultChoice('pi')).toEqual({ agent: 'pi', auth: 'subscription', provider: 'chatgpt' });
	});

	it('fills in a missing or mismatched provider with the first offered', () => {
		expect(completeChoice('pi', 'apikey', undefined, false)).toEqual({
			agent: 'pi',
			auth: 'apikey',
			provider: 'openai'
		});
		expect(completeChoice('pi', 'apikey', 'anthropic', false).provider).toBe('anthropic');
		expect(completeChoice('codex', 'apikey', 'chatgpt', false).provider).toBe('openai');
		expect(completeChoice('codex', 'ours', 'openai', true)).toEqual({
			agent: 'codex',
			auth: 'ours',
			provider: null
		});
	});

	it('says a choice in words', () => {
		expect(choiceWords({ agent: 'codex', auth: 'apikey', provider: 'openai' }, false)).toBe(
			'Codex, with my OpenAI API key'
		);
		expect(choiceWords({ agent: 'pi', auth: 'ours', provider: null }, true)).toBe(
			`Pi, paid by ${CLOUD_PRODUCT}`
		);
	});
});
