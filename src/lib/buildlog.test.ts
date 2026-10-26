import { describe, expect, it } from 'vitest';
import { hintLine, roundId, roundLine, type QuestionRound } from './buildlog';

describe('card hint line', () => {
	it('says nothing when there is nothing to say', () => {
		expect(hintLine(null)).toBeNull();
		expect(hintLine({ questions: 0, open: 0, docs: 0, docsChanged: 0, rounds: [] })).toBeNull();
	});

	it('counts the docs referenced, and how many of them changed', () => {
		expect(hintLine({ questions: 0, open: 0, docs: 5, docsChanged: 2, rounds: [] })).toEqual({
			questions: null,
			docs: '5 docs referenced · 2 changed'
		});
		expect(hintLine({ questions: 0, open: 0, docs: 1, docsChanged: 0, rounds: [] })).toEqual({
			questions: null,
			docs: '1 doc referenced'
		});
	});

	it('counts questions answered and still open', () => {
		expect(hintLine({ questions: 3, open: 1, docs: 0, docsChanged: 0, rounds: [] })).toEqual({
			questions: '2 questions answered, 1 open',
			docs: null
		});
		expect(hintLine({ questions: 1, open: 1, docs: 2, docsChanged: 2, rounds: [] })).toEqual({
			questions: '1 question open',
			docs: '2 docs referenced · 2 changed'
		});
		expect(
			hintLine({ questions: 2, open: 0, docs: 0, docsChanged: 0, rounds: [] })?.questions
		).toBe('2 questions answered');
	});
});

describe('question round line', () => {
	const NOW = Date.parse('2026-10-26T12:10:00Z');
	const round: QuestionRound = {
		id: roundId('nm-x-review', 1),
		raisedIn: 'the automated review',
		askedAt: '2026-10-26T12:06:00Z',
		answeredAt: null,
		status: 'waiting',
		answerCut: false,
		questions: []
	};
	const q = {
		summary: 's',
		detail: null,
		where: null,
		serious: false,
		verdict: null,
		reason: null
	};

	it('says who asked, when, and whether Firstmate has answered', () => {
		const three = [0, 1, 2].map((i) => ({ ...q, id: `${i}`, status: 'waiting' as const }));
		expect(roundLine({ ...round, questions: three }, NOW)).toBe(
			'The automated review asked 3 questions 4 min ago · waiting on Firstmate'
		);
		expect(
			roundLine(
				{
					...round,
					status: 'answered',
					answeredAt: '2026-10-26T12:08:00Z',
					questions: three.slice(0, 1)
				},
				NOW
			)
		).toBe('The automated review asked a question 4 min ago · Firstmate answered 2 min ago');
	});

	it('gives each round an anchor that carries no key', () => {
		expect(roundId('nm-01AAAA-review', 10)).toMatch(/^q[0-9a-z]+$/);
		expect(roundId('nm-01AAAA-review', 10)).not.toBe(roundId('nm-01AAAA-review', 11));
	});
});
