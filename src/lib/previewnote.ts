/**
 * Where the crew says a piece of work can be seen: a live preview, and a
 * review board (a Lavish board session), read from a worker's status line or
 * from a Firstmate reply. Pure, so the server (status logs) and the page (the
 * chat) read them the same way, and unit-tested.
 *
 * A status line names its preview with `preview <url>` (the convention,
 * which may name any address), or announces one with the word "preview" or
 * "prototype … ready" (`Preview ready for approval: … - http://127.0.0.1:4471/`,
 * `direct preview http://…`), naming an address on this machine (127.0.0.1
 * or localhost): the one after the word "preview" when there are several. A board is an address
 * on this machine whose path is a board session (`/session/<id>`, as Lavish
 * serves them) or that directly follows the word "board" (`Lavish board:
 * http://127.0.0.1:4387/…`). Any other address in a line (tests, redirects,
 * API calls) is neither, and so is one inside Markdown code. docs/guide.md
 * says what triggers each.
 */
import { PREVIEW_HOSTS } from './preview';
import { extractUrls } from './urls';

export interface PreviewNote {
	/** The live preview the line names, or null. */
	preview: string | null;
	/** The review board the line names, or null. */
	board: string | null;
}

/** The convention: a line that starts with `preview <url>` (any address). */
const CONVENTION = /^\s*preview:?\s+(https?:\/\/\S+)/i;
const BOARD_PATH = /^\/session\/[A-Za-z0-9_-]+\/?$/;
/** A line that announces a preview: "preview …", "prototypes ready: …". */
const ANNOUNCES = /\bpreview\b|\bprototypes?\b[^\n.;]{0,24}\bready\b/i;
/** How far before an address its label may stand: "direct preview http…", "the preview at http…". */
const PREVIEW_LABEL = /\bpreview\b[^\n.;]{0,24}$/i;
/** A board's label stands right before its address: "board http…", "Lavish board: http…", "board at http…". */
const BOARD_LABEL = /\bboard\b(?:\s+(?:is\s+)?(?:up\s+)?(?:at|on))?\s*[:\-–—]?\s*$/i;

/** Whether `raw` is an http(s) address on this machine with no credentials. */
export function isLoopback(raw: string): boolean {
	const u = URL.parse(raw);
	return (
		!!u &&
		(u.protocol === 'http:' || u.protocol === 'https:') &&
		PREVIEW_HOSTS.has(u.hostname.toLowerCase()) &&
		!u.username &&
		!u.password
	);
}

/** Whether `raw` is a review board's address: a board session's path on this machine. */
export function isBoard(raw: string): boolean {
	return isLoopback(raw) && BOARD_PATH.test(URL.parse(raw)!.pathname);
}

/** Addresses on this machine in `text`, each with the words just before it. */
function loopbackIn(text: string): { url: string; before: string }[] {
	const out: { url: string; before: string }[] = [];
	let from = 0;
	for (const url of extractUrls(text)) {
		const at = text.indexOf(url, from);
		if (at < 0) continue;
		from = at + url.length;
		if (isLoopback(url)) out.push({ url, before: text.slice(Math.max(0, at - 40), at) });
	}
	return out;
}

/** The preview and board a status line names (see the module comment). */
export function previewNoteOf(text: string): PreviewNote {
	const plain = withoutCode(text);
	const found = loopbackIn(plain);
	const board =
		found.find((f) => isBoard(f.url))?.url ??
		found.find((f) => BOARD_LABEL.test(f.before))?.url ??
		null;
	const convention = CONVENTION.exec(plain)?.[1]?.replace(/[),.;*]+$/, '') ?? null;
	const rest = found.filter((f) => f.url !== board);
	const announced = ANNOUNCES.test(plain)
		? (rest.find((f) => PREVIEW_LABEL.test(f.before))?.url ?? rest[0]?.url ?? null)
		: null;
	return { preview: convention ?? announced, board };
}

/** `text` without Markdown code (fenced blocks and inline spans), whose addresses are not links. */
function withoutCode(text: string): string {
	return text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/**
 * The addresses on this machine a Firstmate reply links, in order, each once:
 * every one outside Markdown code, except Wheelhouse's own pages (on
 * `ownPort`, when Wheelhouse is opened on this machine).
 */
export function linkedPreviews(text: string, ownPort: string | null = null): string[] {
	const out: string[] = [];
	for (const url of extractUrls(withoutCode(text))) {
		if (!isLoopback(url) || out.includes(url)) continue;
		const u = URL.parse(url)!;
		if (ownPort && (u.port || (u.protocol === 'https:' ? '443' : '80')) === ownPort) continue;
		out.push(url);
	}
	return out;
}

/** An address without its trailing slashes, query and fragment: what two mentions of one page share. */
export function pageOf(raw: string): string {
	const u = URL.parse(raw);
	return u ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : raw;
}
