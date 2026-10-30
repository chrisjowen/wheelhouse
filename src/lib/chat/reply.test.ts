import { describe, expect, it } from 'vitest';
import { composeReply, parseReply, plain, quotes, snippetOf, SNIPPET_MAX } from './reply';

const long =
	'The scout found it: the **40% growth is the bundled URL polyfill**, pulled in for Node 16. Dropping Node 16 in 3.0 brings the bundle back to its 2.0 size. Want me to queue that for 3.0?';

describe('replying to a message', () => {
	it('reads a Markdown reply as one plain line', () => {
		expect(
			plain(
				'## Done\n\n- **Share links** is in [lumen#142](https://github.com/x/y/pull/142)\n- `npm test` *passes*'
			)
		).toBe('Done Share links is in lumen#142 npm test passes');
	});

	it('shows a mentioned task as its chip, not its id', () => {
		expect(plain('Look at [task lumen-share: Share links] first')).toBe(
			'Look at # Share links first'
		);
	});

	it('quotes a long message by its start, cut at a word', () => {
		const s = snippetOf(long);
		expect(s.length).toBeLessThanOrEqual(SNIPPET_MAX);
		expect(s).toBe(
			'The scout found it: the 40% growth is the bundled URL polyfill, pulled in for Node 16. Dropping Node 16 in 3.0 brings the bundle back to…'
		);
		expect(snippetOf('Aye, captain.')).toBe('Aye, captain.');
	});

	it('sends the quote as a Markdown line before the captain’s words', () => {
		expect(
			composeReply({ who: 'firstmate', snippet: 'Queued for 3.0.' }, '  Thanks.\nAnd onboarding? ')
		).toBe('> Replying to Firstmate: “Queued for 3.0.”\n\nThanks.\nAnd onboarding?');
		expect(composeReply({ who: 'captain', snippet: 'Ship it' }, 'Actually, wait.')).toBe(
			'> Replying to my message: “Ship it”\n\nActually, wait.'
		);
	});

	it('reads a sent reply back as its quote and the captain’s words', () => {
		const to = { who: 'firstmate' as const, snippet: snippetOf(long) };
		expect(parseReply(composeReply(to, 'Good find.\n\nDoes it break anyone?'))).toEqual({
			to,
			body: 'Good find.\n\nDoes it break anyone?'
		});
		expect(parseReply('> Replying to my message: “Ship it”\r\n\r\nWait.')).toEqual({
			to: { who: 'captain', snippet: 'Ship it' },
			body: 'Wait.'
		});
	});

	it('leaves other messages, and quotes the captain typed, as they are', () => {
		for (const text of [
			'Morning! What’s on the board?',
			'> a quote of my own\n\nand a comment',
			'> Replying to Firstmate: “no words after it”',
			'> Replying to Firstmate: “blank”\n\n   '
		])
			expect(parseReply(text)).toEqual({ to: null, body: text });
	});

	it('finds the message a quote was taken from', () => {
		const cut = { who: 'firstmate' as const, snippet: snippetOf(long) };
		expect(quotes(cut, long)).toBe(true);
		expect(quotes(cut, 'The scout found it: something else')).toBe(false);
		const whole = { who: 'captain' as const, snippet: 'Ship it' };
		expect(quotes(whole, 'Ship it')).toBe(true);
		expect(quotes(whole, 'Ship it now')).toBe(false);
		expect(quotes(whole, '')).toBe(false);
	});
});
