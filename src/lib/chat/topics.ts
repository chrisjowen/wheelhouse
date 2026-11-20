/**
 * Threads in the chat: every message, decision card and preview card is
 * tagged with the project (or free-standing topic, such as "time-capsule")
 * it is about, so the chat can be read one thread at a time.
 *
 * Firstmate labels its replies with an invisible marker line, at the start of
 * a reply or of each section of a multi-project round-up; a section runs until
 * the next marker, also across the reply's later parts:
 *
 *     <!-- project: orgcontrol -->
 *
 * The slug is a registered project's id or name, else a kebab-case topic,
 * which becomes a thread of its own; `<slug>/<task id>` also names the task
 * within it, the tag's second part. The captain's messages carry the thread
 * they were sent in as a leading `[project <slug>]` or `[project <slug>/<task>]`
 * (after a reply's quote). Without either, a reply to a message takes that
 * message's thread; else the tag is a guess: the one project of the tasks a
 * message names (its id, pull request or preview address), and the task when
 * it names one, else, for Firstmate's answer to the captain, the thread of the
 * message it answers; else the message is Unsorted. A captain's re-tag, kept
 * in this browser, overrides everything. Pure, so it is unit-tested.
 */
import type { Project, TaskSummary } from '../types';
import { parseAttachments } from './attachments';
import type { Item } from './fold';
import { mentions } from './previews';
import { parseReply, plain, type ReplyTo } from './reply';

/** The thread key of messages about no project. */
export const UNSORTED = 'unsorted';

/** Where a tag came from, as the tag says it. */
export type TagSource = 'marker' | 'decision' | 'task' | 'thread' | 'reply' | 'you' | 'guess';

export interface Tag {
	/** A project id, a topic slug, or UNSORTED. */
	topic: string;
	/** The task within it the message is about, when known: the tag's second part. */
	task?: string;
	/** null for Unsorted. */
	source: TagSource | null;
}

/** A tag, with its task only when there is one. */
const tagOf = (topic: string, source: TagSource | null, task?: string | null): Tag =>
	task ? { topic, task, source } : { topic, source };

export const UNSORTED_TAG: Tag = { topic: UNSORTED, source: null };

/** A reply's words between its markers: `slug` as written, or null before the first marker. */
export interface Section {
	slug: string | null;
	text: string;
}

/** A section of a reply, tagged; `key` is what a re-tag is kept under. */
export interface TaggedSection {
	key: string;
	text: string;
	tag: Tag;
	/** The words before a round-up's first marker: shown with its sections, not filed on its own. */
	intro: boolean;
}

const MARKER = /^\s{0,3}<!--\s*project:\s*([^\s>]+?)\s*-->\s*$/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * A reply's text split at its marker lines (outside code blocks), markers
 * removed. Text with no marker is one section with a null slug; blank
 * sections are dropped.
 */
export function parseMarkers(text: string): Section[] {
	const out: Section[] = [];
	let slug: string | null = null;
	let lines: string[] = [];
	let fence: string | null = null;
	const flush = () => {
		const t = lines.join('\n').trim();
		if (t) out.push({ slug, text: t });
		lines = [];
	};
	for (const line of text.split('\n')) {
		const f = line.match(FENCE)?.[1];
		if (f && (!fence || f[0] === fence[0])) fence = fence ? null : f;
		const m = fence ? null : line.match(MARKER);
		if (m) {
			flush();
			slug = m[1];
		} else lines.push(line);
	}
	flush();
	if (!out.length && !text.trim()) return [];
	return out.length ? out : [{ slug, text: '' }];
}

const PREFIX = /^\[project ([^\]\s]+)\][ \u00a0]?/;

/** A captain's message with its thread (and task, when there is one) named first, as Firstmate receives it. */
export function withThread(text: string, topic: string | null, task?: string | null): string {
	if (!topic || topic === UNSORTED) return text;
	return `[project ${topic}${task ? `/${task}` : ''}] ${text}`;
}

/** A thread as written, `slug` or `slug/task`: its slug and the task it names, if any. */
export function splitThread(written: string): { slug: string; task: string | null } {
	const at = written.indexOf('/');
	return at > 0 && at < written.length - 1
		? { slug: written.slice(0, at), task: written.slice(at + 1) }
		: { slug: written.replace(/\/$/, ''), task: null };
}

/** A captain's message back as the thread it was sent in (null for none) and its words. */
export function parseThread(text: string): { topic: string | null; text: string } {
	const m = text.match(PREFIX);
	return m ? { topic: m[1], text: text.slice(m[0].length) } : { topic: null, text };
}

