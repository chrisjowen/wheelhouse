import type { DocketGraph, Join, JoinLink, Link } from './types';

/**
 * Where a task's changed files sit on a docket's chart. Deterministic: a file
 * touches an exhibit when it is the `path` of evidence recorded on the
 * exhibit or on one of its links (a path ending in `/` covers a directory).
 * From what is touched the join follows one step along depends_on, uses and
 * deployed_to, then collects whatever applies_to reaches those exhibits.
 * An exhibit with no file evidence cannot be joined.
 */

/** Relationships followed one step out from what a task touches. */
export const FOLLOW = new Set(['depends_on', 'uses', 'deployed_to']);
/** Relationships whose source leans on its target. */
const DEPENDS = new Set(['depends_on', 'uses']);

/** A repository-relative path, without `./` or a leading slash. */
export function normalizePath(p: string): string {
	return p
		.trim()
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '')
		.replace(/^\/+/, '')
		.replace(/\/{2,}/g, '/');
}

/** Whether a changed file is the place an evidence path names. */
export function pathMatches(evidencePath: string, file: string): boolean {
	const e = normalizePath(evidencePath);
	const f = normalizePath(file);
	if (!e || !f) return false;
	return e.endsWith('/') ? f.startsWith(e) : f === e;
}

const ref = (l: Link): JoinLink => ({
	source: l.source,
	rel: l.rel,
	target: l.target,
	mark: l.mark
});

export function joinFiles(graph: DocketGraph, changed: string[]): Join {
	const files = [...new Set(changed.map(normalizePath).filter(Boolean))];
	const byId = new Map(graph.exhibits.map((x) => [x.id, x]));
	const touched = new Map<string, Set<string>>();
	const touch = (id: string, f: string) => {
		const set = touched.get(id) ?? new Set<string>();
		set.add(f);
		touched.set(id, set);
	};
	const matching = (paths: (string | null)[]) =>
		files.filter((f) => paths.some((p) => p !== null && pathMatches(p, f)));

	let evidencePaths = 0;
	const matched = new Set<string>();
	for (const x of graph.exhibits) {
		const paths = x.evidence.map((e) => e.path);
		evidencePaths += paths.filter(Boolean).length;
		for (const f of matching(paths)) {
			touch(x.id, f);
			matched.add(f);
		}
	}
	const touchedLinks: Join['touchedLinks'] = [];
	for (const l of graph.links) {
		const paths = l.evidence.map((e) => e.path);
		evidencePaths += paths.filter(Boolean).length;
		const hit = matching(paths);
		if (!hit.length) continue;
		for (const f of hit) {
			touch(l.source, f);
			matched.add(f);
		}
		touchedLinks.push({ ...ref(l), files: hit });
	}

	const nearby = graph.links.filter((l) => touched.has(l.source) && FOLLOW.has(l.rel)).map(ref);
	const reach = new Set([...touched.keys(), ...nearby.map((l) => l.target)]);

	const superseded = new Set(
		graph.links.filter((l) => l.rel === 'supersedes').map((l) => l.target)
	);
	const restricted = new Map<string, { id: string; appliesTo: string[]; direct: boolean }>();
	const notices = new Map<string, { id: string; appliesTo: string[]; superseded: boolean }>();
	for (const l of graph.links) {
		if (l.rel !== 'applies_to' || !reach.has(l.target)) continue;
		const isDecision = byId.get(l.source)?.type === 'decision';
		if (isDecision) {
			const n = notices.get(l.source) ?? {
				id: l.source,
				appliesTo: [],
				superseded: superseded.has(l.source)
			};
			n.appliesTo.push(l.target);
			notices.set(l.source, n);
		} else {
			const r = restricted.get(l.source) ?? { id: l.source, appliesTo: [], direct: false };
			r.appliesTo.push(l.target);
			r.direct ||= touched.has(l.target);
			restricted.set(l.source, r);
		}
	}

	const dependents = graph.links
		.filter((l) => touched.has(l.target) && !touched.has(l.source) && DEPENDS.has(l.rel))
		.map(ref);

	return {
		touched: [...touched].map(([id, set]) => ({ id, files: [...set].sort() })),
		touchedLinks,
		nearby,
		restricted: [...restricted.values()].sort(
			(a, b) => Number(b.direct) - Number(a.direct) || a.id.localeCompare(b.id)
		),
		notices: [...notices.values()].sort(
			(a, b) => Number(a.superseded) - Number(b.superseded) || a.id.localeCompare(b.id)
		),
		dependents,
		coverage: { files: files.length, matched: matched.size, evidencePaths }
	};
}

/** Restrictions that apply directly to an exhibit the files touch: the Harbour's hazards. */
export function hazardsOf(join: Join): { id: string; appliesTo: string[] }[] {
	const touched = new Set(join.touched.map((t) => t.id));
	return join.restricted
		.filter((r) => r.direct)
		.map((r) => ({ id: r.id, appliesTo: r.appliesTo.filter((a) => touched.has(a)) }));
}
