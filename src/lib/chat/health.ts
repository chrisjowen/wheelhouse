import type { Harbour } from '$lib/harbour';

/** The ship's health in plain words, for the pill in the chat's session bar. */
export interface Health {
	label: string;
	tone: 'success' | 'sea' | 'warning' | 'danger';
}

/**
 * Worst first: a failed step or task, then what waits on the captain, then
 * work Firstmate is watching (blocked, lost, unknown), else all well.
 */
export function shipHealth(h: Harbour): Health {
	if (h.stepFailed.length || h.trouble.some((t) => t.status === 'failed')) {
		return { label: 'Something failed', tone: 'danger' };
	}
	const n = h.needsYou.length;
	if (n) return { label: `${n} need${n === 1 ? 's' : ''} you`, tone: 'sea' };
	if (h.trouble.length) return { label: 'Keeping an eye on a problem', tone: 'warning' };
	return { label: 'All well', tone: 'success' };
}
