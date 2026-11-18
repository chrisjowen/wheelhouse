/**
 * What Firstmate's backlog says about each task, for naming its record: the
 * row's title, its project (`(repo: X)`), its kind and the day it finished.
 * Read from `data/backlog.md` and `data/done-archive.md` (the backlog's older
 * rows) as Firstmate writes them:
 *
 *   - [x] <id> - <title> data/<id>/report.md (repo: X) (kind: scout) (reported 2026-10-05)
 *
 * Pure, so it is unit-tested; the newest row for an id wins.
 */

export interface BacklogRow {
	id: string;
	title: string;
	repo: string | null;
	kind: string | null;
	/** The day it was reported, landed or done, when the row says. */
	done: string | null;
}

const ROW = /^- \[[ xX]\] ([A-Za-z0-9][A-Za-z0-9._-]{0,127}) - (.+)$/;
/** Where the title stops: a data path, a blocker, or the first `(key: value)` annotation. */
const TITLE_END =
	/\s+(?:(?:\S*\/)?data\/\S+|blocked-by:|\((?:repo|kind|priority|since|reported|landed|done|merged|shipped|closed|abandoned)\b)/;

export function parseBacklogRows(text: string): BacklogRow[] {
	const out: BacklogRow[] = [];
	for (const line of text.split('\n')) {
		const m = ROW.exec(line.trimEnd());
		if (!m) continue;
		const rest = m[2];
		const end = TITLE_END.exec(rest);
		const title = (end ? rest.slice(0, end.index) : rest).trim();
		const done =
			/\((?:reported|landed|done|merged|shipped|closed)\b[^)]*?(\d{4}-\d{2}-\d{2})/.exec(
				rest
			)?.[1] ?? null;
		out.push({
			id: m[1],
			title,
			repo: /\(repo: ([^)\s]+)\)/.exec(rest)?.[1] ?? null,
			kind: /\(kind: ([^)\s]+)\)/.exec(rest)?.[1] ?? null,
			done
		});
	}
	return out;
}

/** Rows by id, the later file's (and the later line's) row winning. */
export function backlogIndex(...texts: string[]): Map<string, BacklogRow> {
	const map = new Map<string, BacklogRow>();
	for (const t of texts) for (const r of parseBacklogRows(t)) map.set(r.id, r);
	return map;
}
