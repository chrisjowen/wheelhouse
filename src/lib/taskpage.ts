import type { Strand } from './tasktimeline';
import type { PassageStep, TaskEvidence, TaskSummary } from './types';

/**
 * The task page's layout rules: which tabs it shows, which one opens, and the
 * one line a folded stage of the timeline shows. Pure, so they are unit-tested.
 */

export type TaskTab = { id: string; label: string; count?: number };

export const DEFAULT_TAB = 'timeline';

/**
 * Tabs the page used to have, whose content is now part of the Timeline, so
 * an old link (`?tab=stages`, `talk`, `checks` or `log`) still lands on it:
 * the conversation's link with the timeline showing only the conversation,
 * the checks' link at the Checks section.
 */
export const MERGED_TABS: Record<string, { strand?: Strand; anchor?: string }> = {
	stages: {},
	talk: { strand: 'talk' },
	checks: { anchor: 'checks' },
	log: {}
};

/**
 * The tabs across the top of the page, in order: the Timeline (the whole
 * story), Live preview only while one is reported, the files changed, the
 * docs, the screenshots and each plugin's section (counted when there is
 * something in them). The overview and the task's time sit beside them.
 */
export function taskTabs(o: {
	preview: boolean;
	shots: number;
	files: number;
	docs: number;
	plugins: { key: string; title: string }[];
}): TaskTab[] {
	const counted = (n: number) => (n ? { count: n } : {});
	return [
		{ id: 'timeline', label: 'Timeline' },
		...(o.preview ? [{ id: 'preview', label: 'Live preview' }] : []),
		{ id: 'changes', label: 'Changes', ...counted(o.files) },
		{ id: 'docs', label: 'Docs', ...counted(o.docs) },
		{ id: 'screenshots', label: 'Screenshots', ...counted(o.shots) },
		...o.plugins.map((p) => ({ id: `plugin:${p.key}`, label: p.title }))
	];
}

/** The tab a `?tab=` value asks for, when the page has it; an old tab's content is in the Timeline. */
export const pickTab = (want: string | null, tabs: TaskTab[]): string =>
	want && tabs.some((t) => t.id === want) ? want : DEFAULT_TAB;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one plain line a folded stage shows: what its evidence came to, else
 * its note. Null when there is nothing worth a line.
 */
export function stepGist(
	s: PassageStep,
	task: TaskSummary,
	ev: TaskEvidence | null
): string | null {
	if (s.state === 'skipped') return s.note;
	if (s.state === 'upcoming') return null;
	const parts: string[] = [];
	for (const id of s.evidence) {
		if (id === 'files' && ev?.files.available) {
			const n = ev.files.value.total;
			parts.push(n ? `${plural(n, 'file')} changed` : 'No changes yet');
		} else if (id === 'pr' && (ev?.pr.available || task.pr)) {
			const pr = ev?.pr.available ? ev.pr.value : null;
			const n = pr?.number ?? task.pr?.number ?? null;
			const state = pr ? (pr.draft ? 'draft' : pr.state) : null;
			parts.push(`Pull request${n ? ` #${n}` : ''}${state ? ` ${state}` : ''}`);
		} else if (id === 'screenshots' && ev?.screenshots.available && ev.screenshots.value.length) {
			parts.push(plural(ev.screenshots.value.length, 'screenshot'));
		} else if (id === 'report' && ev?.report.available) {
			parts.push('Report written');
		} else if (id === 'validation' && s.state === 'done') {
			parts.push('Checks passed');
		}
	}
	return parts.length ? parts.join(' · ') : s.note;
}

/** A pull request's state in a word or two, as the overview and the Pull request stage say it. */
export const prState = (s: string | null, draft: boolean | null): string =>
	draft
		? 'draft'
		: s === 'merged'
			? 'merged'
			: s === 'closed'
				? 'closed'
				: s === 'open'
					? 'open'
					: (s ?? 'state unknown');
