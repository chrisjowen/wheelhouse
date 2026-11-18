/**
 * The Documents page's one search box: plain words, `#tags` and `key:value`
 * filters, instead of a row of drop-downs. Words match titles and metadata
 * (never the text of a document: full-text search comes later). `#report`,
 * `#ship` and `#prototype` name a record's kind; any other `#word` is a tag.
 * Filters on the same key are alternatives (OR); filters on different keys
 * must all hold (AND). Pure, so it is unit-tested.
 */
import {
	FLEET_SHELF,
	tagOf,
	type DocPrototype,
	type DocRecord,
	type LibraryDoc
} from './documents';

export type SearchTab = 'records' | 'library';

export interface Token {
	k: string;
	v: string;
}

export interface Query {
	toks: Token[];
	words: string[];
}

export const KINDS = ['report', 'ship', 'prototype'] as const;
export const STATES = ['running', 'stopped', 'gone'] as const;
/** How far back `since:` reaches, in days. */
export const SINCE: Record<string, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

/** The filters each tab understands, with the hint autocomplete shows for them. */
export const KEYS: Record<SearchTab, Record<string, string>> = {
	records: {
		project: 'which project',
		kind: 'or #report, #ship, #prototype',
		state: 'a prototype’s state',
		mate: 'this home (main) or a second mate',
		since: 'today, 7d, 30d or 90d',
		tag: 'or type #'
	},
	library: {
		project: 'which shelf',
		folder: 'shelf/folder',
		status: 'current, draft or superseded',
		since: 'today, 7d, 30d or 90d',
		tag: 'or type #'
	}
};

/** What a filter is matched against, and the fields words are searched in. */
export interface Facts {
	project: string;
	kind?: string;
	state?: string;
	mate?: string;
	folder?: string;
	status?: string;
	tags: string[];
	/** When it was written (ISO). */
	when: string;
	/** Searched by plain words, in order; the first is the title. */
	fields: [label: string, value: string][];
}

/** A `#tag` or `key:value` as it is written in the box. */
export const tokText = (t: Token) =>
	t.k === 'tag' || t.k === 'kind' ? `#${t.v}` : `${t.k}:${t.v}`;

