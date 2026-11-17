import { describe, expect, it } from 'vitest';
import { isScoutFor, reportForCrew, reportSummary, scoutRequest, scoutTaskId } from './scout';

describe('scout requests', () => {
	it('labels the request, quotes the question and asks for the task id and ref line', () => {
		const text = scoutRequest({
			ref: 'a1b2c3',
			question: 'Why is CI slow?\nOn main only',
			session: 'abcdef1234'
		});
		expect(text).toMatch(
			/^Scout request from a Live mode discussion in Wheelhouse \(session abcdef12\)\./
		);
		expect(text).toContain('> Why is CI slow?\n> On main only');
		expect(text).toContain('`live-scout-a1b2c3`');
		expect(text).toContain('"Live scout ref: a1b2c3"');
	});

	it('finds the scout by the id asked for, an id ending in the ref, or the ref in its brief', () => {
		expect(isScoutFor('a1b2c3', scoutTaskId('a1b2c3'), null)).toBe(true);
		expect(isScoutFor('a1b2c3', 'wh-ci-speed-a1b2c3', null)).toBe(true);
		expect(isScoutFor('a1b2c3', 'wh-ci-speed', 'Task\nLive scout ref: a1b2c3\n')).toBe(true);
		expect(isScoutFor('a1b2c3', 'wh-ci-speed', 'Live scout ref: ffffff')).toBe(false);
		expect(isScoutFor('a1b2c3', 'wh-ci-speed', null)).toBe(false);
	});
});

describe('reportSummary', () => {
	it('takes the paragraph under a summary heading', () => {
		expect(
			reportSummary(
				'# CI speed\n\nIntro text.\n\n## Summary\n\nThe **cache** is cold on [main](x).\n\n## Detail\n\nMore.'
			)
		).toBe('The cache is cold on main.');
		expect(reportSummary('# Report\n## TL;DR\nCaching fixes it.\n\nLater.')).toBe(
			'Caching fixes it.'
		);
	});

	it('takes a bold Summary lead, else the first paragraph of prose', () => {
		expect(reportSummary('# R\n\n**Summary:** Two jobs repeat work.\n\nRest')).toBe(
			'Two jobs repeat work.'
		);
		expect(reportSummary('---\nx: 1\n---\n# Title\n\n```sh\nls\n```\n\nFirst prose here.')).toBe(
			'First prose here.'
		);
	});

	it('clips a long summary at a word', () => {
		const s = reportSummary(`# R\n\n${'word '.repeat(200)}`, 40);
		expect(s.length).toBeLessThanOrEqual(40);
		expect(s.endsWith('…')).toBe(true);
	});
});

it('tells the crew the report is in, from Wheelhouse rather than the captain', () => {
	const text = reportForCrew({
		question: 'Why?',
		task: 'live-scout-a1b2c3',
		report: '# R\n\nBecause.'
	});
	expect(text).toMatch(/^\(Wheelhouse, not the captain/);
	expect(text).toContain('live-scout-a1b2c3');
	expect(text.endsWith('# R\n\nBecause.')).toBe(true);
});
