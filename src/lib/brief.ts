/**
 * A task's brief: the instructions Firstmate (or a second mate) gave its
 * worker, kept as `data/<task>/brief.md` in the home that owns the task. The
 * task page shows it first: the captain's intent, Firstmate's spec, and the
 * rest of the brief (setup, rules, definition of done). Pure, so it is
 * unit-tested.
 */

/** The most of a brief Wheelhouse reads; a longer one is shown up to here. */
export const BRIEF_MAX_BYTES = 64 * 1024;

export interface TaskBrief {
	/**
	 * Where it is, relative to the home that owns the task (`data/<task>/brief.md`),
	 * for the captain's own tasks a path the document reader opens.
	 */
	path: string;
	/** The `## Captain's intent` section's text, else null. */
	intent: string | null;
	/** The `## Firstmate spec` section's text, else null. */
	spec: string | null;
	/** Everything else in the brief, as written. */
	rest: string;
	/** The brief's size on disk. */
	bytes: number;
	/** Only its first BRIEF_MAX_BYTES were read. */
	truncated: boolean;
	/** The second mate whose home it was read from (null for the captain's own tasks). */
	mate: string | null;
	/** It was read over SSH from a second mate on another computer. */
	remote: boolean;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const INTENT = /^captain[’']?s intent\b/i;
const SPEC = /^firstmate[’']?s? spec\b/i;

/**
 * The captain's intent and Firstmate's spec, each the text under the first
 * heading that names it (up to the next heading of the same or a higher
 * level), and the rest of the brief with both taken out. A brief with
 * neither keeps all of its text in `rest`.
 */
export function parseBrief(md: string): Pick<TaskBrief, 'intent' | 'spec' | 'rest'> {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const found: Record<'intent' | 'spec', { from: number; to: number } | null> = {
		intent: null,
		spec: null
	};
	let fence = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
		if (fence) continue;
		const h = HEADING.exec(lines[i]);
		if (!h) continue;
		const which = INTENT.test(h[2]) ? 'intent' : SPEC.test(h[2]) ? 'spec' : null;
		if (!which || found[which]) continue;
		const level = h[1].length;
		let to = lines.length;
		let inner = false;
		for (let j = i + 1; j < lines.length; j++) {
			if (/^\s*(```|~~~)/.test(lines[j])) inner = !inner;
			if (inner) continue;
			const n = HEADING.exec(lines[j]);
			if (n && n[1].length <= level) {
				to = j;
				break;
			}
		}
		found[which] = { from: i, to };
	}
	const body = (r: { from: number; to: number } | null) =>
		r
			? lines
					.slice(r.from + 1, r.to)
					.join('\n')
					.trim() || null
			: null;
	const taken = (i: number) =>
		Object.values(found).some((r) => r !== null && i >= r.from && i < r.to);
	const left = lines.filter((_, i) => !taken(i));
	// A heading left with nothing under it (say "# Task", once both sections are out) goes too.
	const empty = (i: number) => {
		const h = HEADING.exec(left[i]);
		if (!h || !Object.values(found).some((r) => r !== null)) return false;
		for (let j = i + 1; j < left.length; j++) {
			if (!left[j].trim()) continue;
			const n = HEADING.exec(left[j]);
			return !!n && n[1].length <= h[1].length;
		}
		return true;
	};
	const rest = left
		.filter((_, i) => !empty(i))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { intent: body(found.intent), spec: body(found.spec), rest };
}

/** A brief's size in plain words: "18 KB". */
export function briefSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}
