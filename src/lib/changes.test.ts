import { describe, expect, it } from 'vitest';
import { changesLine, changeWhere, splitChanges } from './changes';
import type { ChangeRequest } from './types';

const req = (o: Partial<ChangeRequest> = {}): ChangeRequest => ({
	id: 'x',
	source: 'github',
	kind: 'thread',
	author: 'captain',
	text: 'Rename it',
	at: '2026-10-27T10:00:00Z',
	url: null,
	where: null,
	state: 'open',
	...o
});

describe('changes wording', () => {
	it('names the file and line a request is on', () => {
		expect(changeWhere(req({ where: { path: 'src/a.ts', line: 7 } }))).toBe('src/a.ts, line 7');
		expect(changeWhere(req({ where: { path: 'src/a.ts', line: null } }))).toBe('src/a.ts');
		expect(changeWhere(req())).toBeNull();
	});

	it('puts what is still to do apart from what was resolved or addressed', () => {
		const items = [
			req({ id: 'a' }),
			req({ id: 'b', state: 'resolved' }),
			req({ id: 'c', state: 'addressed' })
		];
		const { open, done } = splitChanges(items);
		expect(open.map((c) => c.id)).toEqual(['a']);
		expect(done.map((c) => c.id)).toEqual(['b', 'c']);
	});

	it('counts them in one line', () => {
		expect(changesLine(null)).toBeNull();
		expect(changesLine({ active: false, basis: null, since: null, items: [] })).toBeNull();
		expect(changesLine({ active: true, basis: 'x', since: null, items: [] })).toBe(
			'Changes requested'
		);
		expect(
			changesLine({
				active: true,
				basis: 'x',
				since: null,
				items: [req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c', state: 'addressed' })]
			})
		).toBe('2 changes to make · 1 done');
		expect(
			changesLine({ active: false, basis: null, since: null, items: [req({ state: 'resolved' })] })
		).toBe('1 done');
	});
});
