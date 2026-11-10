import { describe, expect, it } from 'vitest';
import { taskSummary } from '../../../tests/helpers/task-summary';
import type { Item } from './fold';
import {
	cardTag,
	foldRuns,
	parseMarkers,
	parseThread,
	resolveTopic,
	tagChat,
	threadRows,
	topicName,
	UNSORTED,
	withThread
} from './topics';

const T = Date.parse('2026-11-09T09:00:00.000Z');
const iso = (min: number) => new Date(T + min * 60_000).toISOString();

const captain = (id: string, min: number, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: iso(min),
	queued: false,
	command: false
});
const reply = (
	id: string,
	min: number,
	texts: string[],
	trigger: 'captain' | 'background' = 'captain'
): Item => ({
	kind: 'turn',
	id,
	parts: texts.map((text, i) => ({ kind: 'text', id: `${id}-t${i}`, text })),
	at: iso(min),
	durationMs: null,
	done: true,
	interrupted: false,
	trigger
});

const projects = [
	{ id: 'orgcontrol', name: 'orgcontrol' },
	{ id: 'docket-cloud', name: 'Docket Cloud' }
];
const rewards = taskSummary('oc-season-rewards', 'needs-review', { projectId: 'orgcontrol' });
const webhooks = taskSummary('docket-webhooks', 'with-firstmate', {
	projectId: 'docket-cloud',
	pr: { url: 'https://github.com/demo/docket/pull/7', number: 7 }
});
const tasks = [rewards, webhooks];

describe('parseMarkers', () => {
	it('reads a reply with no marker as one untagged section', () => {
		expect(parseMarkers('All done.')).toEqual([{ slug: null, text: 'All done.' }]);
	});

	it('takes a leading marker off and tags the reply with it', () => {
		expect(parseMarkers('<!-- project: orgcontrol -->\nThe rewards are in review.')).toEqual([
			{ slug: 'orgcontrol', text: 'The rewards are in review.' }
		]);
	});

	it('splits a round-up at each marker, keeping any words before the first', () => {
		const text = [
			'Quick round-up:',
			'',
			'<!-- project: docket-cloud -->',
			'Webhooks are green.',
			'<!--project:time-capsule-->',
			'The scout is back.'
		].join('\n');
		expect(parseMarkers(text)).toEqual([
			{ slug: null, text: 'Quick round-up:' },
			{ slug: 'docket-cloud', text: 'Webhooks are green.' },
			{ slug: 'time-capsule', text: 'The scout is back.' }
		]);
	});

	it('leaves a marker inside a code block alone', () => {
		const text = 'Use this:\n```\n<!-- project: orgcontrol -->\n```';
		expect(parseMarkers(text)).toEqual([{ slug: null, text }]);
	});

	it('ignores a marker mid-line', () => {
		const text = 'Write <!-- project: x --> at the top.';
		expect(parseMarkers(text)).toEqual([{ slug: null, text }]);
	});
});

describe('the thread prefix', () => {
	it('names the thread first and reads it back', () => {
		const sent = withThread('the Stripe keys are in 1Password', 'docket-cloud');
		expect(sent).toBe('[project docket-cloud] the Stripe keys are in 1Password');
		expect(parseThread(sent)).toEqual({
			topic: 'docket-cloud',
			text: 'the Stripe keys are in 1Password'
		});
	});

	it('adds nothing for no thread or Unsorted', () => {
		expect(withThread('hi', null)).toBe('hi');
		expect(withThread('hi', UNSORTED)).toBe('hi');
		expect(parseThread('hi [project x]')).toEqual({ topic: null, text: 'hi [project x]' });
	});
});

