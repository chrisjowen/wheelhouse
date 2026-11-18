/**
 * The fleet's documents, as the Documents page, the record and library pages
 * and the link chips everywhere else see them. Three kinds:
 *
 *   record     a task's report (`data/<task>/report.md` in the Firstmate home)
 *              and the files it links, at a permanent address that keeps the
 *              task id (`/records/<project>/<task>`) but is always shown by its
 *              readable title
 *   prototype  a live prototype a task left behind (`data/<task>/prototype/`):
 *              a link to where it runs, never a frozen copy
 *   library    a document promoted into Wheelhouse's own library, a git
 *              repository of folders and tagged Markdown files
 *
 * Shared by the server (server/documents) and the pages, and pure, so it is
 * unit-tested.
 */

/** The shelf for work with no project. */
export const FLEET_SHELF = '_fleet';

export interface DocFileEntry {
	/** Relative to the task's data folder, e.g. `report.md` or `shots/main.png`. */
	path: string;
	bytes: number;
}

export interface DocRecord {
	/** `<project>/<task>`, the permanent identity (`@<mate>` added for a second mate's). */
	key: string;
	project: string;
	task: string;
	mate: string | null;
	/** The report's first heading, else the backlog title. */
	title: string;
	slug: string;
	/** report: a scout's report; ship: a write-up a ship task left. */
	kind: 'report' | 'ship';
	/** When the report was last written. */
	at: string;
	tags: string[];
	/** As the Firstmate home names it: `data/<task>/report.md`. */
	path: string;
	bytes: number;
	/** The live prototypes the task left, by id. */
	prototypes: string[];
	/** The library document promoted from it, by key, when there is one. */
	promotedTo: string | null;
}

/**
 * running: it answers at its last address; stopped: it does not, and its files
 * are kept, so Firstmate can serve them again; gone: its files are no longer there.
 */
export type PrototypeState = 'running' | 'stopped' | 'gone';

export interface DocPrototype {
	/** `<project>/<task>/<name>`. */
	id: string;
	project: string;
	task: string;
	name: string;
	mate: string | null;
	title: string;
	slug: string;
	state: PrototypeState;
	/** Where its files are kept, as the home names it (`data/<task>/prototype`). */
	source: string;
	/** Where it last ran, when a status line said. */
	url: string | null;
	at: string;
	/** Its screenshots, as paths the file reader serves. */
	shots: { name: string; path: string }[];
	/** The task's record, when it has one. */
	record: string | null;
}

export type LibraryStatus = 'current' | 'draft' | 'superseded';
export const LIBRARY_STATUSES: readonly LibraryStatus[] = ['current', 'draft', 'superseded'];

export interface LibraryDoc {
	/** `<shelf>/<folder>/<slug>`, its file without `.md`. */
	key: string;
	shelf: string;
	folder: string;
	slug: string;
	title: string;
	status: LibraryStatus;
	tags: string[];
	/** The record it was promoted from (`<project>/<task>`), else null. */
	from: string | null;
	updated: string;
	commits: number;
}

export interface DocumentsIndex {
	records: DocRecord[];
	prototypes: DocPrototype[];
	library: LibraryDoc[];
	/** Why the library cannot be used here, when it cannot. */
	libraryProblem: string | null;
	generatedAt: string;
}

const SLUG = /^[a-z0-9_][a-z0-9._-]{0,127}$/;
const TASK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A task id Firstmate could have made: no slashes, dots-only or `..`. */
export const isTaskId = (s: string) => TASK.test(s) && !/^\.+$/.test(s);
/** A library shelf, folder or slug: lower case, digits, `.`, `_` and `-`. */
export const isSlug = (s: string) => SLUG.test(s) && !/^\.+$/.test(s);
/** A project name as the backlog writes it, or the fleet shelf. */
export const isProject = (s: string) => s === FLEET_SHELF || isTaskId(s);

/** A readable slug for a title: `Fleet document store: spec` → `fleet-document-store-spec`. */
export function slugify(title: string, fallback = 'document'): string {
	const s = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');
	return s || fallback;
}

/** A tag as the search box writes it: lower case, spaces as dashes, no leading `#`. */
export function tagOf(raw: string): string {
	return raw
		.trim()
		.replace(/^#+/, '')
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}._-]/gu, '');
}

export const recordHref = (key: string) =>
	`/records/${key.split('/').map(encodeURIComponent).join('/')}`;
export const prototypeHref = (id: string) =>
	`/prototypes/${id.split('/').map(encodeURIComponent).join('/')}`;
export const libraryHref = (key: string) =>
	`/library/${key.split('/').map(encodeURIComponent).join('/')}`;
/** The short form for chat and status lines; it redirects to the record. */
export const shortHref = (task: string) => `/r/${encodeURIComponent(task)}`;

/** The project a shelf names, in words. */
export const shelfName = (shelf: string) => (shelf === FLEET_SHELF ? 'Fleet' : shelf);

/** A record's key split up: `<project>/<task>[@<mate>]`. */
export function parseRecordKey(
	key: string
): { project: string; task: string; mate: string | null } | null {
	const m = /^([^/]+)\/([^/@]+)(?:@([^/@]+))?$/.exec(key);
	if (!m || !isProject(m[1]) || !isTaskId(m[2]) || (m[3] && !isTaskId(m[3]))) return null;
	return { project: m[1], task: m[2], mate: m[3] ?? null };
}

