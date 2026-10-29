/**
 * Markdown files named in Firstmate's and its workers' text (chat replies,
 * decision cards, status lines), and the links to Wheelhouse's reader for them.
 * A relative path such as `data/<id>/report.md` is read against the Firstmate
 * home; whether a path may be read at all is the server's call
 * (server/files/docfile.ts). Pure, so it is unit-tested.
 */

/** The extensions the reader shows. */
export const DOC_EXT = /\.(?:md|markdown|mdx)$/i;

/** One path segment: no whitespace, quotes, brackets, separators, `=`, `~` or URL scheme colons. */
const SEG = String.raw`[^\s/\\'"\`<>()[\]{}|;,*:=~]+`;
/** A segment that ends a Markdown file name, followed by nothing that would extend it. */
const LAST = String.raw`[^\s/\\'"\`<>()[\]{}|;,*:=~]*\.(?:md|markdown|mdx)(?![\w/-]|\.\w)`;
/**
 * Absolute paths may contain spaces before a slash-led segment (a Firstmate
 * home such as `/Users/me/Dev/spikes /firstmate`), as in plain.ts. Relative
 * paths need at least one folder, so a bare `README.md` is not taken for a
 * file in the Firstmate home.
 */
const ABS = String.raw`(?:\/${SEG})*(?:(?<!\.(?:md|markdown|mdx))\s+(?:\/${SEG})+)*\/${LAST}`;
const REL = String.raw`(?:${SEG}\/)+${LAST}`;
/** Not inside a word, a URL or a longer path. */
const PATH = new RegExp(String.raw`(?<![\w./~:@\\-])(?:${ABS}|${REL})`, 'g');

export interface DocMention {
	start: number;
	end: number;
	path: string;
}

/** The Markdown file paths in plain text, in order. */
export function findDocPaths(text: string): DocMention[] {
	return [...text.matchAll(PATH)].map((m) => ({
		start: m.index,
		end: m.index + m[0].length,
		path: m[0]
	}));
}

/** Text as runs, each either plain or a Markdown file path. */
export function splitDocPaths(text: string): { text: string; path: string | null }[] {
	const out: { text: string; path: string | null }[] = [];
	let at = 0;
	for (const m of findDocPaths(text)) {
		if (m.start > at) out.push({ text: text.slice(at, m.start), path: null });
		out.push({ text: m.path, path: m.path });
		at = m.end;
	}
	if (at < text.length) out.push({ text: text.slice(at), path: null });
	return out;
}

/** The reader's page for a Markdown file. */
export function docHref(p: string): string {
	return `/files?path=${encodeURIComponent(p)}`;
}

/** An image inside the allowed folders, served as it is. */
export function fileHref(p: string): string {
	return `/api/files?path=${encodeURIComponent(p)}`;
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** The path part of a link's target, decoded, with its #fragment; null for a URL. */
function localTarget(href: string): { path: string; hash: string } | null {
	const t = href.trim();
	if (!t || t.startsWith('#') || t.startsWith('//') || SCHEME.test(t)) return null;
	const m = /^([^?#]*)(?:\?[^#]*)?(#.*)?$/.exec(t);
	if (!m) return null;
	let p = m[1];
	try {
		p = decodeURIComponent(p);
	} catch {
		// keep it as written
	}
	return { path: p, hash: m[2] ?? '' };
}

/**
 * A Markdown link's target in a chat message, when it names a Markdown file
 * rather than a web page: `[report](data/x/report.md)`.
 */
export function linkedDocPath(href: string): string | null {
	const t = localTarget(href);
	return t && DOC_EXT.test(t.path) ? t.path : null;
}

/** A path with `.` and `..` segments resolved; `..` never climbs above the root. */
export function normalizePath(p: string): string {
	const out: string[] = [];
	for (const s of p.split('/')) {
		if (!s || s === '.') continue;
		if (s === '..') out.pop();
		else out.push(s);
	}
	return `${p.startsWith('/') ? '/' : ''}${out.join('/')}`;
}

/**
 * Where a link (`a`) or an image (`img`) inside a document goes: fragments and
 * web links as they are; a relative or absolute file path resolved against the
 * document's own folder, to the reader for Markdown and to the file endpoint
 * for anything else; null (drop it) for any other scheme. The server still
 * decides whether the target may be read.
 */
export function resolveInDoc(href: string, docFile: string, kind: 'a' | 'img'): string | null {
	const t = href.trim();
	if (!t) return null;
	if (t.startsWith('#')) return kind === 'a' ? t : null;
	if (t.startsWith('//')) return null;
	if (SCHEME.test(t)) {
		if (/^https?:/i.test(t)) return t;
		if (kind === 'a' && /^mailto:/i.test(t)) return t;
		if (kind === 'img' && /^data:image\/(?:png|jpe?g|gif|webp);/i.test(t)) return t;
		return null;
	}
	const target = localTarget(t);
	if (!target) return null;
	if (!target.path) return kind === 'a' && target.hash ? target.hash : null;
	const dir = docFile.slice(0, docFile.lastIndexOf('/') + 1) || '/';
	const p = normalizePath(target.path.startsWith('/') ? target.path : `${dir}${target.path}`);
	if (kind === 'a' && DOC_EXT.test(p)) return `${docHref(p)}${target.hash}`;
	return fileHref(p);
}
