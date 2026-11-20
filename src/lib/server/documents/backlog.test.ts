import { describe, expect, it } from 'vitest';
import { backlogIndex, parseBacklogRows } from './backlog';
import { readFront, writeFront } from './frontmatter';

describe('parseBacklogRows', () => {
	it('reads a row’s title, project, kind and finish day', () => {
		const rows = parseBacklogRows(
			[
				'## Done',
				'- [x] tm-audit - Audit team-memory health data/tm-audit/report.md (repo: team-memory) (kind: scout) (reported 2026-10-05)',
				'  Captain 2026-10-05: ship it.',
				'- [ ] wh-docs - Wheelhouse Documents: links and search (repo: wheelhouse) (kind: ship) (since 2026-11-18)',
				'- [x] fleet-spend - Weekly token spend blocked-by: other (kind: scout) (landed 2026-11-01)'
			].join('\n')
		);
		expect(rows).toEqual([
			{
				id: 'tm-audit',
				title: 'Audit team-memory health',
				repo: 'team-memory',
				kind: 'scout',
				done: '2026-10-05'
			},
			{
				id: 'wh-docs',
				title: 'Wheelhouse Documents: links and search',
				repo: 'wheelhouse',
				kind: 'ship',
				done: null
			},
			{
				id: 'fleet-spend',
				title: 'Weekly token spend',
				repo: null,
				kind: 'scout',
				done: '2026-11-01'
			}
		]);
	});

	it('lets the later file’s row for an id win', () => {
		const m = backlogIndex('- [x] a - Old (repo: x)', '- [ ] a - New (repo: y)');
		expect(m.get('a')).toMatchObject({ title: 'New', repo: 'y' });
	});
});

describe('front matter', () => {
	it('reads inline and block lists, quoted strings, and the body after', () => {
		const f = readFront(
			'---\ntitle: "Night: palette"\ntags: [a, "b c"]\nalso:\n  - x\n  - y\nstatus: draft\n---\n\n# Body\n'
		);
		expect(f.data).toEqual({
			title: 'Night: palette',
			tags: ['a', 'b c'],
			also: ['x', 'y'],
			status: 'draft'
		});
		expect(f.body).toBe('\n# Body\n');
		expect(readFront('# No front\n')).toEqual({ data: {}, body: '# No front\n' });
	});

	it('writes what it reads back, leaving empty values out', () => {
		const text = writeFront(
			{
				title: 'A: b',
				tags: ['x', 'y z'],
				promoted_from: 'records/a/b',
				prototypes: null,
				status: ''
			},
			'\n\n# Body\n'
		);
		expect(text).toBe(
			'---\ntitle: "A: b"\ntags: [x, y z]\npromoted_from: records/a/b\n---\n\n# Body\n'
		);
		expect(readFront(text).data).toEqual({
			title: 'A: b',
			tags: ['x', 'y z'],
			promoted_from: 'records/a/b'
		});
	});
});
