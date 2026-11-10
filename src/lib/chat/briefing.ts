/**
 * A briefing: a long, structured reply from Firstmate (a plan, a round-up, a report) that
 * the chat sets apart as a card under a gold rule. Generic: 500 characters or more, with a
 * list or a heading in its Markdown.
 */
export const BRIEFING_MIN_CHARS = 500;

export function isBriefing(text: string | null | undefined): boolean {
	if (!text || text.length < BRIEFING_MIN_CHARS) return false;
	return /^\s{0,3}(?:[-*+]|\d+[.)]|#{1,4})\s+\S/m.test(text);
}
