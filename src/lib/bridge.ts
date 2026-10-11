import { isCompleted, type Shelf } from '$lib/harbour';
import type { BridgeMessage, TaskSummary } from '$lib/types';

/**
 * How the Bridge turns messages and the fleet into focused threads (one task's
 * conversation at a time) and decisions into questions. Pure, so it is
 * unit-tested.
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

/** The thread a message belongs to: its task, or the general thread (null). */
export function threadMessages(messages: LocalMessage[], taskId: string | null): LocalMessage[] {
	return messages.filter((m) => (m.taskId ?? null) === taskId);
}

export interface Thread {
	/** The task the thread is about; null is the general thread. */
	taskId: string | null;
	title: string;
	/** The task, when the fleet still knows it. */
	task: TaskSummary | null;
	/** Waiting on the captain (a captain hold or a PR to review). */
	needsYou: boolean;
	/** Firstmate replies the captain has not seen yet. */
	unread: number;
	/** The thread's task has landed or finished. */
	completed: boolean;
	/** Latest activity, epoch ms (null when the thread has no messages). */
	lastAt: number | null;
}

/** Key for a thread in URLs and drafts; the general thread has none. */
export const threadKey = (taskId: string | null) => taskId ?? '';

/**
 * Threads the captain can switch between: the general thread, every task with
 * messages, every task that needs the captain, and the focused task. General
 * first, then what needs the captain, then the most recently active.
 */
export function threads(
	messages: LocalMessage[],
	tasks: TaskSummary[],
	focus: string | null,
	seen: ReadonlySet<string>
): Thread[] {
	const byTask = new Map(tasks.map((t) => [t.id, t]));
	const ids = new Set<string>();
	for (const m of messages) if (m.taskId) ids.add(m.taskId);
	for (const t of tasks) if (t.attention?.owner === 'captain') ids.add(t.id);
	if (focus) ids.add(focus);

	const make = (taskId: string | null): Thread => {
		const task = taskId ? (byTask.get(taskId) ?? null) : null;
		const mine = threadMessages(messages, taskId);
		let lastAt: number | null = null;
		for (const m of mine) {
			const at = Math.max(time(m.submittedAt) ?? 0, time(m.reply?.at) ?? 0);
			if (at && (lastAt === null || at > lastAt)) lastAt = at;
		}
		return {
			taskId,
			title: taskId ? (task?.title ?? taskId) : 'General',
			task,
			needsYou: task?.attention?.owner === 'captain',
			unread: mine.filter((m) => m.reply && !seen.has(m.requestId)).length,
			completed: !!task && isCompleted(task),
			lastAt
		};
	};

	const list = [...ids].map(make);
	list.sort(
		(a, b) =>
			Number(b.needsYou) - Number(a.needsYou) ||
			(b.lastAt ?? 0) - (a.lastAt ?? 0) ||
			a.title.localeCompare(b.title)
	);
	return [make(null), ...list];
}

/** Threads on one shelf: the general thread is always under way. */
export function shelfThreads(list: Thread[], shelf: Shelf): Thread[] {
	return list.filter((t) => (shelf === 'completed' ? t.completed : !t.completed));
}

export interface DecisionOption {
	/** The marker as written, e.g. "(a)". */
	marker: string;
	text: string;
}

export interface Decision {
	question: string;
	/** Empty when the text lists no options; the question is then the whole text. */
	options: DecisionOption[];
}

const MARKER = /\(([a-z]|\d{1,2})\)/gi;
const nextMarker = (m: string) =>
	/\d/.test(m) ? String(Number(m) + 1) : String.fromCharCode(m.toLowerCase().charCodeAt(0) + 1);

/**
 * A captain decision as a question and its options. Options are a run of
 * markers in order, (a) (b) (c) or (1) (2) (3), after an "Options:" label
 * when there is one; fewer than two means plain text.
 */
export function parseDecision(text: string): Decision {
	const t = text.trim();
	const label = /\boptions\s*:/i.exec(t);
	const from = label ? label.index + label[0].length : 0;
	const run: RegExpExecArray[] = [];
	for (const m of t.matchAll(MARKER)) {
		if (m.index < from) continue;
		const key = m[1].toLowerCase();
		if (!run.length) {
			if (key === 'a' || key === '1') run.push(m);
		} else if (key === nextMarker(run.at(-1)![1])) run.push(m);
	}
	if (run.length < 2) return { question: t, options: [] };

	const question = t
		.slice(0, run[0].index)
		.replace(/\s*\boptions\s*:\s*$/i, '')
		.trim();
	const options = run.map((m, i) => ({
		marker: m[0],
		text: t
			.slice(m.index + m[0].length, run[i + 1]?.index ?? t.length)
			.trim()
			.replace(/[\s;,]*(?:\b(?:or|and))?[\s;,]*$/i, '')
			.trim()
	}));
	return { question: question || t, options };
}

/** The decision the captain is asked to make on this task, if any. */
export function captainDecision(task: TaskSummary | null): Decision | null {
	const a = task?.attention;
	return a?.kind === 'decision' && a.owner === 'captain' ? parseDecision(a.text) : null;
}

/** The composer after picking an option: its marker replaces any leading marker, keeping the rest. */
export const optionDraft = (o: DecisionOption, draft = '') =>
	`${o.marker} ${draft.replace(/^\s*\(([a-z]|\d{1,2})\)\s*/i, '')}`;

/** A new message from the composer, about the thread's task (or none). */
export function outgoing(
	text: string,
	taskId: string | null,
	requestId: string,
	at: Date
): LocalMessage {
	return {
		requestId,
		text: text.trim(),
		taskId,
		submittedAt: at.toISOString(),
		delivery: 'sending',
		deliveryDetail: null,
		acknowledged: null,
		noteId: null,
		reply: null
	};
}

/** A fresh request id for one message; retries of that message reuse it. */
export function newRequestId(): string {
	return `wh-${crypto.randomUUID()}`;
}

/** The parts of a keydown the composer looks at. */
export interface ComposerKey {
	key: string;
	shiftKey: boolean;
	isComposing?: boolean;
	keyCode?: number;
}

/**
 * What a key press in the composer does: Enter sends (so does Cmd/Ctrl+Enter),
 * Shift+Enter inserts a new line, and nothing is sent while an input method is
 * still composing text (Enter then confirms the composition).
 */
export function composerKey(e: ComposerKey): 'send' | 'newline' | null {
	if (e.key !== 'Enter') return null;
	// keyCode 229 is how some browsers report keys an IME is handling.
	if (e.isComposing || e.keyCode === 229) return null;
	return e.shiftKey ? 'newline' : 'send';
}
