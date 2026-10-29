/**
 * The `NAME=value` lines of a .env file, for `wh-vault import`. It reads what
 * dotenv files commonly hold: `export ` prefixes, `#` comments, blank lines,
 * single-quoted values taken as written, double-quoted values with `\n`, `\t`,
 * `\"` and `\\` escapes, and unquoted values up to a ` #` comment. A line it
 * cannot read is reported by number only, since it may hold a value.
 */

export interface DotenvResult {
	entries: { name: string; value: string }[];
	/** Line numbers (1-based) that are not a `NAME=value` assignment. */
	skipped: number[];
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseDotenv(text: string): DotenvResult {
	const entries: { name: string; value: string }[] = [];
	const skipped: number[] = [];
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || line.trim().startsWith('#')) continue;
		const m = LINE.exec(line);
		if (!m) {
			skipped.push(i + 1);
			continue;
		}
		const value = parseValue(m[2]);
		if (value === null) skipped.push(i + 1);
		else entries.push({ name: m[1], value });
	}
	return { entries, skipped };
}

function parseValue(raw: string): string | null {
	const s = raw.trim();
	if (s.startsWith("'")) {
		const end = s.indexOf("'", 1);
		return end === -1 || !isTail(s.slice(end + 1)) ? null : s.slice(1, end);
	}
	if (s.startsWith('"')) {
		let out = '';
		for (let i = 1; i < s.length; i++) {
			const c = s[i];
			if (c === '\\' && i + 1 < s.length) {
				const n = s[++i];
				out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
			} else if (c === '"') {
				return isTail(s.slice(i + 1)) ? out : null;
			} else {
				out += c;
			}
		}
		return null;
	}
	const hash = s.search(/\s#/);
	return (hash === -1 ? s : s.slice(0, hash)).trim();
}

/** What may follow a closing quote: nothing, or a comment. */
const isTail = (rest: string) => !rest.trim() || rest.trim().startsWith('#');
