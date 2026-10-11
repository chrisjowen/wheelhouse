import type { DocketGraph, Evidence, Exhibit, Link, Mark } from './types';

/**
 * Reading `docket graph --json` (schema `docket.graph`, version 1; docket's
 * docs/graph-json.md). Docket merges files and computes confidence; this only
 * checks the contract, keeps what the Chart draws and bounds its size.
 */

export const GRAPH_SCHEMA = 'docket.graph';
export const GRAPH_VERSION = 1;

/** Bounds on what is sent to the page. */
export const LIMITS = {
	exhibits: 400,
	links: 1200,
	evidence: 50,
	attributes: 12,
	tags: 8,
	text: 280,
	diagnostics: 5
} as const;

/** Link confidence as a chart draws it: charted, position approximate, existence doubtful. */
export function markFor(confidence: number | null, basis: string | null, dangling = false): Mark {
	if (dangling) return 'unsurveyed';
	if (basis === 'unevidenced' || confidence === null) return 'doubtful';
	if (confidence >= 0.8) return 'charted';
	if (confidence >= 0.5) return 'approximate';
	return 'doubtful';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const cut = (s: string, n: number = LIMITS.text) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A docket date (`YYYY-MM-DD` or ISO 8601) as `YYYY-MM-DD`, or null. */
export function surveyDate(v: unknown): string | null {
	const s = str(v);
	const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
	return m ? m[1] : null;
}

function evidenceOf(v: unknown): Evidence[] {
	if (!Array.isArray(v)) return [];
	return v.filter(isRecord).map((e) => {
		const urls = Array.isArray(e.urls) ? e.urls.map(str).filter((u) => u !== null) : [];
		const lines = typeof e.lines === 'number' ? String(e.lines) : str(e.lines);
		return {
			source: str(e.source) ?? 'unknown',
			path: str(e.path),
			lines,
			key: str(e.key),
			symbol: str(e.symbol),
			url: urls[0] ?? str(e.url),
			observedAt: str(e.observedAt),
			observedBy: str(e.observedBy),
			note: str(e.note) ? cut(str(e.note)!) : null
		};
	});
}

function assessment(v: unknown): { confidence: number | null; basis: string | null } {
	if (!isRecord(v)) return { confidence: null, basis: null };
	const c = typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? v.confidence : null;
	return { confidence: c, basis: str(v.basis) };
}

const newest = (dates: (string | null)[]): string | null =>
	dates.reduce<string | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** The first paragraph of a Markdown body that is not a heading. */
function summaryOf(content: unknown): string | null {
	const s = str(content);
	if (!s) return null;
	for (const para of s.split(/\n\s*\n/)) {
		const t = para.trim();
		if (!t || t.startsWith('#')) continue;
		// Plain words: no Markdown code ticks, emphasis or [[links]].
		const plain = t
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.replace(/`([^`]*)`/g, '$1')
			.replace(/(\*\*|__)(.*?)\1/g, '$2');
		return cut(plain.replace(/\s+/g, ' '));
	}
	return null;
}

function attributesOf(v: unknown): { key: string; value: string }[] {
	if (!isRecord(v)) return [];
	return Object.entries(v)
		.slice(0, LIMITS.attributes)
		.map(([key, val]) => ({
			key,
			value: cut(
				Array.isArray(val)
					? val.map(String).join(', ')
					: isRecord(val)
						? JSON.stringify(val)
						: String(val),
				120
			)
		}));
}

export type ParseResult = { ok: true; graph: DocketGraph } | { ok: false; reason: string };

/** Parse and trim `docket graph --json` output. */
export function parseGraph(text: string): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'docket printed something that is not JSON.' };
	}
	if (!isRecord(raw) || raw.schema !== GRAPH_SCHEMA) {
		return { ok: false, reason: 'docket printed something that is not a docket graph.' };
	}
	if (raw.version !== GRAPH_VERSION) {
		return {
			ok: false,
			reason: `docket printed graph version ${String(raw.version)}; this Wheelhouse reads version ${GRAPH_VERSION}.`
		};
	}
	const entities = Array.isArray(raw.entities) ? raw.entities.filter(isRecord) : [];
	const edges = Array.isArray(raw.edges) ? raw.edges.filter(isRecord) : [];

	const ids = new Set<string>();
	const exhibits: Exhibit[] = [];
	for (const e of entities) {
		const id = str(e.id);
		if (!id || ids.has(id)) continue;
		ids.add(id);
		if (exhibits.length >= LIMITS.exhibits) continue;
		const links = Array.isArray(e.links) ? e.links.filter(isRecord) : [];
		const owner = str(links.find((l) => l.rel === 'owned_by')?.target);
		const evidence = evidenceOf(e.evidence);
		const linkEvidence = links.flatMap((l) => evidenceOf(l.evidence));
		exhibits.push({
			id,
			type: str(e.type) ?? 'unknown',
			title: cut(str(e.title) ?? id, 120),
			owner,
			attributes: attributesOf(e.attributes),
			tags: Array.isArray(e.tags)
				? e.tags
						.map(str)
						.filter((t) => t !== null)
						.slice(0, LIMITS.tags)
				: [],
			summary: summaryOf(e.content),
			...assessment(e.assessment),
			surveyed: newest([...evidence, ...linkEvidence].map((x) => surveyDate(x.observedAt))),
			evidence: evidence.slice(0, LIMITS.evidence),
			path: str(e.path)
		});
	}
	const kept = new Set(exhibits.map((x) => x.id));

	const links: Link[] = [];
	let droppedLinks = 0;
	for (const d of edges) {
		const source = str(d.source);
		const rel = str(d.rel);
		const target = str(d.target);
		if (!source || !rel || !target) continue;
		if (!kept.has(source) || (ids.has(target) && !kept.has(target))) {
			droppedLinks++;
			continue;
		}
		if (links.length >= LIMITS.links) {
			droppedLinks++;
			continue;
		}
		const a = assessment(d.assessment);
		const dangling = d.dangling === true || !ids.has(target);
		links.push({
			source,
			rel,
			target,
			...a,
			mark: markFor(a.confidence, a.basis, dangling),
			dangling,
			evidence: evidenceOf(d.evidence).slice(0, LIMITS.evidence)
		});
	}

	const diagnostics = Array.isArray(raw.diagnostics) ? raw.diagnostics.filter(isRecord) : [];
	const project = isRecord(raw.project) ? raw.project : {};
	const index = isRecord(raw.index) ? raw.index : null;
	return {
		ok: true,
		graph: {
			project: { name: str(project.name) ?? 'docket', root: str(project.root) ?? '' },
			exhibits,
			links,
			types: (Array.isArray(raw.types) ? raw.types.filter(isRecord) : []).flatMap((t) => {
				const name = str(t.name);
				return name
					? [
							{
								name,
								icon: str(t.icon),
								description: str(t.description) ? cut(str(t.description)!, 160) : null
							}
						]
					: [];
			}),
			diagnostics: {
				errors: diagnostics.filter((x) => x.severity === 'error').length,
				warnings: diagnostics.filter((x) => x.severity !== 'error').length,
				messages: diagnostics
					.slice(0, LIMITS.diagnostics)
					.map((x) => cut(str(x.message) ?? 'unknown problem', 200))
			},
			index:
				index && typeof index.synced === 'boolean'
					? { synced: index.synced, behind: typeof index.behind === 'number' ? index.behind : 0 }
					: null,
			surveyed: newest(exhibits.map((x) => x.surveyed)),
			trimmed: { exhibits: ids.size - exhibits.length, links: droppedLinks }
		}
	};
}
