/**
 * The part of a report a decision rests on, so the decision can show it in
 * place instead of the whole file: the section its words point at ("report
 * §9", "section 9", `report.md#9-captain-decisions`), else the one that holds
 * the captain's calls ("Captain decisions", "Open questions"). A report with no
 * such section is shown whole.
 */

export interface DocSection {
	/** The section's heading, as written (without the #s); null for the whole document. */
	heading: string | null;
	/** The section's Markdown, heading included, up to the next heading at its level or above. */
	text: string;
}

interface Heading {
	line: number;
	level: number;
	text: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
/** "§9", "§ 9.2", "section 9", "sect. 9" in a decision's words. */
const NAMED = /(?:§\s*|\bsect(?:ion|\.)?\s+)(\d+(?:\.\d+)*)\b/i;
/** A link into a Markdown file at a heading: `report.md#9-captain-decisions`. */
const ANCHOR = /\.md#([\w-]+)/i;
/** A section that collects the captain's calls, when the words name none. */
const CALLS =
	/\b(?:captain(?:['’]s)?\s+(?:decisions?|calls?)|decisions?\s+for\s+(?:the\s+)?captain|open\s+questions|questions\s+for\s+(?:you|the\s+captain)|decisions?\s+needed)\b/i;

/** Headings outside code fences, in order. */
function headings(lines: string[]): Heading[] {
	const out: Heading[] = [];
	let fenced = false;
	lines.forEach((l, i) => {
		if (FENCE.test(l)) fenced = !fenced;
		if (fenced) return;
		const m = HEADING.exec(l);
		if (m) out.push({ line: i, level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() });
	});
	return out;
}

/** A heading as a link anchor, as GitHub and most renderers write it. */
export function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s+/g, '-');
}

/** The number a heading starts with: "9. Captain decisions" → "9". */
const numberOf = (text: string) => /^(\d+(?:\.\d+)*)[.):]?\s/.exec(`${text} `)?.[1] ?? null;

/**
 * The section of `doc` that `hints` (the decision's own words) point at, else
 * the one holding the captain's calls, else the whole document.
 */
export function sectionFor(doc: string, hints: (string | null | undefined)[]): DocSection {
	const lines = doc.split('\n');
	const all = headings(lines);
	const words = hints.filter(Boolean).join('\n');
	const anchor = ANCHOR.exec(words)?.[1]?.toLowerCase() ?? null;
	const named = NAMED.exec(words)?.[1] ?? null;
	const at =
		(anchor ? all.find((h) => slug(h.text) === anchor) : undefined) ??
		(named ? all.find((h) => numberOf(h.text) === named) : undefined) ??
		all.find((h) => CALLS.test(h.text));
	if (!at) return { heading: null, text: doc.trim() };
	const next = all.find((h) => h.line > at.line && h.level <= at.level);
	return {
		heading: at.text,
		text: lines
			.slice(at.line, next ? next.line : lines.length)
			.join('\n')
			.trim()
	};
}

/** The kind of block a line carries on: a table row, a list item or a quote; null for prose. */
function blockOf(line: string): 'table' | 'list' | 'quote' | null {
	const l = line.trimStart();
	if (l.startsWith('|')) return 'table';
	if (/^(?:[-*+]|\d+[.)])\s/.test(l)) return 'list';
	if (l.startsWith('>')) return 'quote';
	return null;
}

/**
 * A held task's body as Markdown. Firstmate's snapshot keeps its lines but
 * drops the blank ones, so each line is taken as its own paragraph, except
 * where it runs on a table, a list or a quote.
 */
export function bodyMarkdown(text: string): string {
	const lines = text.split('\n');
	return lines
		.map((l, i) => {
			if (i === 0) return l;
			const kind = blockOf(l);
			const run = kind !== null && kind === blockOf(lines[i - 1]);
			return `${run ? '\n' : '\n\n'}${l}`;
		})
		.join('');
}
