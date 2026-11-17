import { describe, expect, it } from 'vitest';
import { plainOptions, readTalk, talkPrompt, talkRequest, type TalkRequest } from './decisiontalk';

const options = [
	{ n: 1, label: 'Send all', detail: null, recommended: false },
	{ n: 2, label: 'Ask each time', detail: null, recommended: true }
];
const req = (said: string | null): TalkRequest => ({
	cardId: 'live:end-default',
	mode: said ? 'ask' : 'brief',
	options,
	messages: said
		? [
				{ who: 'crew', text: 'Here it is.' },
				{ who: 'captain', text: said }
			]
		: []
});

describe('talking a decision through', () => {
	it('never takes a question as the outcome, whatever the run says', () => {
		const out = { reply: 'Two options…', outcome: { conclusion: 'Tell me about it' } };
		expect(readTalk(out, req('tell me about this decision?'))?.outcome).toBeNull();
		expect(readTalk({ reply: 'Hello', outcome: { option: 2 } }, req(null))?.outcome).toBeNull();
	});

	it('takes a clear pick or an agreed conclusion, and only an option that exists', () => {
		expect(
			readTalk({ reply: 'Noted.', outcome: { option: 2 } }, req('go with 2'))?.outcome
		).toEqual({ option: 2 });
		expect(
			readTalk({ reply: 'Noted.', outcome: { option: 7 } }, req('go with 7'))?.outcome
		).toBeNull();
		expect(
			readTalk(
				{ reply: 'Agreed.', outcome: { conclusion: '  Ask, preset to send all. ' } },
				req('ok do that')
			)?.outcome
		).toEqual({ conclusion: 'Ask, preset to send all.' });
	});

	it('keeps the question’s own options from the opening, numbered', () => {
		const out = {
			reply: 'B or C.',
			outcome: null,
			options: [
				{ label: 'B: shared core', detail: 'one CLI', recommended: true },
				{ label: 'C: cloud only', recommended: false }
			]
		};
		expect(readTalk(out, req(null))?.options).toEqual([
			{ n: 1, label: 'B: shared core', detail: 'one CLI', recommended: true },
			{ n: 2, label: 'C: cloud only', detail: null, recommended: false }
		]);
		expect(readTalk({ reply: 'x', outcome: null }, req(null))).toEqual({
			reply: 'x',
			outcome: null,
			options: []
		});
		expect(readTalk({ reply: ' ', outcome: null }, req(null))).toBeNull();
	});

	it('asks for the question’s own options only when the form has plain answers', () => {
		const plain = [
			{ n: 1, label: 'Go ahead', detail: null, recommended: true },
			{ n: 2, label: 'Not like this', detail: null, recommended: false }
		];
		expect(plainOptions(plain)).toBe(true);
		expect(plainOptions(options)).toBe(false);
		const ctx = {
			kind: 'hold',
			title: 'Docket shape',
			question: '(B, recommended) shared core or (C) cloud only',
			recommendation: null,
			task: { id: 'docket-call', title: 'Docket shape', project: 'docket', status: 'Your call' },
			brief: 'Pick the product shape.',
			history: ['2026-11-16 12:01 parked'],
			report: { path: 'data/x/report.md', text: '# Report' },
			evidence: null,
			findings: [],
			origin: 'dc-scout'
		};
		const opening = talkPrompt(ctx, { cardId: 'c', mode: 'brief', options: plain, messages: [] });
		expect(opening).toContain('(B, recommended) shared core or (C) cloud only');
		expect(opening).toContain('# The report it names (data/x/report.md)');
		expect(opening).toContain('real alternatives');
		expect(opening).toContain('at most 45 words');
		expect(talkPrompt(ctx, req('why?'))).toContain('Captain: why?');
	});

	it('reads a request, dropping what is not part of one', () => {
		expect(talkRequest({})).toBeNull();
		expect(
			talkRequest({
				cardId: 'a:b',
				options: [{ n: 1, label: ' Go ' }, { label: 'no number' }],
				messages: [
					{ who: 'captain', text: 'hi' },
					{ who: 'system', text: 'x' }
				]
			})
		).toEqual({
			cardId: 'a:b',
			mode: 'ask',
			options: [{ n: 1, label: 'Go', detail: null, recommended: false }],
			messages: [{ who: 'captain', text: 'hi' }]
		});
	});
});
