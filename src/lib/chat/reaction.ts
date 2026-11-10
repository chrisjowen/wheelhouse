/**
 * Thumbs-up on a Firstmate message. Firstmate only receives text, so a 👍
 * reaches it as one short note quoting the message it is on:
 *
 *     👍 on: “The scout found it: the 40% growth is the URL polyfill.”
 *
 * Taking the 👍 back sends nothing; it only clears the mark. Pure, so it is
 * unit-tested.
 */
import { snippetOf } from './reply';

/** The longest quote in a reaction note, in characters. */
export const REACTION_SNIPPET_MAX = 100;

/** The note Firstmate receives for a 👍: the message's first line, as plain text; '' when it has no words. */
export function reactionText(text: string): string {
	const first = text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.find((l) => l.trim() && !/^\s*(```|<!--)/.test(l));
	const snippet = first ? snippetOf(first, REACTION_SNIPPET_MAX) : '';
	return snippet ? `👍 on: “${snippet}”` : '';
}
