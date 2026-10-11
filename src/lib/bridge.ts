import { harbour } from '$lib/harbour';
import type { BridgeMessage, TaskSummary } from '$lib/types';

/**
 * How the Bridge turns messages and the fleet into its conversation and On
 * deck rail. Pure, so it is unit-tested.
 */

/** A message the browser is still handing to Wheelhouse (or could not reach it with). */
export interface LocalMessage extends Omit<BridgeMessage, 'delivery'> {
	delivery: BridgeMessage['delivery'] | 'unsent';
}

export type FeedItem =
	| { kind: 'message'; key: string; at: string; message: LocalMessage }
	| {
			kind: 'reply';
			key: string;
			at: string;
			message: LocalMessage;
			/** The reply does not directly follow the message it answers. */
			quote: boolean;
	  };

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** http(s) URLs in plain text, without trailing punctuation. */
export function extractUrls(text: string): string[] {
	return [...text.matchAll(URL_RE)].map((m) => m[0].replace(TRAILING, ''));
}

/** Text split into plain runs and URLs, for rendering links in plain text. */
export function linkify(text: string): { text: string; url: boolean }[] {
	const parts: { text: string; url: boolean }[] = [];
	let at = 0;
	for (const m of text.matchAll(URL_RE)) {
		const url = m[0].replace(TRAILING, '');
		if (m.index > at) parts.push({ text: text.slice(at, m.index), url: false });
		parts.push({ text: url, url: true });
		at = m.index + url.length;
	}
	if (at < text.length) parts.push({ text: text.slice(at), url: false });
	return parts;
}

/**
 * Tasks a Firstmate report-in refers to: only a PR or reported preview URL in
 * the text that exactly matches a known task's. Firstmate does not link its
 * replies to tasks, so nothing else (titles, ids) is guessed.
 */
export function matchTasks(text: string, tasks: TaskSummary[]): TaskSummary[] {
	const urls = new Set(extractUrls(text));
	if (!urls.size) return [];
	return tasks.filter(
		(t) => (t.pr && urls.has(t.pr.url)) || (t.preview && urls.has(t.preview.url))
	);
}

const time = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** Messages and replies in the order they happened, oldest first. */
export function feed(messages: LocalMessage[]): FeedItem[] {
	const items: (FeedItem & { t: number; seq: number })[] = [];
	messages.forEach((m, i) => {
		const sent = time(m.submittedAt) ?? 0;
		items.push({
			kind: 'message',
			key: `m:${m.requestId}`,
			at: m.submittedAt,
			message: m,
			t: sent,
			seq: i * 2
		});
		if (m.reply) {
			items.push({
				kind: 'reply',
				key: `r:${m.requestId}`,
				at: m.reply.at ?? m.submittedAt,
				message: m,
				quote: false,
				// A reply never sorts before the message it answers.
				t: Math.max(sent, time(m.reply.at) ?? sent),
				seq: i * 2 + 1
			});
		}
	});
	items.sort((a, b) => a.t - b.t || a.seq - b.seq);
	return items.map(({ t: _t, seq: _seq, ...item }, i, all) => {
		if (item.kind !== 'reply') return item;
		const prev = all[i - 1];
		return { ...item, quote: !(prev?.kind === 'message' && prev.message === item.message) };
	});
}

/** Server messages, with the browser's not-yet-confirmed ones after them. */
export function mergeLocal(server: BridgeMessage[], local: LocalMessage[]): LocalMessage[] {
	const known = new Set(server.map((m) => m.requestId));
	return [...server, ...local.filter((m) => !known.has(m.requestId))];
}

export interface OnDeck {
	counts: { needsYou: number; underWay: number; queued: number; landed: number };
	needsYou: TaskSummary[];
	underWay: TaskSummary[];
}

/** The On deck rail: fleet-wide counts and the tasks that need the captain or are moving. */
export function onDeck(tasks: TaskSummary[], now: number): OnDeck {
	const h = harbour(tasks, now);
	return {
		counts: {
			needsYou: h.needsYou.length,
			underWay: h.underWay.length + h.waitingOnFirstmate.length,
			queued: h.queued.length,
			landed: h.landedRecent.length
		},
		needsYou: h.needsYou,
		underWay: [...h.waitingOnFirstmate, ...h.underWay]
	};
}

/** A fresh request id for one message; retries of that message reuse it. */
export function newRequestId(): string {
	return `wh-${crypto.randomUUID()}`;
}
