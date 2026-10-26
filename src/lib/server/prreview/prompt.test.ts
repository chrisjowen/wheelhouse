import { describe, expect, it } from 'vitest';
import { parsePatch } from './diff';
import { askPrompt, diffForPrompt, guidePrompt, parseGuide } from './prompt';

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-one
+ONE
@@ -5 +5 @@
-five
+FIVE
diff --git a/yarn.lock b/yarn.lock
--- a/yarn.lock
+++ b/yarn.lock
@@ -1 +1 @@
-a
+b
`;
const files = parsePatch(PATCH);
const [h1, h2] = files[0].hunks;
const records = [{ label: 'I1', name: 'Captain’s intent', text: 'Shout.', excerpt: 'Shout.' }];

describe('diffForPrompt', () => {
	it('lists every hunk with its id and boilerplate only by file', () => {
		const d = diffForPrompt(files);
		expect(d.text).toContain(`[hunk ${h1.id}]\n@@ -1 +1 @@\n-one\n+ONE`);
		expect(d.text).toContain(`[hunk ${h2.id}]`);
		expect(d.text).toContain('Boilerplate files, not shown:\nyarn.lock (lockfile, +1 −1)');
		expect(d.text).not.toContain('+b');
		expect([...d.shown]).toEqual([h1.id, h2.id]);
	});

	it('leaves out hunks past the budget, but always keeps the focused one', () => {
		const d = diffForPrompt(files, h2.id, 30);
		expect(d.shown.has(h2.id)).toBe(true);
		expect(d.shown.has(h1.id)).toBe(false);
		expect(d.text).toContain('Hunks left out because the diff is large:\na.ts @@ -1 +1 @@');
	});
});

describe('prompts', () => {
	it('give the guide the records and the diff', () => {
		const g = guidePrompt({
			title: 'Shout',
			prUrl: 'https://github.com/x/y/pull/3',
			records,
			files
		});
		expect(g.prompt).toContain('[I1] Captain’s intent\nShout.');
		expect(g.prompt).toContain('Pull request: https://github.com/x/y/pull/3');
		expect(g.shown.size).toBe(2);
	});

	it('put a hunk question, its hunk and the earlier exchange in the prompt', () => {
		const p = askPrompt({
			title: 'Shout',
			prUrl: null,
			records,
			files,
			hunk: h1,
			question: 'Why upper case?',
			guideSummary: 'Shouts.',
			earlier: [
				{
					id: 'r1',
					kind: 'ask',
					hunk: h1.id,
					question: 'What is this?',
					status: 'done',
					text: 'A shout.',
					error: null,
					startedAt: '',
					finishedAt: '',
					model: 'sonnet',
					effort: 'low',
					usage: null
				}
			]
		});
		expect(p).toContain(`## The hunk the question is about\n[hunk ${h1.id}] a.ts`);
		expect(p).toContain('Captain: What is this?\nYou: A shout.');
		expect(p).toContain("## The guide's summary\nShouts.");
		expect(p.trim().endsWith("## The captain's question\nWhy upper case?")).toBe(true);
	});
});

describe('parseGuide', () => {
	const hunks = new Set([h1.id, h2.id]);
	const labels = new Set(['I1', 'C1']);

	it('reads the guide, even inside a code fence', () => {
		const g = parseGuide(
			'```json\n' +
				JSON.stringify({
					summary: 'Shouts.',
					items: [
						{
							hunk: h1.id,
							importance: 'key',
							kind: 'behaviour',
							title: 'Upper case',
							what: 'Shouts one.',
							why: 'The captain asked [I1].',
							basis: 'recorded',
							sources: ['I1']
						}
					]
				}) +
				'\n```',
			hunks,
			labels
		);
		expect(g).toEqual({
			summary: 'Shouts.',
			items: [
				{
					hunk: h1.id,
					importance: 'key',
					kind: 'behaviour',
					title: 'Upper case',
					what: 'Shouts one.',
					why: 'The captain asked [I1].',
					basis: 'recorded',
					sources: ['I1']
				}
			]
		});
	});

	it('never lets an unsourced reason pass as recorded', () => {
		const g = parseGuide(
			JSON.stringify({
				summary: '',
				items: [
					{
						hunk: h1.id,
						importance: 'key',
						why: 'It is faster.',
						basis: 'recorded',
						sources: ['Z9']
					},
					{ hunk: h2.id, importance: 'notable', why: null, basis: 'recorded', sources: ['I1'] }
				]
			}),
			hunks,
			labels
		)!;
		expect(g.items[0]).toMatchObject({
			basis: 'inferred',
			why: 'Not recorded: It is faster.',
			sources: []
		});
		expect(g.items[1]).toMatchObject({ basis: 'none', why: null, sources: [] });
	});

	it('drops unknown and repeated hunks and fills in bad fields', () => {
		const g = parseGuide(
			JSON.stringify({
				items: [
					{ hunk: 'hnope', importance: 'key' },
					{ hunk: h1.id, importance: 'urgent', kind: 'weird' },
					{ hunk: h1.id, importance: 'key' }
				]
			}),
			hunks,
			labels
		)!;
		expect(g.items).toEqual([
			{
				hunk: h1.id,
				importance: 'routine',
				kind: 'other',
				title: 'Change',
				what: '',
				why: null,
				basis: 'none',
				sources: []
			}
		]);
	});

	it('gives up on an answer that is not a guide', () => {
		expect(parseGuide('Sorry, I cannot.', hunks, labels)).toBeNull();
		expect(parseGuide('{"summary": "x"}', hunks, labels)).toBeNull();
	});
});
