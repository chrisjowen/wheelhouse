import { describe, expect, it } from 'vitest';
import { bodyMarkdown, sectionFor, slug } from './docsection';

const REPORT = [
	'# Docket: trust set by policy',
	'',
	'## Summary',
	'Four parts.',
	'',
	'## 9. Captain decisions',
	'',
	'| # | Question | Options | Recommendation |',
	'|---|---|---|---|',
	'| **D1** | Where? | (a) Here. (b) There. | **(a).** |',
	'',
	'### 9.1 Notes',
	'A note.',
	'',
	'```md',
	'## Not a heading',
	'```',
	'',
	'## 10. Phased build plan',
	'Phase 0.'
].join('\n');

describe('the section of a report a decision rests on', () => {
	it('is the one its words name, by number or by link', () => {
		const s = sectionFor(REPORT, ['Nine calls, see report §9.']);
		expect(s.heading).toBe('9. Captain decisions');
		expect(s.text.startsWith('## 9. Captain decisions')).toBe(true);
		// Its subsections and fenced examples come with it; the next section does not.
		expect(s.text).toContain('### 9.1 Notes');
		expect(s.text).toContain('## Not a heading');
		expect(s.text).not.toContain('Phased build plan');
		expect(sectionFor(REPORT, ['section 10']).heading).toBe('10. Phased build plan');
		expect(sectionFor(REPORT, ['data/x/report.md#summary']).heading).toBe('Summary');
		expect(sectionFor(REPORT, [null, 'report.md#9-captain-decisions']).heading).toBe(
			'9. Captain decisions'
		);
	});

	it('is the captain’s calls when the words name none, else the whole report', () => {
		expect(sectionFor(REPORT, ['Accept all recommendations?']).heading).toBe(
			'9. Captain decisions'
		);
		const plain = '# Report\n\n## What I did\nThings.';
		expect(sectionFor(plain, ['§4'])).toEqual({ heading: null, text: plain });
	});

	it('anchors headings as renderers do', () => {
		expect(slug('9. Captain decisions')).toBe('9-captain-decisions');
		expect(slug('What’s next?')).toBe('whats-next');
	});
});

describe('a held task’s body as Markdown', () => {
	it('keeps each line a paragraph, and tables and lists whole', () => {
		const body = [
			'The design is ready.',
			'It has nine calls.',
			'| # | Q |',
			'|---|---|',
			'| D1 | Where? |',
			'- one',
			'- two',
			'Done.'
		].join('\n');
		expect(bodyMarkdown(body)).toBe(
			[
				'The design is ready.',
				'',
				'It has nine calls.',
				'',
				'| # | Q |\n|---|---|\n| D1 | Where? |',
				'',
				'- one\n- two',
				'',
				'Done.'
			].join('\n')
		);
	});
});
