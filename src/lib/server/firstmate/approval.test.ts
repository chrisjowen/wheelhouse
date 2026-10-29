import { describe, expect, it } from 'vitest';
import { reviewerList, reviewWait, reviewWaitText, type PrReviewState } from './approval';

const state = (o: Partial<PrReviewState> = {}): PrReviewState => ({
	decision: null,
	viewer: 'captain',
	author: 'captain',
	requested: [],
	...o
});

describe('whose turn a ready pull request is', () => {
	it('is the captain’s when nothing was read from GitHub', () => {
		expect(reviewWait(null)).toEqual({ on: 'captain', approved: false });
		expect(reviewWait(undefined)).toEqual({ on: 'captain', approved: false });
	});

	it('is the captain’s when the base branch requires no review and nobody was asked', () => {
		expect(reviewWait(state())).toEqual({ on: 'captain', approved: false });
	});

	it('waits on the reviewers asked for their approval', () => {
		expect(
			reviewWait(state({ decision: 'REVIEW_REQUIRED', requested: ['alice', 'acme/core'] }))
		).toEqual({ on: 'reviewers', reviewers: ['alice', 'acme/core'], required: true });
	});

	it('waits on a review asked of someone else even when none is required', () => {
		expect(reviewWait(state({ requested: ['alice'] }))).toEqual({
			on: 'reviewers',
			reviewers: ['alice'],
			required: false
		});
	});

	it('waits on someone else when an approval is required and the captain opened the PR', () => {
		// GitHub never counts the author's own approval.
		expect(reviewWait(state({ decision: 'REVIEW_REQUIRED' }))).toEqual({
			on: 'reviewers',
			reviewers: [],
			required: true
		});
	});

	it('is the captain’s review when a worker identity opened the PR and approval is required', () => {
		expect(reviewWait(state({ decision: 'REVIEW_REQUIRED', author: 'crew-bot' }))).toEqual({
			on: 'captain',
			approved: false
		});
	});

	it('is the captain’s review when their review is the one requested', () => {
		expect(
			reviewWait(
				state({ decision: 'REVIEW_REQUIRED', author: 'crew-bot', requested: ['captain', 'alice'] })
			)
		).toEqual({ on: 'captain', approved: false });
	});

	it('is the captain’s to merge once approved, even with other reviews still asked', () => {
		expect(reviewWait(state({ decision: 'APPROVED', requested: ['alice'] }))).toEqual({
			on: 'captain',
			approved: true
		});
	});
});

describe('the words for it', () => {
	it('names users with @ and teams as org/team', () => {
		expect(reviewerList(['alice'])).toBe('@alice');
		expect(reviewerList(['alice', 'acme/core'])).toBe('@alice and acme/core');
		expect(reviewerList(['alice', 'bob', 'acme/core'])).toBe('@alice, @bob and acme/core');
	});

	it('says whose turn it is', () => {
		const captain = (approved: boolean) => ({ on: 'captain', approved }) as const;
		const others = (reviewers: string[], required: boolean) =>
			({ on: 'reviewers', reviewers, required }) as const;
		expect(reviewWaitText(12, captain(false))).toBe('Pull request #12 is ready for your review.');
		expect(reviewWaitText(12, captain(true))).toBe(
			'Pull request #12 is approved and ready for you to merge.'
		);
		expect(reviewWaitText(12, others(['alice'], true))).toBe(
			'Pull request #12 is waiting on approval from @alice.'
		);
		expect(reviewWaitText(null, others(['alice'], false))).toBe(
			'Pull request is waiting on a review from @alice.'
		);
		expect(reviewWaitText(12, others([], true))).toBe(
			'Pull request #12 needs an approving review from someone else.'
		);
	});
});
