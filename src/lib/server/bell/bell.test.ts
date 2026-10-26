import { describe, expect, it } from 'vitest';
import { ShipsBell } from './bell';
import type { FirstmateSessionView, Picker } from '../../types';
import { fleetOf, prGreen, question, taskSummary } from '../../../../tests/helpers/task-summary';

const picker = (signature: string, title = 'Which onboarding design should ship?'): Picker => ({
	title,
	tabs: [],
	options: [],
	multiSelect: false,
	submitMoves: null,
	signature
});
const session = (p: Picker | null) => ({ state: 'ours', picker: p }) as FirstmateSessionView;

function clockedBell(start = Date.parse('2026-10-27T10:00:00Z')) {
	const clock = { t: start };
	return { clock, bell: new ShipsBell({ now: () => clock.t }) };
}

describe('ShipsBell', () => {
	it('takes the first fleet read as the baseline and rings nothing for it', () => {
		const { bell } = clockedBell();
		expect(bell.observe(fleetOf([prGreen('a'), question('b')]))).toEqual([]);
		expect(bell.recent()).toEqual([]);
		// Still true on the next read: not news.
		expect(bell.observe(fleetOf([prGreen('a'), question('b')]))).toEqual([]);
	});

	it('waits for a fleet that was actually read before taking the baseline', () => {
		const { bell } = clockedBell();
		expect(bell.observe({ ...fleetOf([]), collectedAt: null })).toEqual([]);
		expect(bell.observe(fleetOf([question('b')]))).toEqual([]);
	});

	it('rings each new moment once, however often the fleet is read', () => {
		const { bell, clock } = clockedBell();
		bell.observe(fleetOf([taskSummary('a', 'working')]));
		clock.t += 5000;
		const rung = bell.observe(fleetOf([prGreen('a')]));
		expect(rung.map((r) => r.kind)).toEqual(['pr-green']);
		expect(rung[0].at).toBe('2026-10-27T10:00:05.000Z');
		expect(bell.observe(fleetOf([prGreen('a')]))).toEqual([]);
		// The PR goes red and green again: still the same moment.
		bell.observe(fleetOf([taskSummary('a', 'working')]));
		expect(bell.observe(fleetOf([prGreen('a')]))).toEqual([]);
		expect(bell.recent().map((r) => r.id)).toEqual([rung[0].id]);
	});

	it('rings for a new task that arrives already waiting on the captain', () => {
		const { bell } = clockedBell();
		bell.observe(fleetOf([]));
		expect(bell.observe(fleetOf([question('new')])).map((r) => r.kind)).toEqual(['question']);
	});

	it('rings a landing it saw happen, or a recent merge, but not an old one that turns up', () => {
		const { bell } = clockedBell();
		bell.observe(fleetOf([prGreen('a')]));
		expect(bell.observe(fleetOf([taskSummary('a', 'landed')])).map((r) => r.kind)).toEqual([
			'landed'
		]);
		const old = taskSummary('old', 'landed', { mergedAt: '2026-10-20T10:00:00Z' });
		expect(bell.observe(fleetOf([old]))).toEqual([]);
		const fresh = taskSummary('fresh', 'landed', { mergedAt: '2026-10-27T09:55:00Z' });
		expect(bell.observe(fleetOf([fresh])).map((r) => r.id)).toEqual(['landed:fresh']);
	});

	it('sends a newly connected page only the recent alerts', () => {
		const { bell, clock } = clockedBell();
		bell.observe(fleetOf([]));
		bell.observe(fleetOf([question('a')]));
		clock.t += 13 * 3600_000;
		bell.observe(fleetOf([question('a'), question('b')]));
		expect(bell.recent().map((r) => r.taskId)).toEqual(['b']);
	});

	it('passes each alert to its subscribers', () => {
		const { bell } = clockedBell();
		const heard: string[] = [];
		bell.subscribe((e) => heard.push(e.type === 'alert' ? e.data.id : `settled ${e.data}`));
		bell.observe(fleetOf([]));
		bell.observe(fleetOf([question('a')]));
		expect(heard).toEqual([bell.recent()[0].id]);
	});
});

describe('ShipsBell and the Firstmate session', () => {
	it('rings when Firstmate asks the captain something, and settles it once answered', () => {
		const { bell } = clockedBell();
		const heard: string[] = [];
		bell.subscribe((e) => heard.push(e.type === 'alert' ? `alert ${e.data.title}` : 'settled'));
		expect(bell.observeSession(session(null))).toEqual([]);
		const [a] = bell.observeSession(session(picker('one')));
		expect(a).toMatchObject({
			kind: 'question',
			taskId: null,
			captain: true,
			title: 'Firstmate',
			text: 'Which onboarding design should ship?',
			actions: [{ kind: 'open', label: 'Answer in chat', href: '/' }]
		});
		expect(bell.observeSession(session(picker('one')))).toEqual([]);
		expect(bell.recent().map((r) => r.id)).toEqual([a.id]);
		bell.observeSession(session(null));
		expect(heard).toEqual(['alert Firstmate', 'settled']);
		// Answered: a page that connects now is not shown it.
		expect(bell.recent()).toEqual([]);
	});

	it('takes a question already open at start as the baseline, and rings the next one', () => {
		const { bell } = clockedBell();
		expect(bell.observeSession(session(picker('old')))).toEqual([]);
		expect(bell.observeSession(session(picker('new'))).map((r) => r.taskId)).toEqual([null]);
	});
});
