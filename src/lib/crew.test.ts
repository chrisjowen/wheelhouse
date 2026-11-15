import { describe, expect, it } from 'vitest';
import type { Item } from './chat/fold';
import {
	canDiscuss,
	closedText,
	crewBody,
	crewRef,
	crewText,
	digestText,
	discussionEntries,
	parseCrewBody,
	type CrewMessage
} from './crew';

const message = (id: string, at: string, over: Partial<CrewMessage> = {}): CrewMessage => ({
	id,
	kind: 'say',
	text: `said ${id}`,
	at,
	delivery: 'sent',
	error: null,
	seen: false,
	told: 'sent',
	...over
});

const turn = (id: string, at: string): Item => ({
	kind: 'turn',
	id,
	parts: [{ kind: 'text', id: `${id}-t`, text: `worker ${id}` }],
	at,
	durationMs: null,
	done: true,
	interrupted: false,
	trigger: 'captain'
});
const user = (id: string, at: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at,
	queued: false,
	command: false
});

describe('a captain sidebar message', () => {
	it('carries its marker and reference, and reads back as the captain’s words', () => {
		const body = crewBody(crewRef('r1'), 'Use Pagefind.\n\nKeep it static.');
		expect(body.startsWith('[captain-sidebar ref=wh-crew-r1] From the captain directly')).toBe(
			true
		);
		expect(parseCrewBody(body)).toEqual({
			ref: 'wh-crew-r1',
			text: 'Use Pagefind.\n\nKeep it static.'
		});
	});

	it('is not mistaken for Firstmate’s own steering', () => {
		expect(parseCrewBody('Please rebase on main.')).toBeNull();
		expect(parseCrewBody('Note [captain-sidebar ref=x] inside')).toBeNull();
	});

	it('words its quick actions, and keeps the captain’s own words as typed', () => {
		expect(crewText('say', '  hello  ')).toBe('hello');
		expect(crewText('pause', 'ignored')).toMatch(/^Please pause: finish the step you are on/);
		expect(crewText('resume', '')).toMatch(/^Please resume/);
		expect(crewText('status', '')).toMatch(/what is done, what you are doing now/);
	});
});

describe('the notes Firstmate gets', () => {
	it('say which worker was spoken to, that it is already delivered, and what was said', () => {
		const t = digestText('wh-crew-chat', 'say', 'Use   Pagefind\nplease');
		expect(t).toContain('Crew discussion with wh-crew-chat');
		expect(t).toContain('no need to pass it on');
		expect(t).toContain('I said: “Use Pagefind please”');
		expect(digestText('x', 'pause', '')).toContain('pause after its current step');
		expect(digestText('x', 'say', 'a'.repeat(1000)).length).toBeLessThan(700);
		expect(closedText('x', false)).toContain('ended my direct discussion');
		expect(closedText('x', false)).not.toMatch(/resume/);
		expect(closedText('x', true)).toMatch(
			/still waiting for me to say resume: please tell it to resume/
		);
	});
});

describe('which tasks a discussion can be opened on', () => {
	it('is the captain’s own workers still at work', () => {
		expect(canDiscuss({ id: 'a', status: 'working' })).toBe(true);
		expect(canDiscuss({ id: 'a', status: 'needs-decision' })).toBe(true);
		for (const status of ['queued', 'done', 'landed', 'closed'])
			expect(canDiscuss({ id: 'a', status })).toBe(false);
		expect(canDiscuss({ id: 'a@east', status: 'working' })).toBe(false);
		expect(canDiscuss({ id: 'a', status: 'working', secondMate: { id: 'east' } })).toBe(false);
	});
});

describe('a discussion’s conversation', () => {
	const opened = '2026-11-15T10:00:00.000Z';
	const items: Item[] = [
		turn('w1', '2026-11-15T09:00:00.000Z'),
		user('u1', '2026-11-15T09:30:00.000Z', 'Firstmate operational input waiting: read …'),
		turn('w2', '2026-11-15T09:40:00.000Z'),
		user('u2', '2026-11-15T10:01:00.000Z', ': Firstmate instruction waiting: list …'),
		turn('w3', '2026-11-15T10:02:00.000Z'),
		user('u3', '2026-11-15T10:03:00.000Z', 'carry on')
	];

	it('starts at the worker’s last turn before it opened, with the captain’s messages in time order', () => {
		const { entries, earlier } = discussionEntries(
			items,
			[message('m1', '2026-11-15T10:01:30.000Z')],
			opened
		);
		expect(
			entries.map((e) =>
				e.kind === 'captain' ? `captain:${e.message.id}` : `${e.kind}:${e.item.id}`
			)
		).toEqual(['worker:w2', 'captain:m1', 'worker:w3', 'firstmate:u3']);
		// w1 is left out until asked for; the doorbells never show.
		expect(earlier).toBe(1);
	});

	it('shows everything when asked, still without the inbox doorbells', () => {
		const { entries, earlier } = discussionEntries(items, [], opened, true);
		expect(entries.map((e) => (e.kind === 'captain' ? e.message.id : e.item.id))).toEqual([
			'w1',
			'w2',
			'w3',
			'u3'
		]);
		expect(earlier).toBe(0);
	});

	it('shows just the captain’s messages while the worker’s conversation is not read yet', () => {
		const { entries, earlier } = discussionEntries([], [message('m1', opened)], opened);
		expect(entries).toHaveLength(1);
		expect(earlier).toBe(0);
	});
});
