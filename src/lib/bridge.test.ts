import { describe, expect, it } from 'vitest';
import { checksShare, glance, homeLabel, hueOf, initials } from './bridge';
import { taskSummary } from '../../tests/helpers/task-summary';
import type { Project } from './types';

const project = (id: string, name = id): Project => ({
	id,
	name,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

describe('homeLabel', () => {
	it('reads the home folder’s own name', () => {
		expect(homeLabel('/home/me/fm-home')).toBe('fm-home');
		expect(homeLabel('/home/me/crew/')).toBe('crew');
		expect(homeLabel('C:\\Users\\me\\ship')).toBe('ship');
	});
	it('is nothing without a home', () => {
		expect(homeLabel(null)).toBeNull();
		expect(homeLabel(undefined)).toBeNull();
		expect(homeLabel('/')).toBeNull();
	});
});

describe('initials', () => {
	it('takes the first letters of the first two words', () => {
		expect(initials('east-mate')).toBe('EM');
		expect(initials('docs_scout_two')).toBe('DS');
		expect(initials('build box')).toBe('BB');
	});
	it('takes two letters of a single word', () => {
		expect(initials('scout')).toBe('SC');
		expect(initials('x')).toBe('X');
	});
	it('falls back for an id with no letters', () => {
		expect(initials('--')).toBe('?');
	});
});

describe('hueOf', () => {
	it('gives the same id the same hue, one of six', () => {
		expect(hueOf('east-mate')).toBe(hueOf('east-mate'));
		for (const id of ['a', 'east-mate', 'west-mate', 'docs-scout', 'zz']) {
			expect(hueOf(id)).toBeGreaterThanOrEqual(0);
			expect(hueOf(id)).toBeLessThan(6);
		}
	});
});

describe('checksShare', () => {
	it('is the share of work in play with nothing failing', () => {
		const tasks = [
			taskSummary('a', 'working'),
			taskSummary('b', 'working'),
			taskSummary('c', 'failed'),
			taskSummary('d', 'working', {
				pipeline: { outcome: 'failed' } as never
			}),
			taskSummary('e', 'landed'),
			taskSummary('f', 'queued')
		];
		expect(checksShare(tasks)).toEqual({ percent: 50, failing: 2, inPlay: 4 });
	});
	it('counts a failed passage step as failing', () => {
		const t = taskSummary('a', 'working');
		t.passage.steps = [{ failed: true } as never];
		expect(checksShare([t, taskSummary('b', 'working')]).failing).toBe(1);
	});
	it('reads 100 with nothing in play', () => {
		expect(checksShare([taskSummary('a', 'landed')])).toEqual({
			percent: 100,
			failing: 0,
			inPlay: 0
		});
		expect(checksShare([]).percent).toBe(100);
	});
});

describe('glance', () => {
	const projects = [project('atlas'), project('lumen'), project('tidepool'), project('quiet')];
	it('lists projects with work, busiest first, with their share landed', () => {
		const tasks = [
			taskSummary('a1', 'working', { projectId: 'atlas', busy: true }),
			taskSummary('a2', 'landed', { projectId: 'atlas' }),
			taskSummary('a3', 'landed', { projectId: 'atlas' }),
			taskSummary('a4', 'queued', { projectId: 'atlas' }),
			taskSummary('l1', 'landed', { projectId: 'lumen' }),
			taskSummary('t1', 'needs-review', {
				projectId: 'tidepool',
				attention: { owner: 'captain' } as never
			}),
			taskSummary('t2', 'working', { projectId: 'tidepool' })
		];
		expect(glance(projects, tasks)).toEqual([
			{ id: 'atlas', name: 'atlas', landed: 50, word: 'Working', tone: 'busy', tasks: 4 },
			{
				id: 'tidepool',
				name: 'tidepool',
				landed: 0,
				word: 'Needs you',
				tone: 'needs',
				tasks: 2
			},
			{ id: 'lumen', name: 'lumen', landed: 100, word: 'Quiet', tone: 'quiet', tasks: 1 }
		]);
	});
	it('keeps to the limit', () => {
		const tasks = projects.map((p) => taskSummary(p.id, 'working', { projectId: p.id }));
		expect(glance(projects, tasks, 2)).toHaveLength(2);
	});
});