describe('resolveTopic', () => {
	it('finds a registered project by id or name, in any case or spelling', () => {
		expect(resolveTopic('OrgControl', projects)).toBe('orgcontrol');
		expect(resolveTopic('docket cloud', projects)).toBe('docket-cloud');
		expect(resolveTopic('Docket_Cloud', projects)).toBe('docket-cloud');
	});

	it('makes anything else a topic of its own', () => {
		expect(resolveTopic('Time-Capsule', projects)).toBe('time-capsule');
		expect(topicName('time-capsule')).toBe('Time capsule');
	});
});

describe('tagChat', () => {
	it('tags a reply by its marker and a captain message by its thread', () => {
		const items = [
			captain('u1', 0, '[project orgcontrol] how far did it get?'),
			reply('a1', 1, ['<!-- project: orgcontrol -->\nIn review.'])
		];
		const tags = tagChat(items, tasks, projects);
		expect(tags.users.get('u1')).toEqual({ topic: 'orgcontrol', source: 'thread' });
		expect(tags.parts.get('a1-t0')).toEqual([
			{
				key: 'a1-t0',
				text: 'In review.',
				tag: { topic: 'orgcontrol', source: 'marker' },
				intro: false
			}
		]);
	});

	it('files each section of a round-up under its own thread', () => {
		const items = [
			reply(
				'a1',
				0,
				[
					'<!-- project: docket-cloud -->\nWebhooks are green.\n<!-- project: time-capsule -->\nThe scout is back.'
				],
				'background'
			)
		];
		const secs = tagChat(items, tasks, projects).parts.get('a1-t0')!;
		expect(secs.map((s) => [s.key, s.tag.topic, s.tag.source])).toEqual([
			['a1-t0', 'docket-cloud', 'marker'],
			['a1-t0#1', 'time-capsule', 'marker']
		]);
	});

	it('marks the words before a round-up’s first marker as its intro', () => {
		const items = [reply('a1', 0, ['Round-up:\n<!-- project: atlas -->\nSearch is indexing.'])];
		const secs = tagChat(items, tasks, projects).parts.get('a1-t0')!;
		expect(secs.map((s) => s.intro)).toEqual([true, false]);
	});

	it('carries a marker into the reply’s later parts', () => {
		const items = [reply('a1', 0, ['<!-- project: time-capsule -->\nLooking.', 'Found it.'])];
		const tags = tagChat(items, tasks, projects);
		expect(tags.parts.get('a1-t1')![0].tag).toEqual({ topic: 'time-capsule', source: 'marker' });
	});

	it('reads the thread of a reply after its quote', () => {
		const items = [
			captain('u1', 0, '> Replying to Firstmate: “In review.”\n\n[project orgcontrol] go with 1.5')
		];
		expect(tagChat(items, tasks, projects).users.get('u1')).toEqual({
			topic: 'orgcontrol',
			source: 'thread'
		});
	});

	it('guesses from the one project of the tasks a message names', () => {
		const items = [
			captain('u1', 0, 'and https://github.com/demo/docket/pull/7?'),
			reply('a1', 1, ['oc-season-rewards passed.'], 'background'),
			reply('a2', 2, ['oc-season-rewards and docket-webhooks both passed.'], 'background')
		];
		const tags = tagChat(items, tasks, projects);
		expect(tags.users.get('u1')).toEqual({ topic: 'docket-cloud', source: 'guess' });
		expect(tags.parts.get('a1-t0')![0].tag).toEqual({ topic: 'orgcontrol', source: 'guess' });
		expect(tags.parts.get('a2-t0')![0].tag).toEqual({ topic: UNSORTED, source: null });
	});

	it('guesses from a landed task’s preview address', () => {
		const landed = taskSummary('oc-preview', 'landed', {
			projectId: 'orgcontrol',
			mergedAt: iso(5),
			preview: { url: 'http://127.0.0.1:5240/', reportedAt: iso(0) }
		});
		const items = [reply('a1', 1, ['Preview: http://127.0.0.1:5240/'], 'background')];
		const tags = tagChat(items, [landed], projects);
		expect(tags.parts.get('a1-t0')![0].tag).toEqual({ topic: 'orgcontrol', source: 'guess' });
	});

	it('guesses an answer to the captain is in the thread of the message it answers', () => {
		const items = [
			captain('u1', 0, '[project time-capsule] who holds the keys?'),
			reply('a1', 1, ['Not settled yet.']),
			reply('a2', 5, ['A wake about nothing in particular.'], 'background')
		];
		const tags = tagChat(items, tasks, projects);
		expect(tags.parts.get('a1-t0')![0].tag).toEqual({ topic: 'time-capsule', source: 'guess' });
		expect(tags.parts.get('a2-t0')![0].tag.topic).toBe(UNSORTED);
	});

	it('leaves what it cannot place Unsorted', () => {
		const items = [captain('u1', 0, 'morning'), reply('a1', 1, ['Morning, captain.'])];
		const tags = tagChat(items, tasks, projects);
		expect(tags.users.get('u1')!.topic).toBe(UNSORTED);
		expect(tags.parts.get('a1-t0')![0].tag.topic).toBe(UNSORTED);
	});

	it('lets the captain’s re-tag override everything', () => {
		const items = [
			captain('u1', 0, '[project orgcontrol] the thing with the keys'),
			reply('a1', 1, ['<!-- project: orgcontrol -->\nOne.\n<!-- project: orgcontrol -->\nTwo.'])
		];
		const tags = tagChat(items, tasks, projects, { u1: 'security-fixes', 'a1-t0#1': UNSORTED });
		expect(tags.users.get('u1')).toEqual({ topic: 'security-fixes', source: 'you' });
		expect(tags.parts.get('a1-t0')!.map((s) => s.tag)).toEqual([
			{ topic: 'orgcontrol', source: 'marker' },
			{ topic: UNSORTED, source: null }
		]);
	});
});