/** "Time capsule" → "time-capsule". */
export const slugify = (s: string) =>
	s
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9.]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** A slug as written, as its thread key: the registered project it names, else its own slug. */
export function resolveTopic(
	slug: string,
	projects: readonly Pick<Project, 'id' | 'name'>[]
): string {
	const s = slug.trim().toLowerCase();
	const key = slugify(slug);
	const p =
		projects.find((x) => x.id.toLowerCase() === s) ??
		projects.find((x) => x.name.toLowerCase() === s) ??
		projects.find((x) => slugify(x.id) === key || slugify(x.name) === key);
	return p ? p.id : key || UNSORTED;
}

/** A free-standing topic's name: "time-capsule" → "Time capsule". */
export function topicName(slug: string): string {
	const words = slug.replace(/[-_]+/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : slug;
}

export interface ChatTags {
	/** Each captain's message's tag, by item id. */
	users: Map<string, Tag>;
	/** Each Firstmate text part's sections, by part id. */
	parts: Map<string, TaggedSection[]>;
	/** Each Firstmate turn's own thread (its first section's), for what it shows besides words. */
	turns: Map<string, Tag>;
}

/**
 * The one project of the tasks a text names, and the task when it names just
 * one, or null for none or several projects. `within` keeps to one project's tasks.
 */
function guessed(
	text: string,
	tasks: readonly TaskSummary[],
	within: string | null = null
): { project: string; task: string | null } | null {
	let found: string | null = null;
	let task: string | null = null;
	let several = false;
	for (const t of tasks) {
		if (!t.projectId || t.projectId === 'unassigned') continue;
		if (within && t.projectId !== within) continue;
		if (!mentions(text, t)) continue;
		if (found && found !== t.projectId) return null;
		if (found) several = true;
		found = t.projectId;
		task = t.id;
	}
	return found ? { project: found, task: several ? null : task } : null;
}

/** Whether a reply's quote is of this text: its start, as the quote was cut. */
function quoted(to: ReplyTo, text: string): boolean {
	const line = plain(text);
	const s = to.snippet.endsWith('…') ? to.snippet.slice(0, -1) : to.snippet;
	return !!s && !!line && line.startsWith(s);
}

/** A task as written in a marker or prefix: the fleet's own id when it knows the task. */
const taskId = (written: string | null, tasks: readonly TaskSummary[]) =>
	written ? (tasks.find((t) => t.id.toLowerCase() === written.toLowerCase())?.id ?? written) : null;

/**
 * Tags the conversation's messages (see the module comment). `retags` holds
 * the captain's own choices, by message key (a captain message's item id, a
 * reply section's key).
 */
export function tagChat(
	items: readonly Item[],
	tasks: readonly TaskSummary[],
	projects: readonly Pick<Project, 'id' | 'name'>[],
	retags: Readonly<Record<string, string>> = {}
): ChatTags {
	const users = new Map<string, Tag>();
	const parts = new Map<string, TaggedSection[]>();
	const turns = new Map<string, Tag>();
	const guess = (text: string, within: string | null = null): Tag | null => {
		const g = guessed(text, tasks, within);
		return g ? tagOf(g.project, 'guess', g.task) : null;
	};
	const named = (written: string, source: TagSource): Tag => {
		const { slug, task } = splitThread(written);
		return tagOf(resolveTopic(slug, projects), source, taskId(task, tasks));
	};
	const own = (key: string, tag: Tag): Tag => {
		const mine = retags[key];
		if (!mine) return tag;
		if (mine === UNSORTED) return UNSORTED_TAG;
		return mine === tag.topic ? { ...tag, source: 'you' } : { topic: mine, source: 'you' };
	};
	// What the captain and Firstmate said so far, newest last, for a reply to find what it quotes.
	const said: { who: ReplyTo['who']; text: string; tag: Tag }[] = [];
	const replied = (to: ReplyTo): Tag | null => {
		for (let i = said.length - 1; i >= 0; i--)
			if (said[i].who === to.who && quoted(to, said[i].text)) return said[i].tag;
		return null;
	};
	let lastCaptain: Tag | null = null;
	for (const it of items) {
		if (it.kind === 'user') {
			const { to, body } = parseReply(it.text);
			const sent = parseThread(body);
			const from = to && replied(to);
			const tag = sent.topic
				? named(sent.topic, 'thread')
				: from && from.topic !== UNSORTED
					? tagOf(from.topic, 'reply', from.task)
					: (guess(sent.text) ?? UNSORTED_TAG);
			const final = own(it.id, tag);
			users.set(it.id, final);
			said.push({ who: 'captain', text: parseAttachments(sent.text).text, tag: final });
			lastCaptain = final;
			continue;
		}
		if (it.kind !== 'turn') continue;
		// The thread so far in this turn: a marker's, else the last guess.
		let carry: Tag | null = null;
		const asked = it.trigger === 'captain' && lastCaptain?.source ? lastCaptain : null;
		for (const part of it.parts) {
			if (part.kind !== 'text') continue;
			const sections = parseMarkers(part.text);
			const out: TaggedSection[] = sections.map((s, i) => {
				let tag: Tag;
				if (s.slug) {
					tag = named(s.slug, 'marker');
					// A marker without a task: the one task of its thread the section names, if any.
					if (!tag.task) tag = tagOf(tag.topic, 'marker', guess(s.text, tag.topic)?.task);
				} else if (carry?.source === 'marker') tag = carry;
				else
					tag = guess(s.text) ?? carry ?? (asked && { ...asked, source: 'guess' }) ?? UNSORTED_TAG;
				if (tag.source) carry = tag;
				const intro = i === 0 && !s.slug && sections.length > 1;
				return { key: i ? `${part.id}#${i}` : part.id, text: s.text, tag, intro };
			});
			const final = out.map((s) => ({ ...s, tag: own(s.key, s.tag) }));
			parts.set(part.id, final);
			const lead = final.find((x) => !x.intro);
			if (!turns.has(it.id) && lead) turns.set(it.id, lead.tag);
			if (lead)
				said.push({ who: 'firstmate', text: final.map((x) => x.text).join('\n\n'), tag: lead.tag });
		}
		if (!turns.has(it.id))
			turns.set(it.id, own(`turn:${it.id}`, asked ? { ...asked, source: 'guess' } : UNSORTED_TAG));
	}
	return { users, parts, turns };
}

/** A card's tag: the captain's re-tag, else its project (and task), else Unsorted. */
export function cardTag(
	key: string,
	projectId: string | null | undefined,
	source: 'decision' | 'task',
	retags: Readonly<Record<string, string>> = {},
	task: string | null = null
): Tag {
	const mine = retags[key];
	if (mine === UNSORTED) return UNSORTED_TAG;
	if (mine) return mine === projectId ? tagOf(mine, 'you', task) : { topic: mine, source: 'you' };
	return projectId && projectId !== 'unassigned' ? tagOf(projectId, source, task) : UNSORTED_TAG;
}

/** One row of the Threads list. */
export interface ThreadRow {
	topic: string;
	/** How many messages and cards are in it. */
	count: number;
	/** Open decisions in it. */
	needs: number;
	/** The newest one's time (ms), for ordering. */
	last: number;
}

/**
 * The Threads list from every tagged entry (one per message or card, with all
 * the threads it belongs to): newest first, Unsorted last; `keep` (the thread
 * picked) is listed even when empty.
 */
export function threadRows(
	entries: readonly { topics: readonly string[]; at: string | null; needs?: boolean }[],
	keep: string | null = null
): ThreadRow[] {
	const rows = new Map<string, ThreadRow>();
	for (const e of entries) {
		const at = e.at ? Date.parse(e.at) : NaN;
		for (const topic of new Set(e.topics)) {
			const r = rows.get(topic) ?? { topic, count: 0, needs: 0, last: 0 };
			r.count++;
			if (e.needs) r.needs++;
			if (!Number.isNaN(at)) r.last = Math.max(r.last, at);
			rows.set(topic, r);
		}
	}
	if (keep && !rows.has(keep)) rows.set(keep, { topic: keep, count: 0, needs: 0, last: 0 });
	return [...rows.values()].sort(
		(a, b) =>
			Number(a.topic === UNSORTED) - Number(b.topic === UNSORTED) ||
			b.last - a.last ||
			a.topic.localeCompare(b.topic)
	);
}

/** A run of messages and cards outside the thread being read, folded to one line. */
export interface FoldRun {
	/** The first entry's key, which the line is drawn at and opened by. */
	first: string;
	count: number;
	/** The threads it is about, in order of first appearance. */
	topics: string[];
	from: string | null;
	to: string | null;
}

/** Each entry outside `thread`'s run, by the entry's key, for the folded view of one thread. */
export function foldRuns(
	entries: readonly { key: string; topics: readonly string[]; at: string | null }[],
	thread: string
): Map<string, FoldRun> {
	const out = new Map<string, FoldRun>();
	let run: FoldRun | null = null;
	for (const e of entries) {
		if (e.topics.includes(thread)) {
			run = null;
			continue;
		}
		if (!run) run = { first: e.key, count: 0, topics: [], from: e.at, to: e.at };
		run.count++;
		run.to = e.at ?? run.to;
		for (const t of e.topics) if (!run.topics.includes(t)) run.topics.push(t);
		out.set(e.key, run);
	}
	return out;
}
