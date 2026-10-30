/**
 * Replying to a message in the chat, as in WhatsApp. Firstmate only receives
 * text, so a reply reaches it as a one-line Markdown quote of the message it
 * answers, then a blank line, then the captain's words:
 *
 *     > Replying to Firstmate: “The scout found it: the 40% growth is…”
 *
 *     Can we drop Node 16 in 3.0 then?
 *
 * The chat reads that form back from the transcript and shows the quote above
 * the message rather than as raw text. Pure, so it is unit-tested.
 */
import { chipLabel, parseRefs } from './refs';

/** Who wrote the message being answered. */
export type ReplyWho = 'firstmate' | 'captain';

export interface ReplyTo {
	who: ReplyWho;
	/** The start of the answered message as plain text, on one line. */
	snippet: string;
}

/** The longest quote sent, in characters; longer messages are cut with "…". */
export const SNIPPET_MAX = 140;

const LABEL: Record<ReplyWho, string> = {
	firstmate: 'Firstmate',
	captain: 'my message'
};

/** A message's text, Markdown or not, as one plain line; a mentioned task reads as its chip. */
export function plain(text: string): string {
	const md = text
		.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
		.replace(/(\*\*|__|~~|`)/g, '')
		.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2');
	return parseRefs(md)
		.map((p) => (typeof p === 'string' ? p : chipLabel(p, 60)))
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The quote of a message: its start, on one line, cut at a word with "…" when long. */
export function snippetOf(text: string, max = SNIPPET_MAX): string {
	const line = plain(text);
	if (line.length <= max) return line;
	const cut = line.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`;
}

/** The text Firstmate receives for a reply: the quote, a blank line, then the captain's words. */
export function composeReply(to: ReplyTo, body: string): string {
	const words = body.trim();
	if (!words) return words;
	return `> Replying to ${LABEL[to.who]}: “${to.snippet.replace(/\s+/g, ' ').trim()}”\n\n${words}`;
}

const QUOTED = /^> Replying to (Firstmate|my message): “(.*)”\n\n([\s\S]+)$/;

/** A sent message back as its quote and the captain's words; `to` is null when it is no reply. */
export function parseReply(text: string): { to: ReplyTo | null; body: string } {
	const m = text.replace(/\r\n?/g, '\n').match(QUOTED);
	if (!m || !m[3].trim()) return { to: null, body: text };
	return {
		to: { who: m[1] === 'Firstmate' ? 'firstmate' : 'captain', snippet: m[2] },
		body: m[3]
	};
}

/** Whether a message's text is the one a quote was taken from. */
export function quotes(to: ReplyTo, text: string): boolean {
	const line = plain(text);
	if (!line) return false;
	const s = to.snippet.endsWith('…') ? to.snippet.slice(0, -1) : to.snippet;
	return to.snippet.endsWith('…') ? line.startsWith(s) : line === s;
}
