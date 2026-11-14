/**
 * A Wheelhouse-managed block inside a file someone else owns, such as a
 * Firstmate home's `config/brief-include.md`:
 *
 *   <!-- wheelhouse:begin v=0.17.0 — managed by Wheelhouse; edit outside this block -->
 *   …
 *   <!-- wheelhouse:end -->
 *
 * Only the text between the two marker lines is Wheelhouse's. Everything
 * before and after is kept byte for byte, and a file whose markers are missing
 * a half or appear twice is never rewritten.
 */

export type ParsedBlock =
	| { state: 'absent' }
	| { state: 'one'; before: string; body: string; after: string }
	| { state: 'broken'; reason: string };

const beginLine = (name: string) => new RegExp(`^<!-- ${name}:begin\\b.*-->[ \\t]*$`, 'gm');
const endLine = (name: string) => new RegExp(`^<!-- ${name}:end -->[ \\t]*$`, 'gm');

export function parseBlock(text: string, name: string): ParsedBlock {
	const begins = [...text.matchAll(beginLine(name))];
	const ends = [...text.matchAll(endLine(name))];
	if (!begins.length && !ends.length) return { state: 'absent' };
	if (begins.length !== 1 || ends.length !== 1)
		return {
			state: 'broken',
			reason:
				begins.length > 1 || ends.length > 1
					? 'its Wheelhouse block markers appear more than once'
					: 'its Wheelhouse block is missing its begin or end marker'
		};
	const begin = begins[0].index!;
	const beginEnd = begin + begins[0][0].length;
	const end = ends[0].index!;
	if (end < beginEnd)
		return { state: 'broken', reason: 'its Wheelhouse block ends before it begins' };
	return {
		state: 'one',
		before: text.slice(0, begin),
		// The lines between the two marker lines, without the newlines that close them.
		body: text.slice(beginEnd + 1, end - 1),
		after: text.slice(end + ends[0][0].length)
	};
}

export const renderBlock = (name: string, version: string, body: string) =>
	`<!-- ${name}:begin v=${version} — managed by Wheelhouse; edit outside this block -->\n${body}\n<!-- ${name}:end -->`;

/**
 * `text` with the block replaced, or appended after a blank line when the file
 * has none; null when its markers are broken.
 */
export function withBlock(text: string, name: string, block: string): string | null {
	const p = parseBlock(text, name);
	if (p.state === 'broken') return null;
	if (p.state === 'one') return p.before + block + p.after;
	if (!text) return block + '\n';
	return text + (text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n') + block + '\n';
}

/** `text` without the block (and the blank line it was appended after); null when its markers are broken. */
export function withoutBlock(text: string, name: string): string | null {
	const p = parseBlock(text, name);
	if (p.state === 'broken') return null;
	if (p.state === 'absent') return text;
	const after = p.after.replace(/^\n/, '');
	const before = after ? p.before : p.before.replace(/\n\n$/, '\n');
	return before + after;
}
