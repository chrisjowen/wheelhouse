import { describe, expect, it } from 'vitest';
import { optionsFor, type InboxCard } from '$lib/inbox';
import type { SecondMate, TaskSummary } from '$lib/types';
import { prGreen, question, taskSummary } from '../../tests/helpers/task-summary';
import {
	ALL_CREWS,
	OWN_CREW,
	byCrew,
	crewChoice,
	crewOfCard,
	crewOfTask,
	crewsOf,
	deckOf,
	lineState,
	sharedSuffix,
	shortAge
} from './ondeck';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const mate = (id: string, host: string | null): SecondMate => ({
	id,
	where: host ? 'remote' : 'local',
	host,
	home: null,
	stateLabel: 'Working',
	tone: 'working',
	health: {
		online: 'online',
		text: 'Online',
		reason: null,
		observedAt: null,
		ageSeconds: 5,
		cached: false,
		host: { cpu: null, memory: null, disk: null },
		hostNote: null
	},
	projects: [],
	inFlight: [],
	queued: [],
	landed: [],
	prs: [],
	previews: [],
	previewNote: null,
	decisions: 0,
	captainDecisions: 0,
	omitted: [],
	lastReport: null,
	peek: { available: true, reason: null }
});

const onMate = (t: TaskSummary, id: string, host: string | null = 'box'): TaskSummary => ({
	...t,
	id: `${t.id}@${id}`,
	secondMate: { id, host, where: host ? 'remote' : 'local' }
});

const card = (o: Partial<InboxCard>): InboxCard => ({
	id: 'x:captain-hold',
	taskId: 'x',
	taskTitle: 'x',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Flag or everyone?',
	askedAt: minsAgo(20),
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: []
	},
	options: optionsFor('hold'),
	recommendation: null,
	choices: null,
	sent: null,
	...o
});

const of = (cards: InboxCard[]) => ({ shown: cards, all: cards });

describe('crews', () => {
	it('puts Firstmate’s own crew first, then each second mate in the fleet’s order', () => {
		const crews = crewsOf([mate('hostinger-mate', 'hostinger'), mate('aws-mate', 'aws')]);
		expect(crews.map((c) => [c.id, c.label, c.short])).toEqual([
			[OWN_CREW, 'Firstmate', 'Firstmate'],
			['hostinger-mate', 'hostinger-mate', 'hostinger'],
			['aws-mate', 'aws-mate', 'aws']
		]);
	});

	it('gives a crew the lines name but the fleet does not a group of its own', () => {
		const crews = crewsOf(
			[mate('tokyo', 'box')],
			[{ crew: OWN_CREW }, { crew: 'gone' }, { crew: 'tokyo' }]
		);
		expect(crews.map((c) => [c.id, c.mate?.id ?? null])).toEqual([
			[OWN_CREW, null],
			['tokyo', 'tokyo'],
			['gone', null]
		]);
	});

	it('drops only a suffix every second mate shares, and never the whole name', () => {
		expect(sharedSuffix(['hostinger-mate', 'aws-mate'])).toBe('-mate');
		expect(sharedSuffix(['tokyo', 'paris'])).toBe('');
		expect(sharedSuffix(['north-mate', 'south'])).toBe('');
		expect(sharedSuffix(['solo-mate'])).toBe('');
		expect(sharedSuffix(['-mate', 'aws-mate'])).toBe('');
	});

	it('remembers a crew only while it is in the fleet', () => {
		const crews = crewsOf([mate('tokyo', 'box')]);
		expect(crewChoice('tokyo', crews)).toBe('tokyo');
		expect(crewChoice(OWN_CREW, crews)).toBe(OWN_CREW);
		expect(crewChoice('gone', crews)).toBe(ALL_CREWS);
		expect(crewChoice(null, crews)).toBe(ALL_CREWS);
	});

	it('knows whose crew a task and a decision belong to', () => {
		const theirs = onMate(taskSummary('pdf', 'working'), 'tokyo');
		expect(crewOfTask(taskSummary('own', 'working'))).toBe(OWN_CREW);
		expect(crewOfTask(theirs)).toBe('tokyo');
		expect(crewOfCard(card({ secondMate: { id: 'paris', taskId: 'a', taskTitle: 'A' } }), [])).toBe(
			'paris'
		);
		expect(crewOfCard(card({ taskId: 'pdf@tokyo' }), [theirs])).toBe('tokyo');
		expect(crewOfCard(card({ taskId: 'nowhere' }), [])).toBe(OWN_CREW);
	});
});