describe('cardTag', () => {
	it('tags a card by its project unless the captain moved it', () => {
		expect(cardTag('d1', 'orgcontrol', 'decision')).toEqual({
			topic: 'orgcontrol',
			source: 'decision'
		});
		expect(cardTag('d1', 'unassigned', 'task').topic).toBe(UNSORTED);
		expect(cardTag('d1', 'orgcontrol', 'decision', { d1: 'security' })).toEqual({
			topic: 'security',
			source: 'you'
		});
	});
});

describe('threadRows', () => {
	it('lists threads newest first with counts, Unsorted last and the picked one kept', () => {
		const rows = threadRows(
			[
				{ topics: ['orgcontrol'], at: iso(0), needs: true },
				{ topics: [UNSORTED], at: iso(9) },
				{ topics: ['docket-cloud', 'orgcontrol'], at: iso(5) },
				{ topics: ['docket-cloud'], at: iso(1) }
			],
			'security'
		);
		expect(rows.map((r) => [r.topic, r.count, r.needs])).toEqual([
			['docket-cloud', 2, 0],
			['orgcontrol', 2, 1],
			['security', 0, 0],
			[UNSORTED, 1, 0]
		]);
	});
});

describe('foldRuns', () => {
	it('gathers each run of entries outside the thread under its first', () => {
		const e = (key: string, topics: string[], min: number) => ({ key, topics, at: iso(min) });
		const runs = foldRuns(
			[
				e('a', ['orgcontrol'], 0),
				e('b', ['docket-cloud'], 1),
				e('c', [UNSORTED, 'docket-cloud'], 2),
				e('d', ['orgcontrol', 'docket-cloud'], 3),
				e('f', ['security'], 4)
			],
			'orgcontrol'
		);
		expect([...runs.keys()]).toEqual(['b', 'c', 'f']);
		expect(runs.get('c')).toEqual({
			first: 'b',
			count: 2,
			topics: ['docket-cloud', UNSORTED],
			from: iso(1),
			to: iso(2)
		});
		expect(runs.get('f')!.first).toBe('f');
	});
});
