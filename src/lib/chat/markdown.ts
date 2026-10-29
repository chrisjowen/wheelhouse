import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { docHref, findDocPaths, linkedDocPath, resolveInDoc, splitDocPaths } from '$lib/docpath';

const cache = new Map<string, string>();
const MAX_CACHE = 500;

/**
 * Firstmate's Markdown as safe HTML: GitHub-flavoured Markdown, sanitised with
 * DOMPurify (the browser's DOM), links opening in a new tab. With `docLinks`,
 * Markdown file paths in the text become links to the reader (see docpath.ts).
 * Cached, because the chat re-renders as the transcript grows.
 */
export function markdown(text: string, { docLinks = false }: { docLinks?: boolean } = {}): string {
	const key = `${docLinks ? 'd' : '-'}${text}`;
	let html = cache.get(key);
	if (html === undefined) {
		html = DOMPurify.sanitize(
			marked.parse(text, { async: false, gfm: true, breaks: false }) as string
		);
		if (docLinks) html = linkDocPaths(html);
		html = html.replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
		if (cache.size > MAX_CACHE) cache.clear();
		cache.set(key, html);
	}
	return html;
}

function fragment(html: string): HTMLTemplateElement {
	const t = document.createElement('template');
	t.innerHTML = html;
	return t;
}

/**
 * Sanitised HTML with each Markdown file path linked to the reader: paths in
 * the text, an inline code span that is just a path, and Markdown links to a
 * file. Nothing inside a link or a code block is touched.
 */
export function linkDocPaths(html: string): string {
	const t = fragment(html);
	const root = t.content;
	for (const a of root.querySelectorAll('a[href]')) {
		const p = linkedDocPath(a.getAttribute('href') ?? '');
		if (p) a.setAttribute('href', docHref(p));
	}
	for (const code of root.querySelectorAll('code')) {
		if (code.closest('pre, a')) continue;
		const text = (code.textContent ?? '').trim();
		const [m, ...more] = findDocPaths(text);
		if (!m || more.length || m.start !== 0 || m.end !== text.length) continue;
		const a = document.createElement('a');
		a.setAttribute('href', docHref(m.path));
		code.replaceWith(a);
		a.append(code);
	}
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const texts: Text[] = [];
	while (walker.nextNode()) {
		const n = walker.currentNode as Text;
		if (!n.parentElement?.closest('a, pre, code')) texts.push(n);
	}
	for (const n of texts) {
		const runs = splitDocPaths(n.data);
		if (!runs.some((r) => r.path)) continue;
		const out = document.createDocumentFragment();
		for (const r of runs) {
			if (!r.path) {
				out.append(r.text);
				continue;
			}
			const a = document.createElement('a');
			a.setAttribute('href', docHref(r.path));
			a.textContent = r.text;
			out.append(a);
		}
		n.replaceWith(out);
	}
	return t.innerHTML;
}

/** What a document may contain once rendered; anything else is unwrapped to its text. */
const DOC_TAGS = new Set(
	'p h1 h2 h3 h4 h5 h6 ul ol li a img code pre em strong b i u s del ins mark sup sub kbd small br hr blockquote table thead tbody tfoot tr th td caption details summary dl dt dd figure figcaption span div abbr input'.split(
		' '
	)
);
/** Removed with everything inside them. */
const DOC_DROP = new Set(
	'script style iframe frame frameset object embed noscript template svg math form link meta base title textarea select button video audio source track canvas'.split(
		' '
	)
);
const DOC_ATTRS = new Set([
	'href',
	'src',
	'alt',
	'title',
	'colspan',
	'rowspan',
	'align',
	'start',
	'type',
	'checked',
	'disabled',
	'open',
	'class'
]);

/** Keep only plain document markup: known tags, harmless attributes, read-only task boxes. */
function allowlist(root: DocumentFragment): void {
	for (const el of [...root.querySelectorAll('*')]) {
		const tag = el.tagName.toLowerCase();
		if (DOC_DROP.has(tag)) {
			el.remove();
			continue;
		}
		if (!DOC_TAGS.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
			el.replaceWith(...el.childNodes);
			continue;
		}
		for (const name of el.getAttributeNames()) {
			const misplaced = (name === 'href' && tag !== 'a') || (name === 'src' && tag !== 'img');
			if (!DOC_ATTRS.has(name) || misplaced) el.removeAttribute(name);
		}
		const cls = el.getAttribute('class');
		if (cls !== null && !(tag === 'code' && /^language-[\w+-]+$/.test(cls))) {
			el.removeAttribute('class');
		}
		if (tag === 'input') el.setAttribute('disabled', '');
	}
}

/**
 * A document for the reader as safe HTML. Stricter than the chat: after
 * DOMPurify, only plain document markup is kept (no styles, forms, frames or
 * event handlers), and every link and image is resolved against the
 * document's own file (`file`, its real path): Markdown to the reader, other
 * files to /api/files (images only), both of which only read inside the allowed folders.
 * Web links open in a new tab; any other scheme is dropped.
 */
export function renderDoc(text: string, file: string): string {
	const t = fragment(
		DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: false }) as string)
	);
	allowlist(t.content);
	for (const el of t.content.querySelectorAll('[href]')) {
		const to = resolveInDoc(el.getAttribute('href') ?? '', file, 'a');
		if (to === null) {
			el.removeAttribute('href');
			continue;
		}
		el.setAttribute('href', to);
		if (/^(?:https?|mailto):/i.test(to)) {
			el.setAttribute('target', '_blank');
			el.setAttribute('rel', 'noreferrer');
		}
	}
	for (const el of t.content.querySelectorAll('[src]')) {
		const to = resolveInDoc(el.getAttribute('src') ?? '', file, 'img');
		if (to === null) el.removeAttribute('src');
		else el.setAttribute('src', to);
	}
	return t.innerHTML;
}
