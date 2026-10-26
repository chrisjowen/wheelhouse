import { describe, expect, it } from 'vitest';
import {
	callsFor,
	fullAnswer,
	gist,
	overall,
	pairDecisions,
	pairRounds,
	parseFindings,
	questionRounds,
	scrub,
	verdictOf,
	whereOf,
	type Finding
} from './decisions';
import type { StatusLine } from './timing';

// Synthetic records only.
const s = (ts: number, state: string, key: string | null, text: string): StatusLine => ({
	ts,
	state,
	key,
	text
});
const RUN = 'nm-01AAAAAAAAAAAAAAAAAAAAAAAA';

describe('pairDecisions', () => {
	it('pairs a review question with Firstmate’s answer on the same key', () => {
		const d = pairDecisions([
			s(
				10,
				'needs-decision',
				`${RUN}-review`,
				'ask-user findings=f1,f2 file=/h/data/t/nm-x-findings.txt'
			),
			s(70, 'resolved', `${RUN}-review`, 'answered: Decision on f1: FIX it.')
		]);
		expect(d).toEqual([
			{
				key: `${RUN}-review`,
				step: 'review',
				askedAt: 10,
				decidedAt: 70,
				findingsFile: '/h/data/t/nm-x-findings.txt',
				findingIds: ['f1', 'f2'],
				answer: 'Decision on f1: FIX it.'
			}
		]);
	});

	it('never shows decisions on keys that carry the captain’s own words', () => {
		const d = pairDecisions([
			s(10, 'needs-decision', 'board-review', 'prototype live - review'),
			s(20, 'resolved', 'board-review', 'answered: the captain says ship it')
		]);
		expect(d).toEqual([]);
	});

	it('reads the step from the key, including later rounds', () => {
		const d = pairDecisions([
			s(1, 'needs-decision', `${RUN}-test`, 'ask-user findings=T1 file=/x.txt'),
			s(2, 'resolved', `${RUN}-test`, 'answered: FIX'),
			s(3, 'needs-decision', `${RUN}-review-r3`, 'ask-user findings=R1 file=/y.txt'),
			s(4, 'resolved', `${RUN}-review-r3`, 'answered: KEEP as is')
		]);
		expect(d.map((x) => x.step)).toEqual(['test', 'review']);
	});

	it('skips worker acknowledgements and placeholder answers', () => {
		const d = pairDecisions([
			s(1, 'needs-decision', `${RUN}-review`, 'ask-user findings=a file=/x.txt'),
			s(2, 'resolved', `${RUN}-review`, 'firstmate decision received; sending fix'),
			s(3, 'resolved', `${RUN}-review`, 'answered: -')
		]);
		expect(d).toEqual([]);
	});

	it('leaves unanswered questions out', () => {
		expect(
			pairDecisions([s(1, 'needs-decision', `${RUN}-review`, 'ask-user findings=a file=/x.txt')])
		).toEqual([]);
	});
});

describe('parseFindings', () => {
	it('reads blocks, keeping wrapped description lines', () => {
		const f = parseFindings(
			'id: a\nseverity: warning\nfile: src/x.ts\nline: 12\ndescription: First line.\n  more words\nauthority: ask-user\n\nid: b\nseverity: info\ndescription: Second.\n'
		);
		expect(f).toEqual([
			{
				id: 'a',
				severity: 'warning',
				file: 'src/x.ts',
				line: '12',
				description: 'First line. more words'
			},
			{ id: 'b', severity: 'info', file: null, line: null, description: 'Second.' }
		]);
	});
});

describe('fullAnswer', () => {
	const msg = (body: string) => `schema=fm-task-inbox.v1\nat=2026-01-01T00:00:00Z\n--\n${body}`;

	it('takes the full text from the handled inbox and drops instructions to the worker', () => {
		const r = fullAnswer('Decision on a: FIX by removing the check and its [truncated]', [
			msg('Something else entirely.'),
			msg(
				'Decision on a: FIX by removing the check and its test. It is valid because X. In the same response, also fix auto-fix findings. Run: no-mistakes axi respond --step review'
			)
		]);
		expect(r).toEqual({
			text: 'Decision on a: FIX by removing the check and its test. It is valid because X.',
			cut: false
		});
	});

	it('says when only the start of the answer survives', () => {
		expect(fullAnswer('Decision on a: FIX because [truncated]', [])).toEqual({
			text: 'Decision on a: FIX because',
			cut: true
		});
	});

	it('keeps a short answer as it is', () => {
		expect(fullAnswer('KEEP. Keep driving until CI is green.', [])).toEqual({
			text: 'KEEP.',
			cut: false
		});
	});
});

describe('verdicts and calls', () => {
	const f = (id: string, description = ''): Finding => ({
		id,
		severity: 'warning',
		file: null,
		line: null,
		description
	});

	it('reads the call from capitals, not prose', () => {
		expect(verdictOf('FIX. Keep one draft representation.')).toBe('Fix it');
		expect(verdictOf('KEEP the omission')).toBe('Keep as is');
		expect(verdictOf('deferring the graph deps is intended')).toBe('Defer');
		expect(verdictOf('Looks right as it stands')).toBe('Decided');
	});

	it('splits a multi-finding answer per finding', () => {
		const c = callsFor(
			'Decisions on the review step’s ask-user findings: - one-thing: FIX. Do it this way. - other-thing: KEEP, it is intended.',
			[f('one-thing'), f('other-thing')]
		);
		expect(c.map((x) => [x.verdict, x.reason])).toEqual([
			['Fix it', 'Do it this way.'],
			['Keep as is', 'It is intended.']
		]);
		expect(overall(c.map((x) => x.verdict))).toBe('Mixed');
	});

	it('applies a single-finding answer whole', () => {
		const c = callsFor('Decision on a (step: review): FIX by adding a test.', [f('a')]);
		expect(c[0]).toMatchObject({ verdict: 'Fix it', reason: 'By adding a test.' });
	});

	it('summarises a finding by its first sentence', () => {
		expect(gist(f('x', 'A case can pin a draft. That breaks the rule.'))).toBe(
			'A case can pin a draft.'
		);
		expect(gist(f('missing-test'))).toBe('missing test');
	});
});

