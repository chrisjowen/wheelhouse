import { FEEDBACK_PREFIX } from './preview';
import type { BridgeMessage, Delivery, PassageStep, TaskEvidence, TaskSummary } from './types';

/**
 * The task page's layout rules: which tabs it shows, which one opens, which
 * stages start expanded and the one line a collapsed stage shows. Pure, so
 * they are unit-tested.
 */

export type TaskTab = { id: string; label: string; count?: number };

export const DEFAULT_TAB = 'stages';

/**
 * The tabs beside the overview, in order. Preview only while one is reported.
 * With `build`, the build's Conversation, Checks and Docs follow (counted when
 * there is something in them). The live terminal and the task's time sit under
 * the overview, not in a tab.
 */
export function taskTabs(o: {
	preview: boolean;
	shots: number;
	plugins: { key: string; title: string }[];
	build?: { talk: number; docs: number };
}): TaskTab[] {
	const counted = (n: number) => (n ? { count: n } : {});
	return [
		{ id: 'stages', label: 'Stages' },
		...(o.preview ? [{ id: 'preview', label: 'Live preview' }] : []),
		...(o.build
			? [
					{ id: 'talk', label: 'Conversation', ...counted(o.build.talk) },
					{ id: 'checks', label: 'Checks' },
					{ id: 'docs', label: 'Docs', ...counted(o.build.docs) }
				]
			: []),
		{ id: 'screenshots', label: 'Screenshots', ...counted(o.shots) },
		...o.plugins.map((p) => ({ id: `plugin:${p.key}`, label: p.title })),
		{ id: 'log', label: 'Log' }
	];
}

/** The tab a `?tab=` value asks for, when the page has it; else Stages. */
export const pickTab = (want: string | null, tabs: TaskTab[]): string =>
	want && tabs.some((t) => t.id === want) ? want : DEFAULT_TAB;

/** A stage starts expanded only while it is the current one; the rest fold to one line. */
export const openByDefault = (s: PassageStep): boolean => s.state === 'current';

/** Whether a stage has anything to show when expanded. */
export const hasDetail = (s: PassageStep): boolean =>
	s.state === 'done' || s.state === 'current' || !!s.note;

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

/** One piece of feedback sent from a task's live preview, as its comment thread shows it. */
export interface PreviewComment {
	id: string;
	text: string;
	at: string;
	/** In plain words: sending, sent, read by Firstmate, or not delivered. */
	status: string;
	failed: boolean;
	reply: string | null;
}

const STATUS: Record<Delivery, string> = {
	sending: 'Sending…',
	uncertain: 'Confirming Firstmate has it…',
	'saved-unannounced': 'Saved; Firstmate reads it at its next check',
	delivered: 'Sent to Firstmate',
	failed: 'Not delivered'
};

/**
 * The feedback sent from this task's preview (see feedbackNote in preview.ts),
 * oldest first, out of everything Wheelhouse has sent to Firstmate.
 */
export function previewThread(messages: BridgeMessage[], taskId: string): PreviewComment[] {
	return messages
		.filter((m) => m.taskId === taskId && FEEDBACK_PREFIX.test(m.text))
		.map((m) => ({
			id: m.requestId,
			text: m.text.replace(FEEDBACK_PREFIX, ''),
			at: m.submittedAt,
			status:
				m.delivery === 'delivered' && m.acknowledged ? 'Firstmate has it' : STATUS[m.delivery],
			failed: m.delivery === 'failed',
			reply: m.reply?.body ?? null
		}));
}
