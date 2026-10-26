import { describe, expect, it } from 'vitest';
import {
	changedSections,
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
	it('opens with a lead line marking a build request for the project', () => {
		expect(leadLine(full())).toBe(
			'Build request for photos: Saved searches. Please build the spec below; come back to me with any questions before planning the work.'
		);
		expect(leadLine(emptySpec(ID, NOW))).toMatch(/^Build request\. Please build/);
	});

	it('points at the attached file instead of carrying a spec too long for one message', () => {
		const m = specMessage(full(), (img) => img.name, '/state/specs/x/spec.md');
		expect(m).toBe(
			`${leadLine(full())}\n\n# Saved searches\n\n**Project:** photos\n\nLet case workers save a search.\n\nThe full spec (1 requirement) is too long for one message, so it is attached as a file: </state/specs/x/spec.md>\n`
		);
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

	it('keeps the interview and comments, dropping what does not fit', () => {
		const d = normalizeSpec(
			{
				...full(),
				mode: 'other',
				interview: {
					done: true,
					usage: { turns: 2, inputTokens: 10, outputTokens: -1, costUsd: 0.5 },
					turns: [
						{ role: 'captain', text: 'Shared albums', at: NOW.toISOString() },
						{
							role: 'agent',
							text: 'Who adds photos?',
							options: ['Owners', 'Guests'],
							recommended: 5,
							changed: ['problem', 'nowhere']
						},
						{ role: 'system', text: 'x' }
					]
				},
				comments: [
					{
						id: 'c-abc123',
						section: 'scope',
						quote: 'Sharing',
						text: 'Why not?',
						resolvedAt: null
					},
					{ id: '../c', section: 'scope', text: 'x' },
					{ id: 'c-def456', section: 'elsewhere', text: 'x' }
				]
			},
			ID,
			NOW
		)!;
		expect(d.mode).toBe('interview');
		expect(d.interview.done).toBe(true);
		expect(d.interview.usage).toEqual({ turns: 2, inputTokens: 10, outputTokens: 0, costUsd: 0.5 });
		expect(d.interview.turns).toHaveLength(2);
		expect(d.interview.turns[1]).toMatchObject({
			role: 'agent',
			options: ['Owners', 'Guests'],
			recommended: null,
			changed: ['problem']
		});
		expect(d.comments).toEqual([
			{
				id: 'c-abc123',
				section: 'scope',
				quote: 'Sharing',
				text: 'Why not?',
				at: NOW.toISOString(),
				resolvedAt: null,
				reply: ''
			}
		]);
	});

	it('keeps a draft written in the quick form before the interview existed in the form', () => {
		const { mode, interview, comments, ...legacy } = full();
		void [mode, interview, comments];
		expect(normalizeSpec(legacy, ID, NOW)!.mode).toBe('form');
		expect(normalizeSpec({ title: '' }, ID, NOW)!.mode).toBe('interview');
		expect(normalizeSpec({ ...full(), mode: 'interview' }, ID, NOW)!.mode).toBe('interview');
	});

	it('bounds long text', () => {
		const d = normalizeSpec({ problem: 'x'.repeat(50_000) }, ID, NOW)!;
		expect(d.problem.length).toBe(20_000);
		expect(d.createdAt).toBe(NOW.toISOString());
	});
});

describe('changedSections', () => {
	it('names the sections whose text changed, counting the title as the project’s', () => {
		const before = full();
		const after = {
			...full(),
			title: 'Saved filters',
			requirements: ['Keeps every filter', 'Fast']
		};
		expect(changedSections(before, after)).toEqual(['project', 'requirements']);
		expect(changedSections(before, full())).toEqual([]);
	});
});