describe('Firstmate’s answers as it writes them', () => {
	const f = (id: string, description = ''): Finding => ({
		id,
		severity: 'warning',
		file: null,
		line: null,
		description
	});
	const KEY = 'nm-01M5W2HGSB65DF468F5W8EYDBR-review';

	it('splits "F3 FIX - …" answers after the decision key', () => {
		const c = callsFor(
			`Decision for key ${KEY} (run 01M5W2HGSB65DF468F5W8EYDBR, step review): F3 FIX - seed the state on first enable. F4 NO CHANGE - the block is needed. F5 KEEP - it was part of the spec; leave it as is.`,
			[f('F3'), f('F4'), f('F5')]
		);
		expect(c.map((x) => [x.finding.id, x.verdict, x.reason])).toEqual([
			['F3', 'Fix it', 'Seed the state on first enable.'],
			['F4', 'No change', 'The block is needed.'],
			['F5', 'Keep as is', 'It was part of the spec; leave it as is.']
		]);
	});

	it('reads a single named finding after the key', () => {
		const c = callsFor(
			`Decision for key ${KEY} (run 01M5W2HGSB65DF468F5W8EYDBR, step review), finding test-1: DISCARD the background job.`,
			[f('test-1')]
		);
		expect(c[0]).toMatchObject({ verdict: 'No change', reason: 'The background job.' });
	});

	it('gives findings the answer does not name its lead-in', () => {
		const c = callsFor(`Decision for key ${KEY}: FIX both. Keep the messages short.`, [
			f('a'),
			f('b')
		]);
		expect(c.map((x) => x.verdict)).toEqual(['Fix it', 'Fix it']);
	});

	it('drops the instructions to the worker from the full answer', () => {
		const r = fullAnswer('Decision for key x: F1 FIX - do it [truncated]', [
			'schema=fm-task-inbox.v1\nat=2026-01-01T00:00:00Z\n--\nDecision for key x: F1 FIX - do it now. Respond through the active gate, never --yes.'
		]);
		expect(r).toEqual({ text: 'Decision for key x: F1 FIX - do it now.', cut: false });
	});
});

describe('question rounds', () => {
	const HOME = '/Users/x/fm home';
	const file = `${HOME}/data/t/nm-01AAAAAAAAAAAAAAAAAAAAAAAA-findings.txt`;
	const findings: Finding[] = [
		{
			id: 'F1',
			severity: 'error',
			file: 'src/lib/export.ts',
			line: '23',
			description:
				'Exports include originals. A shared viewer would get location data. Either strip it or limit export to the owner.'
		},
		{ id: 'F2', severity: 'info', file: null, line: null, description: 'Short.' }
	];
	const asked = s(10, 'needs-decision', `${RUN}-review`, `ask-user findings=F1,F2 file=${file}`);

	it('lists questions still waiting on Firstmate, in plain words', () => {
		const [r] = questionRounds(pairRounds([asked]), () => findings, [], HOME);
		expect(r).toMatchObject({
			raisedIn: 'the automated review',
			status: 'waiting',
			answeredAt: null
		});
		expect(r.questions).toEqual([
			{
				id: `${r.id}-0`,
				summary: 'Exports include originals. A shared viewer would get location data.',
				detail:
					'Exports include originals. A shared viewer would get location data. Either strip it or limit export to the owner.',
				where: 'src/lib/export.ts, line 23',
				serious: true,
				status: 'waiting',
				verdict: null,
				reason: null
			},
			{
				id: `${r.id}-1`,
				summary: 'Short.',
				detail: null,
				where: null,
				serious: false,
				status: 'waiting',
				verdict: null,
				reason: null
			}
		]);
		expect(JSON.stringify(r)).not.toMatch(/nm-|findings=|01AAAA|fm home/);
	});

	it('matches Firstmate’s call to each question once it answers', () => {
		const rounds = questionRounds(
			pairRounds([
				asked,
				s(
					70,
					'resolved',
					`${RUN}-review`,
					`answered: Decision for key ${RUN}-review: F1 FIX - owner only. F2 KEEP - fine.`
				)
			]),
			() => findings,
			[],
			HOME
		);
		expect(rounds[0].status).toBe('answered');
		expect(rounds[0].questions.map((q) => [q.status, q.verdict, q.reason])).toEqual([
			['answered', 'Fix it', 'Owner only.'],
			['answered', 'Keep as is', 'Fine.']
		]);
	});

	it('lists the newest round first and notes one closed without an answer', () => {
		const later = s(100, 'needs-decision', `${RUN}-review-r2`, `ask-user findings=F2 file=${file}`);
		const rounds = questionRounds(
			pairRounds([asked, s(20, 'resolved', `${RUN}-review`, 'moved on'), later]),
			() => findings,
			[],
			HOME
		);
		expect(rounds.map((r) => r.status)).toEqual(['waiting', 'closed']);
	});

	it('never shows a path in Firstmate’s home', () => {
		expect(whereOf({ ...findings[0], file: `${HOME}/data/t/x.ts` }, HOME)).toBe('x.ts, line 23');
		expect(scrub(`see ${HOME}/data/t/notes.md for ${RUN}-review`, HOME)).toBe(
			'see data/t/notes.md for the review'
		);
	});
});
