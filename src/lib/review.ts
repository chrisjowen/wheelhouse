import type { TaskSummary } from '$lib/types';

/**
 * What the captain reviews a pull request with: its screenshots, the live
 * preview (the one the worker reported, else the link the project's passage
 * declares for the step, such as a preview deployment), and the pull request
 * itself. Shared by the
 * Harbour "Your move" card and the task page's review panel. Pure, so it is
 * unit-tested; a missing piece of evidence is said plainly, never hidden.
 */

export const NO_SCREENSHOTS = 'No screenshots saved';
export const NO_PREVIEW = 'No live preview reported';
export const NO_PR = 'No pull request recorded';

export interface ReviewShot {
	name: string;
	url: string;
}

export interface ReviewView {
	shots: ReviewShot[];
	/** "3 screenshots", or NO_SCREENSHOTS. */
	shotsText: string;
	preview: { url: string } | null;
	/** "Live preview" when there is one, else NO_PREVIEW. */
	previewText: string;
	pr: { url: string; label: string } | null;
	prText: string;
}

/** A task waiting on the captain's review of its pull request (or local-only work). */
export const awaitingReview = (t: TaskSummary) =>
	t.attention?.owner === 'captain' && t.attention.kind === 'review';

export function shotsText(count: number): string {
	if (count <= 0) return NO_SCREENSHOTS;
	return `${count} ${count === 1 ? 'screenshot' : 'screenshots'}`;
}

/**
 * The review view of a task. `shots` is the task page's screenshot list; the
 * Harbour card has only the count and the latest thumbnail, so it passes null.
 */
export function reviewView(t: TaskSummary, shots: ReviewShot[] | null = null): ReviewView {
	const list = shots ?? [];
	const count = shots ? list.length : t.screenshots;
	// A preview the worker reported, else the review step's declared link (e.g. a preview deployment).
	const preview = t.preview?.url ?? t.passage.link?.url ?? null;
	return {
		shots: list,
		shotsText: shotsText(count),
		preview: preview ? { url: preview } : null,
		previewText: preview ? 'Live preview' : NO_PREVIEW,
		pr: t.pr ? { url: t.pr.url, label: t.pr.number ? `PR #${t.pr.number}` : 'Pull request' } : null,
		prText: t.pr ? (t.pr.number ? `PR #${t.pr.number}` : 'Pull request') : NO_PR
	};
}