/**
 * A mention of a document in Firstmate's or a worker's words: a report path
 * (`data/<task>/report.md`, however the home is written before it), a record
 * (`records/<project>/<task>`, `/r/<task>`, `record=<project>/<task>`), a
 * library document (`library/<shelf>/<folder>/<slug>`) or a prototype
 * (`prototypes/<project>/<task>/<name>`, `prototype=…`).
 */
export type DocRef =
	| { kind: 'task'; task: string }
	| { kind: 'record'; key: string }
	| { kind: 'library'; key: string }
	| { kind: 'prototype'; id: string };

const ID = String.raw`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`;
const LIB = String.raw`[a-z0-9_][a-z0-9._-]{0,127}`;
const REF = new RegExp(
	[
		String.raw`(?:^|[\s(\[<"'\`/])data\/(${ID})\/report\.md\b`,
		String.raw`(?:^|[\s(\[<"'\`=])\/?records\/(${ID})\/(${ID})(?:@(${ID}))?(?![\w/.-])`,
		String.raw`record=(${ID})\/(${ID})(?:@(${ID}))?`,
		String.raw`(?:^|[\s(\[<"'\`])\/r\/(${ID})(?![\w/.-])`,
		String.raw`(?:^|[\s(\[<"'\`=])\/?library\/(${LIB})\/(${LIB})\/(${LIB})(?:\.md)?(?![\w/-])`,
		String.raw`(?:^|[\s(\[<"'\`=])\/?prototypes?\/(${ID})\/(${ID})\/(${ID})(?![\w/-])`
	].join('|'),
	'gm'
);

/** The documents a piece of text mentions, first mention first, each once. */
export function findDocRefs(text: string): DocRef[] {
	const out: DocRef[] = [];
	const seen = new Set<string>();
	const add = (r: DocRef) => {
		const k = JSON.stringify(r);
		if (seen.has(k)) return;
		seen.add(k);
		out.push(r);
	};
	for (const m of text.matchAll(REF)) {
		const mate = (s: string | undefined) => (s ? `@${s}` : '');
		if (m[1] && isTaskId(m[1])) add({ kind: 'task', task: m[1] });
		else if (m[2]) add({ kind: 'record', key: `${m[2]}/${m[3]}${mate(m[4])}` });
		else if (m[5]) add({ kind: 'record', key: `${m[5]}/${m[6]}${mate(m[7])}` });
		else if (m[8] && isTaskId(m[8])) add({ kind: 'task', task: m[8] });
		else if (m[9]) add({ kind: 'library', key: `${m[9]}/${m[10]}/${m[11].replace(/\.md$/, '')}` });
		else if (m[12]) add({ kind: 'prototype', id: `${m[12]}/${m[13]}/${m[14]}` });
	}
	return out;
}

/** What a mention points at in the index, when it is there. */
export type ResolvedDoc =
	| { kind: 'record'; record: DocRecord }
	| { kind: 'library'; doc: LibraryDoc }
	| { kind: 'prototype'; prototype: DocPrototype };

export function resolveDocRef(index: DocumentsIndex, ref: DocRef): ResolvedDoc | null {
	if (ref.kind === 'task') {
		const record = recordForTask(index, ref.task);
		return record ? { kind: 'record', record } : null;
	}
	if (ref.kind === 'record') {
		const record = index.records.find((r) => r.key === ref.key);
		return record ? { kind: 'record', record } : null;
	}
	if (ref.kind === 'library') {
		const doc = index.library.find((d) => d.key === ref.key);
		return doc ? { kind: 'library', doc } : null;
	}
	const prototype = index.prototypes.find((p) => p.id === ref.id);
	return prototype ? { kind: 'prototype', prototype } : null;
}

/** A task's record, by its task id (a second mate's as `<task>@<mate>`). */
export function recordForTask(index: Pick<DocumentsIndex, 'records'>, id: string) {
	const [task, mate = null] = id.split('@');
	return index.records.find((r) => r.task === task && r.mate === mate) ?? null;
}

/** A task's prototypes, by its task id. */
export function prototypesForTask(index: Pick<DocumentsIndex, 'prototypes'>, id: string) {
	const [task, mate = null] = id.split('@');
	return index.prototypes.filter((p) => p.task === task && p.mate === mate);
}

/** "18 Nov · 09:40" in the captain's own time. */
export function docDate(iso: string, withTime = true): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	return withTime
		? `${day} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
		: day;
}

export const STATE_WORDS: Record<PrototypeState, string> = {
	running: 'running',
	stopped: 'stopped · can relaunch',
	gone: 'files gone'
};

/**
 * A report's links into its task's prototype folder (`prototype/index.html`),
 * pointed at the prototype's own page instead: a record never holds a copy
 * of a running app. Pure.
 */
export function linkPrototype(md: string, id: string | undefined): string {
	if (!id) return md;
	const to = prototypeHref(id);
	return md
		.replace(/(\]\(\s*<?)(?:\.\/)?prototype(?:\/[^)\s>]*)?(?=[>)\s])/g, `$1${to}`)
		.replace(/((?:src|href)\s*=\s*["'])(?:\.\/)?prototype(?:\/[^"']*)?(?=["'])/gi, `$1${to}`);
}
