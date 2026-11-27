import { describe, expect, it } from 'vitest';
import {
	briefKey,
	briefMessage,
	discussionOf,
	keepDiscussion,
	parseKept,
	readBrief
} from './briefing';

describe('the Captain’s briefing from Live mode', () => {
	it('is the captain’s message, with the hand-offs still waiting attached, and reads back', () => {
		const text = briefMessage({
			minutes: 4,
			briefing: '## Decided\n- Ship the pricing page.',
			handoffs: ['Ask the scout\nabout the polyfill.']
		});
		expect(text).toBe(
			'Captain’s briefing from a Live mode discussion (4 min):\n\n## Decided\n- Ship the pricing page.\n\n## Hand-offs from the call\n- Ask the scout about the polyfill.'
		);
		expect(readBrief(text)).toEqual({
			minutes: 4,
			body: '## Decided\n- Ship the pricing page.\n\n## Hand-offs from the call\n- Ask the scout about the polyfill.'
		});
		expect(readBrief('Why did the bundle grow?')).toBeNull();
	});

	it('is known again by its words, whatever spacing the chat gives them back', () => {
		expect(briefKey('## Decided\n- Ship it.')).toBe(briefKey('  ## Decided   \n\n- Ship it. '));
		expect(briefKey('## Decided\n- Ship it.')).not.toBe(briefKey('## Decided\n- Hold it.'));
	});

	it('keeps what was said in turn, the crew’s drawings left out', () => {
		const lines = discussionOf([
			{ kind: 'notice', at: 't0' },
			{ kind: 'crew', at: 't1', text: 'What’s on your mind?' },
			{ kind: 'captain', at: 't2', text: 'The pricing page.', pending: false },
			{ kind: 'captain', at: 't3', text: 'still being heard', pending: true },
			{ kind: 'crew', at: 't4', text: 'Here it is.\n```tasks\nlumen-pricing\n```\nShip it?' },
			{ kind: 'crew', at: 't5', text: '' }
		]);
		expect(lines).toEqual([
			{ who: 'crew', at: 't1', text: 'What’s on your mind?' },
			{ who: 'captain', at: 't2', text: 'The pricing page.' },
			{ who: 'crew', at: 't4', text: 'Here it is.\n\nShip it?' }
		]);
	});

	it('keeps the newest few discussions, and drops what it cannot read', () => {
		let kept = {};
		for (let i = 0; i < 10; i++)
			kept = keepDiscussion(kept, `k${i}`, [{ who: 'captain', at: 't', text: `${i}` }], i, 3);
		expect(Object.keys(kept).sort()).toEqual(['k7', 'k8', 'k9']);
		expect(parseKept(JSON.stringify(kept))).toEqual(kept);
		expect(parseKept('not json')).toEqual({});
		expect(parseKept(JSON.stringify({ a: { at: 1, lines: [{ who: 'x', text: 1 }] } }))).toEqual({
			a: { at: 1, lines: [] }
		});
	});
});
