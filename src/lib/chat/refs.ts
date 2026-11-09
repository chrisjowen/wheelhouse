/**
 * References the captain drops into a message with "#" (or a rail card's
 * "Chat about this"): a task, or a task's pull request. The composer shows a
 * chip; Firstmate receives plain text naming the task by its id - the key its
 * own scripts and backlog use - and title, so it can act on the reference
 * without guessing. Pure, so it is unit-tested.
 */
export interface Ref {
	kind: 'task' | 'pr';
	/** Firstmate's task id. */
	id: string;
	title: string;
	project: string | null;
	url: string | null;
}

/**
 * How a task is named to Firstmate: its id, and for a second mate's task
 * (`<task>@<mate>`), the id its own home knows it by and which second mate it
 * is on, so Firstmate passes the message on to it.
 */
function named(id: string): string {
	const at = id.lastIndexOf('@');
	return at > 0 ? `${id.slice(0, at)} on second mate ${id.slice(at + 1)}` : id;
}

/** The text a chip becomes in the message Firstmate receives. */
export function expandRef(r: Ref): string {
	return r.kind === 'pr' && r.url
		? `[PR ${r.url} — task ${named(r.id)}: ${r.title}]`
		: `[task ${named(r.id)}: ${r.title}]`;
}

/** A composed message: runs of text and reference chips, in order. */
export type Piece = string | Ref;

/** The message Firstmate receives: text with every chip expanded, trimmed. */
export function compose(pieces: Piece[]): string {
	return pieces
		.map((p) => (typeof p === 'string' ? p : expandRef(p)))
		.join('')
		.replace(/\u00a0/g, ' ')
		.trim();
}

/** A chip's short label. */
export function chipLabel(r: Ref, max = 34): string {
	const title = r.title.length > max ? `${r.title.slice(0, max - 1)}…` : r.title;
	const num = r.url?.match(/\/pull\/(\d+)/)?.[1];
	return r.kind === 'pr' ? `PR${num ? ` #${num}` : ''} ${title}` : `# ${title}`;
}

const EXPANDED =
	/\[(?:PR (https?:\/\/\S+) — )?task ([A-Za-z0-9][A-Za-z0-9._-]*)(?: on second mate ([A-Za-z0-9][A-Za-z0-9._-]*))?: ([^\]\n]+)\]/g;

/** A sent message back as text and chips: each expanded reference becomes its chip again. */
export function parseRefs(text: string): Piece[] {
	const out: Piece[] = [];
	let at = 0;
	for (const m of text.matchAll(EXPANDED)) {
		if (m.index > at) out.push(text.slice(at, m.index));
		out.push({
			kind: m[1] ? 'pr' : 'task',
			id: m[3] ? `${m[2]}@${m[3]}` : m[2],
			title: m[4].trim(),
			project: null,
			url: m[1] ?? null
		});
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push(text.slice(at));
	return out;
}
