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
 * which becomes a thread of its own. The captain's messages carry the thread
 * they were sent in as a leading `[project <slug>]` (after a reply's quote). Without either, the tag
 * is a guess: the one project of the tasks a message names (its id, pull
 * request or preview address), else, for Firstmate's answer to the captain,
 * the thread of the message it answers; else the message is Unsorted. A
 * captain's re-tag, kept in this browser, overrides everything. Pure, so it
 * is unit-tested.
 */
import type { Project, TaskSummary } from '../types';
import type { Item } from './fold';
import { mentions } from './previews';
import { parseReply } from './reply';

/** The thread key of messages about no project. */
export const UNSORTED = 'unsorted';

/** Where a tag came from, as the tag says it. */
export type TagSource = 'marker' | 'decision' | 'task' | 'thread' | 'you' | 'guess';

export interface Tag {
	/** A project id, a topic slug, or UNSORTED. */
	topic: string;
	/** null for Unsorted. */
	source: TagSource | null;
}

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

/** A captain's message with its thread named first, as Firstmate receives it. */
export function withThread(text: string, topic: string | null): string {
	return topic && topic !== UNSORTED ? `[project ${topic}] ${text}` : text;
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

/** The one project of the tasks a text names, or null for none or several. */
function guessed(text: string, tasks: readonly TaskSummary[]): string | null {
	let found: string | null = null;
	for (const t of tasks) {
		if (!t.projectId || t.projectId === 'unassigned' || t.projectId === found) continue;
		if (!mentions(text, t)) continue;
		if (found) return null;
		found = t.projectId;
	}
	return found;
}

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
	const guess = (text: string): Tag | null => {
		const p = guessed(text, tasks);
		return p ? { topic: p, source: 'guess' } : null;
	};
	const own = (key: string, tag: Tag): Tag =>
		retags[key] ? { topic: retags[key], source: retags[key] === UNSORTED ? null : 'you' } : tag;
	let lastCaptain: Tag | null = null;
	for (const it of items) {
		if (it.kind === 'user') {
			const sent = parseThread(parseReply(it.text).body);
			const tag = sent.topic
				? { topic: resolveTopic(sent.topic, projects), source: 'thread' as const }
				: (guess(sent.text) ?? UNSORTED_TAG);
			const final = own(it.id, tag);
			users.set(it.id, final);
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
				if (s.slug) tag = { topic: resolveTopic(s.slug, projects), source: 'marker' };
				else if (carry?.source === 'marker') tag = carry;
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
		}
		if (!turns.has(it.id))
			turns.set(it.id, own(`turn:${it.id}`, asked ? { ...asked, source: 'guess' } : UNSORTED_TAG));
	}
	return { users, parts, turns };
}

/** A card's tag: the captain's re-tag, else its project, else Unsorted. */
export function cardTag(
	key: string,
	projectId: string | null | undefined,
	source: 'decision' | 'task',
	retags: Readonly<Record<string, string>> = {}
): Tag {
	const mine = retags[key];
	if (mine) return { topic: mine, source: mine === UNSORTED ? null : 'you' };
	return projectId && projectId !== 'unassigned' ? { topic: projectId, source } : UNSORTED_TAG;
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
