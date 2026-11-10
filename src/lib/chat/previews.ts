/**
 * Live previews in the chat: every preview Firstmate links shows as a live
 * box under the reply that links it. A preview a task reported is that task's
 * card (with its pull request and checks, and a remote second mate's preview
 * brought here through its forward); any other address on this machine a
 * reply links (a preview Firstmate serves itself, a forwarded port, a review
 * board) is a box of its own. Pure, so it is unit-tested.
 *
 * A reply is about a task when it names the task id (for a second mate's task,
 * also its id in its own home), its pull request, its preview's or its board's
 * address. Each task has one card: under the latest reply since it reported
 * its preview that links that preview (or its board), else the first one about
 * it; once its work has landed, under the first reply about it since then
 * instead (a landed card). Each other address has one box, under the latest
 * reply that links it, so the newest message about a preview always has it.
 * docs/guide.md says exactly what a reply needs for a box to show.
 */
import type { TaskSummary } from '../types';
import { isBoard, linkedPreviews, pageOf } from '../previewnote';
import { extractUrls } from '../urls';
import type { Item } from './fold';

/**
 * A preview box: a task's card (`task`, and whether its work has landed), or
 * an address a reply links that no task reported (`task` null). `url` is the
 * address the box shows; `board` says it is a review board.
 */
export interface ChatPreview {
	task: TaskSummary | null;
	url: string;
	board: boolean;
	landed: boolean;
}

/** Firstmate relays a report a little after the worker writes it; a reply this much earlier still counts. */
export const SLACK_MS = 2 * 60_000;
/** At most this many boxes of addresses no task reported under one reply. */
export const MAX_LINKED = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pages a task can be seen at: its preview's and its board's. */
const taskPages = (task: TaskSummary) =>
	[task.preview?.url, task.board?.url].filter((u): u is string => !!u).map(pageOf);

const urlIn = (text: string, u: string) => new RegExp(`${escape(u)}(?![\\w-])`).test(text);

const time = (s: string | null | undefined) => {
	const t = s ? Date.parse(s) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** Whether the task was still under way when a reply was written `at`: not landed, or landed only later. */
function underWay(task: TaskSummary, at: number | null): boolean {
	if (task.status !== 'landed') return true;
	const merged = time(task.mergedAt);
	return merged !== null && at !== null && at < merged;
}

/** Whether a reply's text links the task's preview's or board's page. */
function linksTask(text: string, task: TaskSummary): boolean {
	const pages = taskPages(task);
	return extractUrls(text).some((u) => pages.includes(pageOf(u)));
}

/** Whether a reply's text names the task by its id (a second mate's task also by its id in its own home) or its pull request. */
function names(text: string, task: TaskSummary): boolean {
	const ids = [task.id];
	if (task.secondMate) ids.push(task.id.replace(/@[^@]*$/, ''));
	if (ids.some((id) => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w@-])`).test(text))) return true;
	return !!task.pr?.url && urlIn(text, task.pr.url.replace(/\/+$/, ''));
}

/**
 * Whether a reply's text names the task: its id (a second mate's task also by
 * its id in its own home), its pull request, its preview's or its board's page.
 */
export function mentions(text: string, task: TaskSummary): boolean {
	return names(text, task) || linksTask(text, task);
}

/** The address a task's card shows: its preview, else its board. */
const shownUrl = (task: TaskSummary) => task.preview?.url ?? task.board?.url ?? null;

/**
 * Whether an address a reply (written `at`) links is the page a task reported
 * while it was under way then (so the task's card shows it).
 */
function ownedBy(url: string, at: number | null, tasks: TaskSummary[]): boolean {
	const page = pageOf(url);
	return tasks.some((t) => underWay(t, at) && taskPages(t).includes(page));
}

function add(out: Map<string, ChatPreview[]>, anchor: string, card: ChatPreview) {
	out.set(anchor, [...(out.get(anchor) ?? []), card]);
}

/**
 * The preview boxes to show, by the id of the reply part each follows.
 * `ownPort` is the port Wheelhouse is opened on, when on this machine: its
 * own pages are never shown as previews.
 */
export function previewCards(
	items: Item[],
	tasks: TaskSummary[],
	ownPort: string | null = null
): Map<string, ChatPreview[]> {
	const out = new Map<string, ChatPreview[]>();
	const seen = tasks.filter((t) => t.preview || t.board);
	const carded = new Map<string, string[]>();
	for (const task of seen) {
		const url = shownUrl(task)!;
		const reported = time(task.preview?.reportedAt ?? task.board?.reportedAt);
		const landed = task.status === 'landed';
		const merged = landed ? time(task.mergedAt) : null;
		let first: string | null = null;
		let linked: string | null = null;
		let since: string | null = null;
		for (const it of items) {
			if (it.kind !== 'turn') continue;
			const at = time(it.at);
			if (reported !== null && (at === null || at < reported - SLACK_MS)) continue;
			const links = (text: string) => underWay(task, at) && linksTask(text, task);
			const part = it.parts.find(
				(p) => p.kind === 'text' && (names(p.text, task) || links(p.text))
			);
			if (!part || part.kind !== 'text') continue;
			first ??= part.id;
			if (links(part.text)) linked = part.id;
			if (landed && (merged === null || (at !== null && at >= merged - SLACK_MS))) {
				since = part.id;
				break;
			}
		}
		const anchor = since ?? linked ?? first;
		if (!anchor) continue;
		add(out, anchor, { task, url, board: !task.preview, landed });
		carded.set(anchor, [...(carded.get(anchor) ?? []), ...taskPages(task)]);
	}
	// Every other address on this machine a reply links: one box each, under its latest reply.
	const latest = new Map<string, { anchor: string; url: string }>();
	for (const it of items) {
		if (it.kind !== 'turn') continue;
		const at = time(it.at);
		for (const p of it.parts) {
			if (p.kind !== 'text') continue;
			const origins = new Set<string>();
			let n = 0;
			for (const url of linkedPreviews(p.text, ownPort)) {
				const origin = URL.parse(url)!.origin;
				// One box per server under a reply: /a, /b and /c of one prototype are one box.
				if (
					origins.has(origin) ||
					ownedBy(url, at, seen) ||
					carded.get(p.id)?.includes(pageOf(url)) ||
					n >= MAX_LINKED
				)
					continue;
				origins.add(origin);
				n++;
				const key = pageOf(url);
				latest.delete(key);
				latest.set(key, { anchor: p.id, url });
			}
		}
	}
	for (const { anchor, url } of latest.values())
		add(out, anchor, { task: null, url, board: isBoard(url), landed: false });
	return out;
}