/** The words, tags and filters in what was typed. Keys the tab does not know stay words. */
export function parseQuery(text: string, tab: SearchTab): Query {
	const toks: Token[] = [];
	const words: string[] = [];
	for (const w of text.split(/\s+/).filter(Boolean)) {
		let m: RegExpExecArray | null;
		if (/^#+$/.test(w)) continue;
		if ((m = /^#(.+)$/.exec(w))) {
			const v = tagOf(m[1]);
			if (!v) continue;
			toks.push(
				tab === 'records' && (KINDS as readonly string[]).includes(v)
					? { k: 'kind', v }
					: { k: 'tag', v }
			);
		} else if ((m = /^([a-z]+):(.+)$/i.exec(w)) && KEYS[tab][m[1].toLowerCase()]) {
			const k = m[1].toLowerCase();
			toks.push({ k, v: k === 'tag' ? tagOf(m[2]) : m[2].toLowerCase() });
		} else words.push(w);
	}
	return { toks, words };
}

/** The query written back as text, for the address bar. */
export function queryText(q: Query): string {
	return [...q.toks.map(tokText), ...q.words].join(' ');
}

function tokMatches(f: Facts, t: Token, now: number): boolean {
	if (t.k === 'since') {
		const days = SINCE[t.v];
		const at = Date.parse(f.when);
		return !!days && !Number.isNaN(at) && now - at <= days * 86_400_000;
	}
	if (t.k === 'tag') return f.tags.includes(t.v);
	if (t.k === 'folder') return f.folder === t.v || f.folder?.startsWith(`${t.v}/`) === true;
	const v = (f as unknown as Record<string, unknown>)[t.k];
	return typeof v === 'string' && v.toLowerCase() === t.v;
}

/** Same key: any of them. Different keys: all of them. */
export function filtersMatch(f: Facts, toks: Token[], now = Date.now()): boolean {
	const by = new Map<string, Token[]>();
	for (const t of toks) by.set(t.k, [...(by.get(t.k) ?? []), t]);
	return [...by.values()].every((ts) => ts.some((t) => tokMatches(f, t, now)));
}

/**
 * Whether every word is in some field, and, when the title does not hold them
 * all, which field matched (so a row can say why it is there).
 */
export function wordsMatch(f: Facts, words: string[]): { ok: boolean; why: string | null } {
	if (!words.length) return { ok: true, why: null };
	let why: [string, string] | null = null;
	for (const w of words.map((x) => x.toLowerCase())) {
		const hit = f.fields.find(([, v]) => v.toLowerCase().includes(w));
		if (!hit) return { ok: false, why: null };
		if (hit !== f.fields[0] && !why) why = hit;
	}
	const inTitle = words.every((w) => f.fields[0]?.[1].toLowerCase().includes(w.toLowerCase()));
	return { ok: true, why: why && !inTitle ? `${why[0]}: ${why[1]}` : null };
}

/** The items a query keeps, each with why it matched when that is not its title. */
export function search<T>(
	items: T[],
	facts: (item: T) => Facts,
	q: Query,
	now = Date.now()
): { item: T; why: string | null }[] {
	const out: { item: T; why: string | null }[] = [];
	for (const item of items) {
		const f = facts(item);
		if (!filtersMatch(f, q.toks, now)) continue;
		const m = wordsMatch(f, q.words);
		if (m.ok) out.push({ item, why: m.why });
	}
	return out;
}

/** The values each filter can take among these items, most common first. */
export function filterValues(tab: SearchTab, all: Facts[]): Record<string, string[]> {
	const count = (vals: (string | undefined)[]) => {
		const c = new Map<string, number>();
		for (const v of vals) if (v) c.set(v, (c.get(v) ?? 0) + 1);
		return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
	};
	const base = {
		project: count(all.map((f) => f.project)),
		since: Object.keys(SINCE),
		tag: count(all.flatMap((f) => f.tags))
	};
	return tab === 'records'
		? {
				...base,
				kind: [...KINDS],
				state: [...STATES],
				mate: count(all.map((f) => f.mate))
			}
		: {
				...base,
				folder: count(all.map((f) => f.folder)),
				status: ['current', 'draft', 'superseded']
			};
}

/** A typed filter names a value that exists (so a half-typed `mate:k` does not blank the list). */
export function knownToken(t: Token, values: Record<string, string[]>): boolean {
	return !!values[t.k]?.includes(t.v);
}

export interface Suggestion {
	/** What the row shows, e.g. `#prototype` or `project:docket`. */
	label: string;
	/** A filter to add, or, for a bare key, the text to type next (`project:`). */
	tok: Token | null;
	insert: string | null;
	note: string;
	/** How many items it would leave, with the filters already chosen. */
	count: number | null;
}

/** The word being typed at the end of the box. */
export const currentWord = (text: string) => /(\S*)$/.exec(text)?.[1] ?? '';

/** What autocomplete offers for the word being typed, at most eight. */
export function suggestions(
	tab: SearchTab,
	word: string,
	all: Facts[],
	chosen: Token[],
	now = Date.now()
): Suggestion[] {
	const values = filterValues(tab, all);
	const keys = KEYS[tab];
	const out: Suggestion[] = [];
	const count = (tok: Token) => all.filter((f) => filtersMatch(f, [...chosen, tok], now)).length;
	const value = (k: string, v: string, note: string) => {
		const tok = { k, v };
		if (!chosen.some((c) => c.k === k && c.v === v))
			out.push({ label: tokText(tok), tok, insert: null, note, count: count(tok) });
	};
	const lower = word.toLowerCase();
	if (lower.startsWith('#')) {
		const pre = tagOf(lower.slice(1));
		if (tab === 'records') for (const v of KINDS) if (v.startsWith(pre)) value('kind', v, 'kind');
		for (const v of values.tag) if (v.startsWith(pre)) value('tag', v, 'tag');
	} else if (/^[a-z]+:/.test(lower) && keys[lower.split(':')[0]]) {
		const k = lower.split(':')[0];
		const pre = lower.slice(k.length + 1);
		for (const v of values[k] ?? []) if (v.startsWith(pre)) value(k, v, keys[k]);
	} else {
		if (!lower)
			out.push({
				label: '#',
				tok: null,
				insert: '#',
				note: tab === 'records' ? 'a tag, or #report #ship #prototype' : 'a tag',
				count: null
			});
		for (const [k, hint] of Object.entries(keys))
			if (k !== 'tag' && k.startsWith(lower))
				out.push({ label: `${k}:`, tok: null, insert: `${k}:`, note: hint, count: null });
		if (lower.length >= 2)
			for (const [k, vs] of Object.entries(values))
				for (const v of vs) if (v.startsWith(lower)) value(k, v, k === 'tag' ? 'tag' : k);
	}
	const seen = new Set<string>();
	return out.filter((s) => !seen.has(s.label) && !!seen.add(s.label)).slice(0, 8);
}

// ---------------------------------------------------------------- facts of each kind

export function recordFacts(r: DocRecord): Facts {
	return {
		project: r.project,
		kind: r.kind,
		state: '',
		mate: r.mate ?? 'main',
		tags: r.tags,
		when: r.at,
		fields: [
			['title', r.title],
			['slug', r.slug],
			['project', r.project],
			['task', r.task],
			['mate', r.mate ?? ''],
			['tag', r.tags.join(' · ')]
		]
	};
}

export function prototypeFacts(p: DocPrototype, record: DocRecord | null): Facts {
	return {
		project: p.project,
		kind: 'prototype',
		state: p.state,
		mate: p.mate ?? 'main',
		tags: record?.tags ?? [],
		when: p.at,
		fields: [
			['title', p.title],
			['slug', p.slug],
			['project', p.project],
			['task', p.task],
			['mate', p.mate ?? ''],
			['state', p.state]
		]
	};
}

export function libraryFacts(d: LibraryDoc): Facts {
	return {
		project: d.shelf,
		folder: `${d.shelf}/${d.folder}`,
		status: d.status,
		tags: d.tags,
		when: d.updated,
		fields: [
			['title', d.title],
			['slug', d.slug],
			['shelf', d.shelf === FLEET_SHELF ? 'fleet' : d.shelf],
			['folder', d.folder],
			['tag', d.tags.join(' · ')],
			['status', d.status],
			['from', d.from ?? '']
		]
	};
}

// ---------------------------------------------------------------- grouping for the lists

/** Items grouped by a key, the groups in key order, each keeping its items' order. */
export function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
	const g = new Map<string, T[]>();
	for (const i of items) g.set(key(i), [...(g.get(key(i)) ?? []), i]);
	return [...g].sort((a, b) => a[0].localeCompare(b[0]));
}

/** How often each value appears, most common first. */
export function countBy(values: string[]): [string, number][] {
	const c = new Map<string, number>();
	for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
	return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