describe('deckOf', () => {
	it('shows a held task once, as its decision, including a second mate’s held task', () => {
		const held = question('upload');
		const theirs = onMate(question('share'), 'tokyo');
		const cards = [
			card({ id: 'upload:captain-hold', taskId: 'upload' }),
			card({
				id: 'tokyo:captain-hold',
				taskId: 'tokyo',
				secondMate: { id: 'tokyo', taskId: 'share', taskTitle: 'Share links' }
			})
		];
		const d = deckOf([held, theirs], NOW, of(cards));
		expect(d.needs.map((l) => [l.kind, l.crew])).toEqual([
			['decision', OWN_CREW],
			['decision', 'tokyo']
		]);
		// Answered or snoozed here, the decision leaves, and its task does not come back as a line.
		expect(deckOf([held, theirs], NOW, { shown: [], all: cards }).needs).toEqual([]);
	});

	it('shows a green pull request as its merge call while the call is showing, else as its own line', () => {
		const pr = prGreen('chart');
		const merge = card({ id: 'chart:merge-pr', taskId: 'chart', kind: 'merge', key: 'merge-pr' });
		expect(deckOf([pr], NOW, of([merge])).needs.map((l) => l.key)).toEqual([
			'decision:chart:merge-pr'
		]);
		expect(deckOf([pr], NOW, { shown: [], all: [merge] }).needs.map((l) => l.key)).toEqual([
			'task:chart'
		]);
	});

	it('keeps a held task’s own line, with its ask, when the inbox cannot be read', () => {
		const d = deckOf([question('upload', 'Flag or everyone?')], NOW, null);
		expect(d.needs).toHaveLength(1);
		expect(d.needs[0]).toMatchObject({ kind: 'task', text: 'Flag or everyone?' });
	});

	it('leaves out what Firstmate is settling itself, and decisions outside the scoped project', () => {
		const d = deckOf(
			[],
			NOW,
			of([
				card({ id: 'a', owner: 'firstmate' }),
				card({ id: 'b', projectId: 'other' }),
				card({ id: 'c', projectId: 'lumen' })
			]),
			'lumen'
		);
		expect(d.needs.map((l) => l.key)).toEqual(['decision:c']);
	});

	it('orders Needs you: decisions, failed steps, then reviews and calls; reviews name the work', () => {
		const deployed = taskSummary('ship', 'landed', {
			shortTitle: 'Quota page',
			mergedAt: minsAgo(30),
			passage: {
				track: 'ship',
				steps: [
					{
						key: 'landed',
						label: 'Landed',
						short: 'Landed',
						state: 'done',
						note: null,
						column: 'landed',
						evidence: [],
						failed: false
					},
					{
						key: 'deployed',
						label: 'Deployed',
						short: 'Deploy',
						state: 'current',
						note: null,
						column: 'deployed',
						evidence: [],
						failed: true
					}
				],
				current: 1,
				basis: '',
				custom: false,
				live: null,
				link: null,
				checks: []
			}
		});
		const pr = { ...prGreen('chart'), shortTitle: 'Fleet chart' };
		const d = deckOf([pr, deployed], NOW, of([card({ id: 'q', taskId: 'other' })]));
		expect(d.needs.map((l) => [l.key, l.text])).toEqual([
			['decision:q', 'Flag or everyone?'],
			['task:ship', 'Quota page'],
			['task:chart', 'Fleet chart']
		]);
		// A failed deploy is not also a landed line.
		expect(d.landed).toEqual([]);
	});

	it('sorts the rest into Firstmate’s questions, under way, up next and landed', () => {
		const asking = taskSummary('ask', 'with-firstmate', {
			attention: { kind: 'decision', owner: 'firstmate', text: 'CSV or JSON?', url: null }
		});
		const d = deckOf(
			[
				asking,
				taskSummary('build', 'working', {
					activity: { text: 'x', at: minsAgo(3), source: 'status' }
				}),
				taskSummary('later', 'queued'),
				taskSummary('done', 'landed', { mergedAt: minsAgo(60) }),
				taskSummary('drop', 'closed')
			],
			NOW,
			of([])
		);
		expect(d.withFirstmate.map((l) => l.text)).toEqual(['CSV or JSON?']);
		expect(d.under.map((l) => [l.key, l.at])).toEqual([['task:build', minsAgo(3)]]);
		expect(d.next.map((l) => l.key)).toEqual(['task:later']);
		expect(d.landed.map((l) => [l.key, l.at])).toEqual([['task:done', minsAgo(60)]]);
	});
});

describe('byCrew', () => {
	const crews = crewsOf([mate('tokyo', 'box'), mate('paris', null)]);
	const d = deckOf(
		[taskSummary('own', 'working'), onMate(taskSummary('pdf', 'working'), 'paris')],
		NOW,
		of([])
	);

	it('groups lines by crew in crew order, leaving out crews with none', () => {
		expect(byCrew(d.under, crews, ALL_CREWS).map((g) => [g.crew.id, g.lines.length])).toEqual([
			[OWN_CREW, 1],
			['paris', 1]
		]);
	});

	it('keeps the picked crew even when it has nothing here', () => {
		expect(byCrew(d.under, crews, 'tokyo').map((g) => [g.crew.id, g.lines.length])).toEqual([
			['tokyo', 0]
		]);
	});
});

describe('a line’s state and age', () => {
	it('says what is wrong or whose turn it is, in words', () => {
		expect(lineState(taskSummary('a', 'blocked')).label).toBe('Stuck');
		expect(lineState(taskSummary('a', 'lost')).label).toBe('Not responding');
		expect(lineState(prGreen('a')).label).toBe('Your review');
		expect(lineState(question('a')).label).toBe('Your call');
		expect(lineState(taskSummary('a', 'working', { busy: true })).label).toBe('Working');
		expect(lineState(taskSummary('a', 'queued')).label).toBe('Queued');
	});

	it('shortens the age for the line’s right-hand column', () => {
		expect(shortAge(minsAgo(0.5), NOW)).toBe('now');
		expect(shortAge(minsAgo(18), NOW)).toBe('18m');
		expect(shortAge(minsAgo(130), NOW)).toBe('2h');
		expect(shortAge(minsAgo(60 * 50), NOW)).toBe('2d');
		expect(shortAge(null, NOW)).toBe('');
	});
});
