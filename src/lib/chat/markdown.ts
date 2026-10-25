import DOMPurify from 'dompurify';
import { marked } from 'marked';

const cache = new Map<string, string>();
const MAX_CACHE = 500;

/**
 * Firstmate's Markdown as safe HTML: GitHub-flavoured Markdown, sanitised with
 * DOMPurify (the browser's DOM), links opening in a new tab. Cached, because
 * the chat re-renders as the transcript grows.
 */
export function markdown(text: string): string {
	let html = cache.get(text);
	if (html === undefined) {
		html = DOMPurify.sanitize(
			marked.parse(text, { async: false, gfm: true, breaks: false }) as string
		);
		html = html.replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
		if (cache.size > MAX_CACHE) cache.clear();
		cache.set(text, html);
	}
	return html;
}
