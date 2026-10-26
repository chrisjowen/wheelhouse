/** One heading in a document's outline. */
export interface OutlineEntry {
	id: string;
	text: string;
	level: 2 | 3;
}

/** A long document gets an outline; a short one reads fine without. */
export const OUTLINE_MIN = 3;

/** A heading's text as a URL fragment: lower case, words joined by hyphens. */
export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-+|-+$/g, '') || 'section'
	);
}

/**
 * Ids for a document's section headings, in order, unique within the page: a repeated
 * heading gets -2, -3 and so on, and none collides with an id the page already uses.
 */
export function outline(
	headings: { text: string; level: 2 | 3 }[],
	taken: Iterable<string> = []
): OutlineEntry[] {
	const used = new Set(taken);
	return headings.map(({ text, level }) => {
		const base = `doc-${slug(text)}`;
		let id = base;
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return { id, text: text.trim(), level };
	});
}
