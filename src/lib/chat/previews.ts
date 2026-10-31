/**
 * Live previews in the chat: a task's reported preview shows as a card under
 * the Firstmate reply that tells the captain about it. A reply is about a task
 * when it names the task id, its pull request or its preview's address. Each
 * task has one card: under the first reply about it once it reported its
 * preview, and, once it has landed, under the first reply about it since then
 * instead (a landed card). Pure, so it is unit-tested.
 */
import type { TaskSummary } from '../types';
import type { Item } from './fold';

/** A preview card: the task, and whether its work has landed (the card says so wherever it sits). */
export interface ChatPreview {
	task: TaskSummary;
	landed: boolean;
}

/** Firstmate relays a report a little after the worker writes it; a reply this much earlier still counts. */
export const SLACK_MS = 2 * 60_000;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a reply's text names the task: its id, its pull request or its preview address. */
export function mentions(text: string, task: TaskSummary): boolean {
	if (new RegExp(`(?<![\\w-])${escape(task.id)}(?![\\w-])`).test(text)) return true;
	const urls = [task.pr?.url, task.preview?.url]
		.filter((u): u is string => !!u)
		.map((u) => u.replace(/\/+$/, ''));
	return urls.some((u) => new RegExp(`${escape(u)}(?![\\w-])`).test(text));
}

const time = (s: string | null | undefined) => {
	const t = s ? Date.parse(s) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** The preview cards to show, by the id of the reply part each follows. */
export function previewCards(items: Item[], tasks: TaskSummary[]): Map<string, ChatPreview[]> {
	const out = new Map<string, ChatPreview[]>();
	for (const task of tasks) {
		if (!task.preview) continue;
		const reported = time(task.preview.reportedAt);
		const landed = task.status === 'landed';
		const merged = landed ? time(task.mergedAt) : null;
		let first: string | null = null;
		let since: string | null = null;
		for (const it of items) {
			if (it.kind !== 'turn') continue;
			const at = time(it.at);
			if (reported !== null && (at === null || at < reported - SLACK_MS)) continue;
			const part = it.parts.find((p) => p.kind === 'text' && mentions(p.text, task));
			if (!part) continue;
			first ??= part.id;
			if (landed && (merged === null || (at !== null && at >= merged - SLACK_MS))) {
				since = part.id;
				break;
			}
		}
		const anchor = since ?? first;
		if (!anchor) continue;
		out.set(anchor, [...(out.get(anchor) ?? []), { task, landed }]);
	}
	return out;
}
