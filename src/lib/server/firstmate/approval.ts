/**
 * Whose turn a ready pull request is: the captain's (their review, or their
 * merge once it is approved), or other people's (reviewers whose approval the
 * PR is waiting on). Read from GitHub's own review state, never guessed: the
 * PR's review decision (which GitHub derives from the base branch's required
 * approvals), the reviews still requested, and who opened it. Pure, so it is
 * unit-tested.
 */

/** A pull request's review state, as read from GitHub. */
export interface PrReviewState {
	/**
	 * GitHub's reviewDecision: APPROVED, CHANGES_REQUESTED or REVIEW_REQUIRED
	 * (the base branch requires approvals it does not have yet); null when the
	 * base branch requires no review.
	 */
	decision: string | null;
	/** The account Wheelhouse reads GitHub as: the captain's. */
	viewer: string | null;
	/** Who opened the pull request. */
	author: string | null;
	/** Reviews requested and not yet given: a user's login, or `org/team` for a team. */
	requested: string[];
}

export type ReviewWait =
	/** The captain's move: their review, or their merge when `approved`. */
	| { on: 'captain'; approved: boolean }
	/**
	 * Waiting on other people: the reviewers asked (none named when GitHub
	 * requires an approval the captain cannot give), and whether GitHub
	 * requires their approval before the PR can merge.
	 */
	| { on: 'reviewers'; reviewers: string[]; required: boolean };

/**
 * Whose turn the PR is. With nothing read from GitHub it is the captain's, as
 * it always was. An approved PR is the captain's to merge. A review requested
 * of the captain is theirs to do; one requested of anyone else is theirs. When
 * GitHub requires an approval and the captain opened the PR, their own
 * approval does not count, so it waits on someone else even with nobody asked.
 */
export function reviewWait(review: PrReviewState | null | undefined): ReviewWait {
	if (!review) return { on: 'captain', approved: false };
	if (review.decision === 'APPROVED') return { on: 'captain', approved: true };
	const required = review.decision === 'REVIEW_REQUIRED';
	const { viewer } = review;
	if (viewer && review.requested.includes(viewer)) return { on: 'captain', approved: false };
	const others = review.requested.filter((r) => r !== viewer);
	if (others.length) return { on: 'reviewers', reviewers: others, required };
	if (required && viewer && review.author === viewer) {
		return { on: 'reviewers', reviewers: [], required };
	}
	return { on: 'captain', approved: false };
}

/** "@alice", "@alice and acme/core", "@alice, @bob and acme/core". */
export function reviewerList(reviewers: string[]): string {
	const names = reviewers.map((r) => (r.includes('/') ? r : `@${r}`));
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

/** What a ready PR waits on, in a sentence. */
export function reviewWaitText(prNumber: number | null, wait: ReviewWait): string {
	const pr = `Pull request${prNumber ? ` #${prNumber}` : ''}`;
	if (wait.on === 'captain') {
		return wait.approved
			? `${pr} is approved and ready for you to merge.`
			: `${pr} is ready for your review.`;
	}
	if (!wait.reviewers.length) return `${pr} needs an approving review from someone else.`;
	const who = reviewerList(wait.reviewers);
	return wait.required
		? `${pr} is waiting on approval from ${who}.`
		: `${pr} is waiting on a review from ${who}.`;
}
