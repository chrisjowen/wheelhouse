import { describe, expect, it } from 'vitest';
import { matchProjects, parsePins, pickerSections, PICKER_LIMIT, statsByProject } from './picker';
import { taskSummary } from '../../tests/helpers/task-summary';
import type { Project } from './types';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const you = { kind: 'review' as const, owner: 'captain' as const, text: '', url: null };

const project = (id: string, name = id): Project => ({
	id,
	name,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

// A big fleet: 40 projects, a handful of them busy.
const FLEET = Array.from({ length: 40 }, (_, i) => project(`p${String(i).padStart(2, '0')}`));
const TASKS = [
	taskSummary('a', 'needs-review', { projectId: 'p31', attention: you }),
	taskSummary('b', 'working', { projectId: 'p07', since: hoursAgo(1) }),
	taskSummary('c', 'working', { projectId: 'p07', since: hoursAgo(2) }),
	taskSummary('d', 'working', { projectId: 'p22', since: hoursAgo(3) }),
	taskSummary('e', 'landed', { projectId: 'p15', mergedAt: hoursAgo(5) }),
	taskSummary('f', 'landed', { projectId: 'p02', mergedAt: hoursAgo(50) }),
	taskSummary('g', 'queued', { projectId: 'p11' }),
	taskSummary('h', 'landed', { projectId: 'p39', mergedAt: hoursAgo(90) }),
	taskSummary('i', 'landed', { projectId: 'p38', mergedAt: hoursAgo(100) })
];
const STATS = statsByProject(FLEET, TASKS, NOW);
const ids = (ps: Project[]) => ps.map((p) => p.id);

describe('pickerSections', () => {
	it('shows only the most active projects, needing you first, and the rest by name', () => {
		const s = pickerSections(FLEET, STATS, { pinned: [] });
		expect(ids(s.pinned)).toEqual([]);
		expect(ids(s.top)).toEqual(['p31', 'p07', 'p22', 'p15', 'p02', 'p39']);
		expect(s.top).toHaveLength(PICKER_LIMIT);
		expect(s.rest).toHaveLength(40 - PICKER_LIMIT);
		expect(ids(s.rest).slice(0, 3)).toEqual(['p00', 'p01', 'p03']);
	});

	it('puts pins first and fills what they leave with top projects', () => {
		const s = pickerSections(FLEET, STATS, { pinned: ['p05', 'p31', 'gone'] });
		expect(ids(s.pinned)).toEqual(['p05', 'p31']);
		expect(ids(s.top)).toEqual(['p07', 'p22', 'p15', 'p02']);
		expect(s.pinned.length + s.top.length).toBe(PICKER_LIMIT);
		expect(ids(s.rest)).not.toContain('p31');
	});

	it('keeps every pin even past the limit', () => {
		const many = FLEET.slice(0, 9).map((p) => p.id);
		const s = pickerSections(FLEET, STATS, { pinned: many });
		expect(s.pinned).toHaveLength(9);
		expect(s.top).toEqual([]);
	});

	it('always shows the current project', () => {
		const s = pickerSections(FLEET, STATS, { pinned: [], current: 'p20' });
		expect(ids(s.top).at(-1)).toBe('p20');
		expect(ids(s.rest)).not.toContain('p20');
	});

	it('fills a quiet fleet by name, and a small one shows whole', () => {
		const quiet = ['d', 'b', 'a', 'c'].map((id) => project(id));
		const s = pickerSections(quiet, statsByProject(quiet, [], NOW), { pinned: [], limit: 3 });
		expect(ids(s.top)).toEqual(['a', 'b', 'c']);
		expect(ids(s.rest)).toEqual(['d']);
		const few = pickerSections(quiet, statsByProject(quiet, [], NOW), { pinned: ['c'] });
		expect([...ids(few.pinned), ...ids(few.top)]).toEqual(['c', 'a', 'b', 'd']);
		expect(few.rest).toEqual([]);
	});
});

describe('matchProjects', () => {
	const named = [
		project('diorama', 'Diorama'),
		project('old-map', 'Old map'),
		project('mast', 'Mast'),
		project('lumen', 'Lumen')
	];
	it('ranks a name that starts with the search, then a word, then anywhere', () => {
		expect(ids(matchProjects(named, 'ma'))).toEqual(['mast', 'old-map', 'diorama']);
		expect(ids(matchProjects(named, 'MAP'))).toEqual(['old-map']);
		expect(ids(matchProjects(named, 'zzz'))).toEqual([]);
	});
	it('matches the id too, and lists everything by name for an empty search', () => {
		expect(ids(matchProjects([project('fm-x', 'Firstmate')], 'fm-'))).toEqual(['fm-x']);
		expect(ids(matchProjects(named, '  '))).toEqual(['diorama', 'lumen', 'mast', 'old-map']);
	});
	it('matches a friendly name like the registered one', () => {
		expect(ids(matchProjects(named, 'photos', [], { lumen: 'Family photos' }))).toEqual(['lumen']);
		expect(ids(matchProjects(named, 'lum', [], { lumen: 'Family photos' }))).toEqual(['lumen']);
	});
	it('puts pinned matches first within a rank', () => {
		const many = FLEET.map((p) => project(p.id, `Project ${p.id}`));
		expect(ids(matchProjects(many, 'p3', ['p35'])).slice(0, 2)).toEqual(['p35', 'p30']);
	});
});

describe('parsePins', () => {
	it('keeps distinct ids and drops anything malformed', () => {
		expect(parsePins('["a","b","a",3]')).toEqual(['a', 'b']);
		expect(parsePins('{oops')).toEqual([]);
		expect(parsePins('{"a":1}')).toEqual([]);
		expect(parsePins(null)).toEqual([]);
	});
});
