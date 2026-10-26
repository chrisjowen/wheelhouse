import type { AlertAction, AlertKind, FleetView, Picker, ShipAlert, TaskSummary } from './types';

/**
 * The ship's bell: which moments in a task's records ring it, shared by the
 * server (which raises each alert once) and the browser (which drops a
 * captain's toast once the moment has passed).
 *
 * Each alert's id is made from the record that raised it (the PR, the
 * question's text, the status and its summary, the last word), so the
 * same moment always has the same id and rings once, however often the fleet
 * is read, and a new moment on the same task (another question) rings again.
 * A moment that passes and comes back (the PR goes green again after rework)
 * is raised again with the same id; its raise key (id and time) tells the two
 * raises apart.
 */

export const ALERT_KINDS: { kind: AlertKind; label: string; hint: string }[] = [
	{
		kind: 'pr-green',
		label: 'PR green',
		hint: 'A pull request passed its checks and waits on you'
	},
	{ kind: 'question', label: 'Question waiting', hint: 'Firstmate needs your decision' },
	{ kind: 'stuck', label: 'Worker stuck', hint: 'Blocked, failed, lost contact or gone quiet' },
	{ kind: 'landed', label: 'Merge landed', hint: 'A pull request was merged' }
];

/** A working task with no word for this long, and nothing running, has gone quiet. */
export const QUIET_AFTER_MS = 20 * 60_000;
/** Longest alert text; longer questions are cut (the task page has the whole of it). */
const MAX_TEXT = 220;

export type AlertDraft = Omit<ShipAlert, 'at'>;

/** The moments a task's current records show, as alerts (most tasks show none). */
export function alertsFor(task: TaskSummary, nowMs: number): AlertDraft[] {
	const out: AlertDraft[] = [];
	const base = { taskId: task.id, projectId: task.projectId, title: task.shortTitle };
	const page = taskHref(task.id);
	const open = (label: string, href: string = page): AlertAction => ({
		kind: 'open',
		label,
		href,
		external: false
	});
	const prLink = (label: string): AlertAction[] =>
		task.pr ? [{ kind: 'open', label, href: task.pr.url, external: true }] : [];
	const prName = task.pr?.number ? `Pull request #${task.pr.number}` : 'The pull request';

	if (task.status === 'needs-review' && task.attention?.kind === 'review' && task.pr) {
		const id = `pr-green:${task.id}:${task.pr.url}`;
		out.push({
			...base,
			id,
			kind: 'pr-green',
			captain: true,
			text: `${prName} is green and ready to merge.`,
			actions: [
				{
					kind: 'note',
					label: 'Merge',
					text: `Please merge ${task.pr.url} (${task.id}: ${task.shortTitle}). Sent from Wheelhouse's ship's bell.`,
					requestId: `wh-bell-merge-${digest(id)}`,
					sent: 'Asked Firstmate to merge'
				},
				...prLink('Open PR'),
				open('Open task')
			]
		});
	} else if (task.status === 'needs-decision' && task.attention?.owner === 'captain') {
		out.push({
			...base,
			id: `question:${task.id}:${digest(task.attention.text)}`,
			kind: 'question',
			captain: true,
			text: cut(task.attention.text),
			actions: [open('Open decision'), open('Answer in chat', chatHref(task.id))]
		});
	} else if (task.status === 'blocked' || task.status === 'failed' || task.status === 'lost') {
		out.push({
			...base,
			id: `stuck:${task.id}:${task.status}:${digest(task.summaryRaw ?? task.summary ?? task.statusLabel)}`,
			kind: 'stuck',
			captain: false,
			text: cut(task.summary ? `${task.statusLabel}: ${task.summary}` : task.statusLabel),
			actions: [open('Open task'), open('Ask Firstmate', chatHref(task.id))]
		});
	} else if (quiet(task, nowMs)) {
		const mins = Math.round((nowMs - Date.parse(task.activity!.at!)) / 60_000);
		out.push({
			...base,
			id: `stuck:${task.id}:quiet:${digest(task.activity!.text)}`,
			kind: 'stuck',
			captain: false,
			text: `Gone quiet: no word for ${mins} minutes while working.`,
			actions: [open('Open task'), open('Ask Firstmate', chatHref(task.id))]
		});
	} else if (task.status === 'landed') {
		out.push({
			...base,
			id: `landed:${task.id}`,
			kind: 'landed',
			captain: false,
			text: task.pr ? `${prName} was merged.` : 'The work was merged.',
			actions: [open('Open task'), ...prLink('View PR')]
		});
	}
	return out;
}

/**
 * A menu Firstmate's session is waiting on (its question picker, or a
 * permission prompt): a question for the captain, answered in the chat. The
 * menu's signature tells one question from the next.
 */
export function sessionAlert(picker: Picker): AlertDraft {
	return {
		id: `question:firstmate:${digest(picker.signature)}`,
		kind: 'question',
		taskId: null,
		projectId: null,
		title: 'Firstmate',
		captain: true,
		text: cut(picker.title || 'Firstmate is asking you.'),
		actions: [{ kind: 'open', label: 'Answer in chat', href: '/', external: false }]
	};
}

/**
 * An alert raised at a time. A note's request id is the raise's own, so a
 * moment raised again (the PR green again) asks Firstmate again, while one
 * raise asks at most once.
 */
export function raise(draft: AlertDraft, at: string): ShipAlert {
	return {
		...draft,
		at,
		actions: draft.actions.map((a) =>
			a.kind === 'note' ? { ...a, requestId: `${a.requestId}-${digest(at)}` } : a
		)
	};
}

/** One raise of an alert: what the browser rings, and dismisses, once. */
export function raiseKey(alert: ShipAlert): string {
	return `${alert.id}@${alert.at}`;
}

/** Working, not busy, nothing running, and no word for a while. */
function quiet(task: TaskSummary, nowMs: number): boolean {
	if (task.status !== 'working' || task.busy) return false;
	if (task.pipeline && task.pipeline.outcome === 'running') return false;
	const at = task.activity?.at ? Date.parse(task.activity.at) : NaN;
	return Number.isFinite(at) && nowMs - at >= QUIET_AFTER_MS;
}

/**
 * Whether a task's captain alert still waits on the captain in this fleet
 * view: the PR is still ready for review, the question still open. Other
 * alerts are news, so they always hold. With no fleet read yet, nothing is
 * dropped.
 */
export function stillHolds(alert: ShipAlert, fleet: FleetView | null): boolean {
	// A session question is settled by the server's word, not the fleet.
	if (!alert.captain || alert.taskId === null || !fleet || !fleet.collectedAt) return true;
	const task = fleet.tasks.find((t) => t.id === alert.taskId);
	if (!task) return false;
	return alertsFor(task, Date.now()).some((a) => a.id === alert.id);
}

export function taskHref(id: string): string {
	return `/tasks/${encodeURIComponent(id)}`;
}

function chatHref(id: string): string {
	return `/?chat=${encodeURIComponent(id)}`;
}

function cut(text: string): string {
	const t = text.replace(/\s+/g, ' ').trim();
	return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1).trimEnd()}…` : t;
}

/** A short, stable digest (two FNV-1a passes), the same in Node and the browser. */
export function digest(text: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ 0x5bd1e995;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193);
		b = Math.imul(b ^ c, 0x5bd1e995);
	}
	return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
