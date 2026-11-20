import { describe, expect, it } from 'vitest';
import { forSpeech, isEcho, nextSentences, parseReply, readBlock, speakableProse } from './reply';

describe('parseReply', () => {
	it('splits prose from fenced blocks, marking one still arriving', () => {
		expect(parseReply('Here it is.\n```mermaid\nflowchart LR\n A-->B\n```\nDone.')).toEqual([
			{ type: 'prose', text: 'Here it is.\n' },
			{ type: 'block', lang: 'mermaid', body: 'flowchart LR\n A-->B\n', closed: true },
			{ type: 'prose', text: '\nDone.' }
		]);
		expect(parseReply('Look.\n```chart\n{"type":')).toEqual([
			{ type: 'prose', text: 'Look.\n' },
			{ type: 'block', lang: 'chart', body: '{"type":', closed: false }
		]);
	});

	it('holds back a backtick that may open a fence', () => {
		expect(parseReply('One moment ``')).toEqual([{ type: 'prose', text: 'One moment ' }]);
	});
});

describe('speaking', () => {
	it('speaks prose up to a block still arriving', () => {
		expect(speakableProse('First.\n```chart\n{}\n```\nSecond.')).toBe('First.\n \nSecond.');
		expect(speakableProse('First.\n```chart\n{')).toBe('First.\n');
	});

	it('takes whole sentences only, and the tail at the end', () => {
		expect(nextSentences('Gateway is up. Two things remain', 0, false)).toEqual({
			sentences: ['Gateway is up. '],
			to: 15
		});
		expect(nextSentences('Gateway is up. Two things remain', 15, true)).toEqual({
			sentences: ['Two things remain'],
			to: 32
		});
		expect(nextSentences('Version 3.5 is out', 0, false).sentences).toEqual([]);
	});

	it('says pull requests and links the way a person would', () => {
		expect(forSpeech('See **PR #24** at https://github.com/x/y/pull/24 — merged')).toBe(
			'See pull request 24 at the link, merged'
		);
	});

	it('tells the crew’s own voice from the captain', () => {
		const saying = 'The gateway is mostly landed and two threads remain';
		expect(isEcho('mostly landed and two', saying)).toBe(true);
		expect(isEcho('stop, what about the docket', saying)).toBe(false);
		expect(isEcho('anything', '')).toBe(false);
	});
});

describe('readBlock', () => {
	it('reads diagrams, charts, cards, pictures and notes for Firstmate', () => {
		expect(readBlock('mermaid', 'sequenceDiagram\nA->>B: hi')).toMatchObject({
			kind: 'diagram',
			title: 'Sequence'
		});
		expect(
			readBlock(
				'chart',
				'{"type":"bar","title":"In flight","labels":["a","b"],"series":[{"name":"n","data":[1,2]},]}'
			)
		).toEqual({
			kind: 'chart',
			spec: {
				type: 'bar',
				title: 'In flight',
				labels: ['a', 'b'],
				series: [{ name: 'n', data: [1, 2] }],
				unit: null
			}
		});
		expect(
			readBlock(
				'card',
				'[{"task":"gw-deploy"},{"pr":"https://github.com/o/r/pull/2"},{"link":"javascript:alert(1)"}]'
			)
		).toEqual({
			kind: 'cards',
			cards: [
				{ kind: 'task', task: 'gw-deploy' },
				{ kind: 'pr', url: 'https://github.com/o/r/pull/2', title: null }
			]
		});
		expect(readBlock('image', '{"title":"Fleet","prompt":"ships at night"}')).toEqual({
			kind: 'picture',
			title: 'Fleet',
			prompt: 'ships at night'
		});
		expect(readBlock('firstmate', '{"note":"Hold customer auth"}')).toEqual({
			kind: 'passon',
			note: 'Hold customer auth'
		});
		expect(readBlock('scout', '{"question":"Why is CI slow?","asked":true}')).toEqual({
			kind: 'scout',
			question: 'Why is CI slow?',
			asked: true
		});
		expect(readBlock('scout', '{"question":"Why?"}')).toMatchObject({ asked: false });
		expect(readBlock('scout', '{}')).toMatchObject({ kind: 'invalid' });
	});

	it('says why a block cannot be drawn', () => {
		expect(readBlock('chart', 'not json')).toMatchObject({
			kind: 'invalid',
			reason: 'The chart data could not be read.'
		});
		expect(readBlock('python', 'print(1)')).toMatchObject({
			kind: 'invalid',
			reason: 'Unknown block: python'
		});
	});
});

describe('what a talk about a decision came to', () => {
	it('reads picks, words and a conclusion for the decision it names', () => {
		expect(
			readBlock(
				'decision',
				'{"decision":"trust:captain-hold","picks":{"D2":"c","D4":"b"},"words":{"D1":"(a), and an org baseline next year"}}'
			)
		).toEqual({
			kind: 'decision',
			decision: 'trust:captain-hold',
			picks: { D2: 'c', D4: 'b' },
			words: { D1: '(a), and an org baseline next year' },
			answer: null
		});
		expect(
			readBlock('decision', '{"decision":"npm:captain-hold","answer":"Done, both approved."}')
		).toMatchObject({ kind: 'decision', answer: 'Done, both approved.', picks: {} });
		expect(readBlock('decision', '{"picks":{"D2":"c"}}')).toMatchObject({ kind: 'invalid' });
		expect(readBlock('decision', '{"decision":"x","picks":{"D2":3}}')).toMatchObject({
			kind: 'invalid',
			reason: 'Nothing decided.'
		});
	});
});
