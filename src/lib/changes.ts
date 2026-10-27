import { plural } from './format';
import type { ChangeRequest, ChangeRequests } from './types';

/**
 * How the changes requested on a task's pull request read: the checklist's
 * words and the one-line count cards show. Pure, so the server-derived
 * checklist (server/firstmate/changes.ts) reads the same everywhere.
 */

/** Where a request came from, in plain words. */
export const SOURCE_LABEL: Record<ChangeRequest['kind'], string> = {
	review: 'GitHub review',
	thread: 'GitHub review comment',
	comment: 'GitHub comment',
	preview: 'Preview feedback',
	'pr-review': 'Wheelhouse PR review',
	decision: 'Decisions inbox'
};

export const STATE_LABEL: Record<ChangeRequest['state'], string> = {
	open: 'To do',
	resolved: 'Resolved on GitHub',
	addressed: 'Worker reported it ready since'
};

/** The file and line a request is on, e.g. "src/a.ts, line 7". */
export const changeWhere = (c: ChangeRequest): string | null =>
	c.where ? `${c.where.path}${c.where.line != null ? `, line ${c.where.line}` : ''}` : null;

/** The requests still to do, then the ones done (resolved or addressed), each oldest first. */
export function splitChanges(items: ChangeRequest[]): {
	open: ChangeRequest[];
	done: ChangeRequest[];
} {
	return {
		open: items.filter((c) => c.state === 'open'),
		done: items.filter((c) => c.state !== 'open')
	};
}

/** The count line, e.g. "2 changes to make · 1 done"; null when nothing was requested. */
export function changesLine(c: ChangeRequests | null | undefined): string | null {
	if (!c?.items.length) return c?.active ? 'Changes requested' : null;
	const { open, done } = splitChanges(c.items);
	const parts = [
		open.length ? `${open.length} ${plural(open.length, 'change', 'changes')} to make` : null,
		done.length ? `${done.length} done` : null
	].filter(Boolean);
	return parts.join(' · ');
}
