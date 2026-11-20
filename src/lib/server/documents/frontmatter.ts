/**
 * The small YAML front matter a library document starts with, and that a
 * report may carry: `key: value` lines, with lists written `[a, b]` or as
 * `- item` lines. Only what the library needs; anything else is kept as text.
 * Pure, so it is unit-tested.
 */

export type FrontValue = string | string[];

export interface Fronted {
	data: Record<string, FrontValue>;
	/** The document after the front matter. */
	body: string;
}

const unquote = (s: string) => {
	const t = s.trim();
	if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
		const inner = t.slice(1, -1);
		return t[0] === '"'
			? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
			: inner.replace(/''/g, "'");
	}
	return t;
};

export function readFront(text: string): Fronted {
	const src = text.replace(/\r\n?/g, '\n');
	const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src);
	if (!m) return { data: {}, body: src };
	const data: Record<string, FrontValue> = {};
	let list: string | null = null;
	for (const line of m[1].split('\n')) {
		const item = /^\s+-\s+(.*)$/.exec(line) ?? (list ? /^-\s+(.*)$/.exec(line) : null);
		if (item && list) {
			(data[list] as string[]).push(unquote(item[1]));
			continue;
		}
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!kv) continue;
		const [, k, raw] = kv;
		list = null;
		if (raw === '') {
			data[k] = [];
			list = k;
		} else if (/^\[.*\]$/.test(raw.trim())) {
			data[k] = raw.trim().slice(1, -1).split(',').map(unquote).filter(Boolean);
		} else data[k] = unquote(raw);
	}
	return { data, body: src.slice(m[0].length) };
}

const quote = (s: string) =>
	/^[\w./@-][\w ./@:-]*$/.test(s) && !/:\s/.test(s) && s.trim() === s ? s : JSON.stringify(s);

/** Front matter for `data`, then the body. Empty values are left out. */
export function writeFront(
	data: Record<string, FrontValue | null | undefined>,
	body: string
): string {
	const lines: string[] = [];
	for (const [k, v] of Object.entries(data)) {
		if (v === null || v === undefined || v === '') continue;
		lines.push(Array.isArray(v) ? `${k}: [${v.map(quote).join(', ')}]` : `${k}: ${quote(v)}`);
	}
	return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

export const frontString = (v: FrontValue | undefined): string | null =>
	typeof v === 'string' && v.trim() ? v.trim() : null;
export const frontList = (v: FrontValue | undefined): string[] =>
	Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()) : [];
