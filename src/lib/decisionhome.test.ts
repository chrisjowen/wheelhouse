import { describe, expect, it } from 'vitest';
import {
	cardLink,
	inFilter,
	openDecisions,
	sortDecisions,
	standing,
	taskLink
} from './decisionhome';
import { cardHref, optionsFor, type InboxCard } from './inbox';

const card = (id: string, o: Partial<InboxCard> = {}): InboxCard => ({
	id,
	taskId: id.split(':')[0],
	taskTitle: id,
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: `${id}?`,
	title: `${id}?`,
	origin: null,
	following: null,
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		previewTask: null,
		board: null,
		checks: null,
		screenshots: [],
		docs: []
	},
	options: optionsFor('hold'),
	recommendation: null,
	choices: null,
	sent: null,
	...o
});
const at = (h: number) => `2026-11-17T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('the Decisions home', () => {
	const waitingNew = card('a:captain-hold', { askedAt: at(9) });
	const waitingOld = card('b:captain-hold', { askedAt: at(3) });
	const talking = card('c:captain-hold', { askedAt: at(1), following: at(10) });
	const theirs = card('d:pick', { kind: 'decision', owner: 'firstmate', askedAt: at(0) });
	const undated = card('e:captain-hold');

	it('puts what waits on the captain first, then what is talked through, then Firstmate’s, oldest first', () => {
		expect(standing(waitingNew)).toBe('waiting');
		expect(standing(talking)).toBe('following');
		expect(standing(theirs)).toBe('firstmate');
		expect(
			sortDecisions([theirs, undated, waitingNew, talking, waitingOld]).map((c) => c.id)
		).toEqual([waitingOld.id, waitingNew.id, undated.id, talking.id, theirs.id]);
	});

	it('sorts by age alone when asked, a question with no time last', () => {
		const all = [waitingNew, theirs, undated, waitingOld];
		expect(sortDecisions(all, 'oldest').map((c) => c.id)).toEqual([
			theirs.id,
			waitingOld.id,
			waitingNew.id,
			undated.id
		]);
		expect(sortDecisions(all, 'newest').map((c) => c.id)).toEqual([
			undated.id,
			waitingNew.id,
			waitingOld.id,
			theirs.id
		]);
	});

	it('filters to a task (a second mate’s by its id here), a project or a type', () => {
		const mates = card('mate-1:q', {
			secondMate: { id: 'mate-1', taskId: 'share', taskTitle: 'Share links' }
		});
		expect(inFilter(mates, { taskId: 'share@mate-1' })).toBe(true);
		expect(inFilter(mates, { taskId: 'mate-1' })).toBe(true);
		expect(inFilter(waitingNew, { taskId: 'b' })).toBe(false);
		expect(inFilter(waitingNew, { projectId: 'atlas' })).toBe(false);
		expect(inFilter(theirs, { kind: 'decision', projectId: 'lumen' })).toBe(true);
		expect(inFilter(theirs, {})).toBe(true);
	});

	it('leaves out a question whose answer has reached Firstmate', () => {
		const sent = card('f:captain-hold', {
			sent: {
				choice: 'approve',
				picks: null,
				note: null,
				at: at(5),
				delivery: 'delivered',
				detail: null,
				requestId: 'r'
			}
		});
		const failed = { ...sent, id: 'g:captain-hold', sent: { ...sent.sent!, delivery: 'failed' } };
		expect(openDecisions([sent, failed, waitingOld]).map((c) => c.id)).toEqual([
			waitingOld.id,
			failed.id
		]);
	});

	it('reads a link to a task’s page, and to one decision, as their slide-outs', () => {
		const u = (p: string) => new URL(p, 'http://wh.test');
		expect(taskLink(u('/tasks/share%40mate-1'))).toEqual({ id: 'share@mate-1', tab: null });
		expect(taskLink(u('/tasks/chart?tab=talk'))).toEqual({ id: 'chart', tab: 'talk' });
		expect(taskLink(u('/tasks/chart/doc?path=x.md'))).toBeNull();
		expect(taskLink(u('/tasks'))).toBeNull();
		expect(cardLink(u(cardHref('upload:captain-hold')))).toBe('upload:captain-hold');
		expect(cardLink(u('/inbox'))).toBeNull();
		expect(cardLink(u('/inbox#handled'))).toBeNull();
	});
});
