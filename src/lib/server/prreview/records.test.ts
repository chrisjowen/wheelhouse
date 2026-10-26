import { describe, expect, it } from 'vitest';
import { briefSection, recordsText, taskRecords } from './records';
import type { BuildInsight } from '../../buildlog';

const BRIEF = `# Task
## Captain's intent
"make greetings friendlier"

## Firstmate spec
- Greet by name.
- Refuse an empty name.

### Detail
Keep it short.

# Setup
Run the tests.
`;

const build: BuildInsight = {
	conversation: {
		available: true,
		source: 'test',
		observedAt: null,
		value: [
			{
				id: 'e1',
				at: '2026-10-27T10:00:00Z',
				kind: 'review',
				from: 'review',
				to: 'firstmate',
				title: 'The review asked 1 question',
				body: null,
				questions: [
					{
						id: 'q1',
						summary: 'Empty names throw',
						detail: 'An empty name now throws instead of greeting nobody.',
						where: 'src/greet.ts, line 2',
						serious: true,
						status: 'answered',
						verdict: 'Keep as is',
						reason: 'The spec asks to refuse an empty name.'
					}
				],
				reply: null,
				outcome: { state: 'answered', label: 'Answered' }
			},
			{
				id: 'e2',
				at: '2026-10-27T10:05:00Z',
				kind: 'question',
				from: 'worker',
				to: 'firstmate',
				title: 'Should the greeting end with "!"?',
				body: null,
				questions: [],
				reply: { at: null, from: 'firstmate', text: 'Yes.' },
				outcome: { state: 'answered', label: 'Answered' }
			}
		]
	},
	checks: {
		available: true,
		source: 'test',
		observedAt: null,
		value: {
			startedAt: null,
			outcome: null,
			runs: 1,
			testingNote: null,
			steps: [
				{
					key: 'review',
					label: 'Review',
					state: 'done' as never,
					summary: '',
					durationMs: null,
					notes: ['Fixed a missing null check.'],
					tests: null,
					docs: null
				}
			]
		}
	},
	docs: { available: false, reason: 'none' }
};

describe('briefSection', () => {
	it('takes a section by heading, keeping its subsections', () => {
		expect(briefSection(BRIEF, /^captain'?s intent/i)).toBe('"make greetings friendlier"');
		expect(briefSection(BRIEF, /^firstmate spec/i)).toBe(
			'- Greet by name.\n- Refuse an empty name.\n\n### Detail\nKeep it short.'
		);
		expect(briefSection(BRIEF, /^nothing/i)).toBeNull();
	});
});

describe('taskRecords', () => {
	it('labels the intent, spec, commits, description, findings, questions and step notes', () => {
		const r = taskRecords({
			brief: BRIEF,
			commits: [
				{ sha: 'abcdef1234', subject: 'feat: friendlier greeting', body: 'Refuse empty names.' }
			],
			prBody: 'Greets by name.',
			build,
			decided: []
		});
		expect(r.map((x) => [x.label, x.name])).toEqual([
			['I1', 'Captain’s intent'],
			['S1', 'Firstmate’s spec'],
			['C1', 'Commit abcdef1'],
			['P1', 'The pull request’s description'],
			['F1', 'Review finding (marked serious)'],
			['Q1', 'The worker’s question'],
			['N1', 'What the Review step did']
		]);
		const f1 = r.find((x) => x.label === 'F1')!;
		expect(f1.text).toContain('src/greet.ts, line 2: An empty name now throws');
		expect(f1.text).toContain(
			'Firstmate’s call: Keep as is. The spec asks to refuse an empty name.'
		);
		expect(r.find((x) => x.label === 'Q1')!.text).toContain('Answer: Yes.');
		expect(r.find((x) => x.label === 'C1')!.text).toBe(
			'feat: friendlier greeting\n\nRefuse empty names.'
		);
	});

	it('falls back to decided-for-you calls when the conversation has no findings', () => {
		const r = taskRecords({
			brief: null,
			commits: [],
			prBody: null,
			build: null,
			decided: [
				{
					id: 'd',
					taskId: 't',
					taskTitle: 't',
					projectId: null,
					step: 'review',
					askedAt: '',
					decidedAt: '',
					verdict: 'Fix it',
					answerCut: false,
					landed: false,
					calls: [
						{
							question: 'Q?',
							detail: 'Detail.',
							file: 'a.ts',
							serious: false,
							verdict: 'Fix it',
							reason: 'R.'
						}
					]
				}
			]
		});
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ label: 'F1', name: 'Finding from the review step' });
		expect(r[0].text).toBe('a.ts: Detail.\nFirstmate’s call: Fix it. R.');
	});

	it('says when there are no records at all', () => {
		expect(
			recordsText(taskRecords({ brief: null, commits: [], prBody: null, build: null, decided: [] }))
		).toMatch(/has no records/);
	});
});
