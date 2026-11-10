const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]}'"*]+$/;

/** http(s) URLs in plain text, without trailing punctuation (or Markdown's bold stars). */
export function extractUrls(text: string): string[] {
	return [...text.matchAll(URL_RE)].map((m) => m[0].replace(TRAILING, ''));
}
