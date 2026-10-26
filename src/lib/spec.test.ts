import { describe, expect, it } from 'vitest';
import {
	emptySpec,
	filledCount,
	leadLine,
	normalizeSpec,
	sectionFilled,
	specMarkdown,
	specMessage,
	summarize
} from './spec';

const NOW = new Date('2026-10-26T09:00:00Z');
const ID = 'spec-abc123def';

function full() {
	return {
		...emptySpec(ID, NOW),
		project: 'photos',
		title: 'Saved searches',
		summary: 'Let case workers save a search.',
		problem: 'Filters are rebuilt every morning.',
		goal: 'One click brings back yesterday’s search.',
		audience: 'Case workers.',
		journeys: [
			'Open Cases, save the search',
			'',
			'Pick it from the sidebar\nand see fresh results'
		],
		scope: 'Saving and renaming.',
		nonGoals: 'Sharing.',
		requirements: ['Keeps every filter', '  '],
		uiNotes: 'Match the sidebar.',
		links: ['https://example.com/mock', 'the filter bar'],
		images: [{ name: 'img-aaaaaa.png', caption: 'Filter bar' }],
		constraints: 'Current permissions.',
		risks: 'Old filters.',
		questions: ['Per person or per team?']
	};
}

describe('specMarkdown', () => {
	it('leaves out empty sections and titles an empty spec', () => {
		expect(specMarkdown(emptySpec(ID, NOW))).toBe('# Untitled spec\n');
	});

	it('assembles every section in order', () => {
		const md = specMarkdown(full(), (img) => `/files/${img.name}`);
		expect(md).toBe(`# Saved searches

**Project:** photos

Let case workers save a search.

## Problem and goal

**Problem**

Filters are rebuilt every morning.

**Goal**

One click brings back yesterday’s search.

## Who it is for

Case workers.

## User journeys

1. Open Cases, save the search
2. Pick it from the sidebar
  and see fresh results

## Scope and non-goals

**In scope**

Saving and renaming.

**Not in scope**

Sharing.

## Requirements

- [ ] Keeps every filter

## UI notes and references

Match the sidebar.

- <https://example.com/mock>
- the filter bar

![Filter bar](</files/img-aaaaaa.png>)

## Constraints and risks

**Constraints**

Current permissions.

**Risks**

Old filters.

## Open questions

- Per person or per team?
`);
	});
});

describe('sections', () => {
	it('counts the sections with something in them', () => {
		const d = emptySpec(ID, NOW);
		expect(filledCount(d)).toBe(0);
		d.requirements = [' '];
		expect(sectionFilled(d, 'requirements')).toBe(false);
		d.requirements = ['Works'];
		d.goal = 'x';
		expect(filledCount(d)).toBe(2);
		expect(filledCount(full())).toBe(9);
	});

	it('summarizes a draft for the list', () => {
		expect(summarize(full())).toEqual({
			id: ID,
			title: 'Saved searches',
			project: 'photos',
			updatedAt: NOW.toISOString(),
			sentAt: null,
			filled: 9
		});
	});
});

describe('the message to Firstmate', () => {
	it('opens with a short lead line naming the project and title', () => {
		expect(leadLine(full())).toBe(
			'A new spec for photos: Saved searches. Please read it and come back to me with any questions before planning the work.'
		);
		expect(leadLine(emptySpec(ID, NOW))).toMatch(/^A new spec\. Please/);
	});

	it('is the lead line then the spec, with pictures as file paths', () => {
		const m = specMessage(full(), (img) => `/state/specs/${ID}/${img.name}`);
		expect(m.startsWith(`${leadLine(full())}\n\n# Saved searches`)).toBe(true);
		expect(m).toContain(`![Filter bar](</state/specs/${ID}/img-aaaaaa.png>)`);
	});
});

describe('normalizeSpec', () => {
	it('refuses what is not a draft', () => {
		expect(normalizeSpec(null, ID)).toBeNull();
		expect(normalizeSpec([], ID)).toBeNull();
		expect(normalizeSpec({}, '../etc')).toBeNull();
	});

	it('keeps known fields, drops the rest and checks picture names', () => {
		const d = normalizeSpec(
			{
				...full(),
				id: 'spec-other1',
				extra: 1,
				title: 42,
				journeys: ['a', 3, 'b'],
				images: [{ name: '../x.png' }, { name: 'img-bbbbbb.webp', caption: 7 }]
			},
			ID,
			NOW
		)!;
		expect(d.id).toBe(ID);
		expect('extra' in d).toBe(false);
		expect(d.title).toBe('');
		expect(d.journeys).toEqual(['a', 'b']);
		expect(d.images).toEqual([{ name: 'img-bbbbbb.webp', caption: '' }]);
	});

	it('bounds long text', () => {
		const d = normalizeSpec({ problem: 'x'.repeat(50_000) }, ID, NOW)!;
		expect(d.problem.length).toBe(20_000);
		expect(d.createdAt).toBe(NOW.toISOString());
	});
});
