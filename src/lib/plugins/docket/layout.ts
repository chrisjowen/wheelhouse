import type { DocketGraph, Exhibit, Mark } from './types';

/**
 * The Chart's layout: deliberate, not force-directed, so the same docket
 * always draws the same way.
 *
 * - Each owner's exhibits sit in that owner's waters, a horizontal band with
 *   the owner's flag; exhibits with no owner share a last band.
 * - Within the bands, columns follow dependencies left to right: whoever
 *   depends on or uses something sits left of it.
 * - Environments are harbours on the right-hand coast, production first.
 * - Teams, decisions and constraints are not landmarks: teams are the bands,
 *   decisions are notices to mariners, and constraints are restricted waters
 *   drawn as hatched halos around what they apply to.
 */

export const GEOMETRY = {
	nodeW: 176,
	nodeH: 56,
	colGap: 72,
	rowGap: 32,
	laneTop: 40,
	laneX: 24,
	laneBottom: 20,
	laneGap: 16,
	coastGap: 64,
	harbourW: 168,
	margin: 12,
	maxColumns: 8
} as const;

const G = GEOMETRY;

/** Relationships drawn as their own picture rather than a line. */
const NOT_LINES = new Set(['owned_by', 'applies_to', 'supersedes']);
/** Relationships whose source sits left of its target. */
const FLOWS = new Set(['depends_on', 'uses', 'guarded_by', 'reads', 'writes', 'calls']);
/** Draw order of landmark types within a column; others follow alphabetically. */
const TYPE_ORDER = ['agent', 'service', 'repository', 'library', 'feature_flag', 'datasource'];

export interface LaidNode {
	id: string;
	kind: 'landmark' | 'harbour' | 'ghost';
	x: number;
	y: number;
	w: number;
	h: number;
	exhibit: Exhibit | null;
}

export interface LaidLane {
	/** The owner's id, or null for exhibits with no owner on record. */
	id: string | null;
	title: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LaidEdge {
	key: string;
	source: string;
	target: string;
	rel: string;
	mark: Mark;
	/**
	 * A line into a harbour. The chart draws these only for what is selected;
	 * otherwise the landmark carries an anchor, so the coast does not fill with lines.
	 */
	quiet: boolean;
	/** SVG path data. */
	d: string;
	/** Where the line's mid-point label goes. */
	mid: { x: number; y: number };
}

export interface Restriction {
	id: string;
	letter: string;
	title: string;
	/** Every exhibit it applies to, drawn or not. */
	targets: string[];
}

export interface Halo {
	restriction: string;
	letter: string;
	node: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ChartLayout {
	width: number;
	height: number;
	lanes: LaidLane[];
	nodes: LaidNode[];
	edges: LaidEdge[];
	halos: Halo[];
	restrictions: Restriction[];
	/** Decisions, newest-standing first: those nothing supersedes, then superseded ones. */
	notices: { exhibit: Exhibit; superseded: boolean; appliesTo: string[] }[];
	/** The coast holding the harbours, when there are any. */
	coast: { x: number; y: number; w: number; h: number } | null;
}

const letterFor = (i: number) =>
	i < 26
		? String.fromCharCode(65 + i)
		: `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;

function typeRank(type: string): number {
	const i = TYPE_ORDER.indexOf(type);
	return i === -1 ? TYPE_ORDER.length : i;
}

const byTitle = (a: { title: string; id: string }, b: { title: string; id: string }) =>
	a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/** Lay out a docket graph as a chart. */
export function layoutChart(graph: DocketGraph): ChartLayout {
	const byId = new Map(graph.exhibits.map((x) => [x.id, x]));
	const owners = new Set<string>();
	const restrictionSources = new Set<string>();
	const harbourIds = new Set<string>();
	for (const l of graph.links) {
		if (l.rel === 'owned_by') owners.add(l.target);
		if (l.rel === 'deployed_to' && byId.has(l.target)) harbourIds.add(l.target);
		if (l.rel === 'applies_to' && byId.get(l.source)?.type !== 'decision') {
			restrictionSources.add(l.source);
		}
	}
	for (const x of graph.exhibits) {
		if (x.type === 'team') owners.add(x.id);
		if (x.type === 'environment') harbourIds.add(x.id);
		if (x.type === 'constraint') restrictionSources.add(x.id);
	}
	const isLandmark = (x: Exhibit) =>
		!owners.has(x.id) &&
		!harbourIds.has(x.id) &&
		!restrictionSources.has(x.id) &&
		x.type !== 'decision';

	const landmarks = graph.exhibits.filter(isLandmark);
	const landmarkIds = new Set(landmarks.map((x) => x.id));

	// Lines: links between drawn things. A dangling target becomes a ghost landmark.
	const ghosts = new Set<string>();
	const lines = graph.links.filter((l) => {
		if (NOT_LINES.has(l.rel)) return false;
		if (!landmarkIds.has(l.source) && !harbourIds.has(l.source)) return false;
		if (l.dangling) {
			ghosts.add(l.target);
			return true;
		}
		return landmarkIds.has(l.target) || harbourIds.has(l.target);
	});

	// Columns: longest path along flow links, bounded so a cycle cannot run away.
	const rank = new Map<string, number>();
	for (const id of [...landmarkIds, ...ghosts]) rank.set(id, 0);
	const flows = lines.filter((l) => FLOWS.has(l.rel) && rank.has(l.source) && rank.has(l.target));
	for (let pass = 0; pass < rank.size; pass++) {
		let changed = false;
		for (const l of flows) {
			const next = Math.min(rank.get(l.source)! + 1, G.maxColumns - 1);
			if (next > rank.get(l.target)!) {
				rank.set(l.target, next);
				changed = true;
			}
		}
		if (!changed) break;
	}
	const columns = Math.max(1, ...[...rank.values()].map((r) => r + 1));

	// Bands: one per owner with landmarks, largest first; no owner last.
	const laneOf = (id: string): string | null => {
		const o = byId.get(id)?.owner ?? null;
		return o && owners.has(o) ? o : null;
	};
	const members = new Map<string | null, string[]>();
	for (const id of [...landmarkIds, ...ghosts]) {
		const lane = ghosts.has(id) ? null : laneOf(id);
		members.set(lane, [...(members.get(lane) ?? []), id]);
	}
	const ownerTitle = (id: string | null) =>
		id === null ? 'No owner on record' : (byId.get(id)?.title ?? id);
	const laneIds = [...members.keys()].sort((a, b) => {
		if (a === null) return 1;
		if (b === null) return -1;
		return (
			members.get(b)!.length - members.get(a)!.length || ownerTitle(a).localeCompare(ownerTitle(b))
		);
	});

	const areaW = G.laneX * 2 + columns * G.nodeW + (columns - 1) * G.colGap;
	const nodes: LaidNode[] = [];
	const lanes: LaidLane[] = [];
	let y = G.margin;
	const sortKey = (id: string) => {
		const x = byId.get(id);
		return { type: x?.type ?? '~', title: x?.title ?? id, id };
	};
	// Cells: each band's columns, first by type and title, then reordered to cross less.
	const cells = laneIds.map((lane) => {
		const cols: string[][] = Array.from({ length: columns }, () => []);
		for (const id of members.get(lane)!) cols[rank.get(id)!].push(id);
		for (const c of cols) {
			c.sort((a, b) => {
				const ka = sortKey(a);
				const kb = sortKey(b);
				return (
					typeRank(ka.type) - typeRank(kb.type) || ka.type.localeCompare(kb.type) || byTitle(ka, kb)
				);
			});
		}
		return cols;
	});
	const laneTop: number[] = [];
	for (const cols of cells) {
		const depth = Math.max(1, ...cols.map((c) => c.length));
		laneTop.push(y);
		const h = G.laneTop + depth * G.nodeH + (depth - 1) * G.rowGap + G.laneBottom;
		lanes.push({
			id: laneIds[laneTop.length - 1],
			title: ownerTitle(laneIds[laneTop.length - 1]),
			x: G.margin,
			y,
			w: areaW,
			h
		});
		y += h + G.laneGap;
	}
	uncross(cells, laneTop, lines);
	cells.forEach((cols, li) => {
		cols.forEach((c, ci) => {
			c.forEach((id, ri) => {
				nodes.push({
					id,
					kind: ghosts.has(id) ? 'ghost' : 'landmark',
					x: G.margin + G.laneX + ci * (G.nodeW + G.colGap),
					y: laneTop[li] + G.laneTop + ri * (G.nodeH + G.rowGap),
					w: G.nodeW,
					h: G.nodeH,
					exhibit: byId.get(id) ?? null
				});
			});
		});
	});
	let height = lanes.length ? y - G.laneGap + G.margin : G.margin * 2;

	// The coast: harbours stacked on the right, production first.
	const harbours = [...harbourIds]
		.map((id) => byId.get(id)!)
		.sort((a, b) => {
			const prod = (x: Exhibit) =>
				x.attributes.some((a) => a.key === 'environmentType' && a.value === 'production') ||
				/production|prod$/i.test(x.id)
					? 0
					: 1;
			return prod(a) - prod(b) || byTitle(a, b);
		});
	let coast: ChartLayout['coast'] = null;
	let width = G.margin * 2 + (lanes.length ? areaW : 0);
	if (harbours.length) {
		const x = G.margin + (lanes.length ? areaW + G.coastGap : 0);
		const stack = harbours.length * G.nodeH + (harbours.length - 1) * G.rowGap;
		const h = Math.max(height - G.margin * 2, G.laneTop + stack + G.laneBottom);
		coast = { x, y: G.margin, w: G.harbourW, h };
		harbours.forEach((x0, i) => {
			nodes.push({
				id: x0.id,
				kind: 'harbour',
				x: x + (G.harbourW - G.nodeW) / 2,
				y: G.margin + G.laneTop + i * (G.nodeH + G.rowGap),
				w: G.nodeW,
				h: G.nodeH,
				exhibit: x0
			});
		});
		width = x + G.harbourW + G.margin;
		height = Math.max(height, G.margin * 2 + h);
	}

	const at = new Map(nodes.map((n) => [n.id, n]));
	const edges: LaidEdge[] = [];
	const seen = new Map<string, number>();
	for (const l of lines) {
		const s = at.get(l.source);
		const t = at.get(l.target);
		if (!s || !t || s === t) continue;
		const base = `${l.source}|${l.rel}|${l.target}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		edges.push({
			key: n ? `${base}#${n}` : base,
			source: l.source,
			target: l.target,
			rel: l.rel,
			mark: l.mark,
			quiet: t.kind === 'harbour' && s.kind !== 'harbour',
			...route(s, t)
		});
	}

	// Restricted waters: a hatched halo per restriction around each drawn target.
	const restrictions: Restriction[] = [...restrictionSources]
		.map((id) => ({
			id,
			title: byId.get(id)?.title ?? id,
			targets: graph.links
				.filter((l) => l.rel === 'applies_to' && l.source === id)
				.map((l) => l.target)
		}))
		.sort(byTitle)
		.map((r, i) => ({ ...r, letter: letterFor(i) }));
	const halos: Halo[] = [];
	const around = new Map<string, number>();
	for (const r of restrictions) {
		for (const target of new Set(r.targets)) {
			const n = at.get(target);
			if (!n) continue;
			const k = around.get(target) ?? 0;
			around.set(target, k + 1);
			const pad = 5 + k * 5;
			halos.push({
				restriction: r.id,
				letter: r.letter,
				node: target,
				x: n.x - pad,
				y: n.y - pad,
				w: n.w + pad * 2,
				h: n.h + pad * 2
			});
		}
	}

	const superseded = new Set(
		graph.links.filter((l) => l.rel === 'supersedes').map((l) => l.target)
	);
	const notices = graph.exhibits
		.filter((x) => x.type === 'decision')
		.map((exhibit) => ({
			exhibit,
			superseded: superseded.has(exhibit.id),
			appliesTo: graph.links
				.filter((l) => l.rel === 'applies_to' && l.source === exhibit.id)
				.map((l) => l.target)
		}))
		.sort((a, b) => Number(a.superseded) - Number(b.superseded) || byTitle(a.exhibit, b.exhibit));

	return { width, height, lanes, nodes, edges, halos, restrictions, notices, coast };
}

/**
 * Reorder each band's columns so lines cross less: a few sweeps that sort each
 * cell by the mean height of what it links to, within its band, in the
 * neighbouring columns. Places with no lines at all sink to the bottom.
 * Deterministic; ties keep their order.
 */
function uncross(
	cells: string[][][],
	laneTop: number[],
	lines: { source: string; target: string }[]
) {
	const near = new Map<string, string[]>();
	for (const l of lines) {
		near.set(l.source, [...(near.get(l.source) ?? []), l.target]);
		near.set(l.target, [...(near.get(l.target) ?? []), l.source]);
	}
	const place = new Map<string, { lane: number; col: number; y: number }>();
	const measure = () => {
		cells.forEach((cols, li) =>
			cols.forEach((c, ci) =>
				c.forEach((id, ri) =>
					place.set(id, { lane: li, col: ci, y: laneTop[li] + ri * (G.nodeH + G.rowGap) })
				)
			)
		);
	};
	const columns = cells[0]?.length ?? 0;
	for (let sweep = 0; sweep < 4; sweep++) {
		const forward = sweep % 2 === 0;
		const order = Array.from({ length: columns }, (_, i) => (forward ? i : columns - 1 - i));
		for (const ci of order) {
			measure();
			for (const cols of cells) {
				const c = cols[ci];
				if (c.length < 2) continue;
				const score = new Map<string, number>();
				c.forEach((id) => {
					const own = place.get(id)!;
					if (!near.has(id)) return score.set(id, Number.MAX_SAFE_INTEGER);
					const ys = near
						.get(id)!
						.map((n) => place.get(n))
						.filter((p) => p && p.lane === own.lane && (forward ? p.col < ci : p.col > ci))
						.map((p) => p!.y);
					// With nothing to lean towards, a place keeps its height.
					score.set(id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : own.y);
				});
				const before = new Map(c.map((id, i) => [id, i]));
				c.sort((a, b) => score.get(a)! - score.get(b)! || before.get(a)! - before.get(b)!);
			}
		}
	}
}

type Box = { x: number; y: number; w: number; h: number };

/** A smooth line from one box to another, leaving and arriving on the sides that face. */
function route(s: Box, t: Box): { d: string; mid: { x: number; y: number } } {
	const sy = s.y + s.h / 2;
	const ty = t.y + t.h / 2;
	let p0: [number, number];
	let p1: [number, number];
	let p2: [number, number];
	let p3: [number, number];
	if (t.x >= s.x + s.w) {
		p0 = [s.x + s.w, sy];
		p3 = [t.x, ty];
		const dx = (p3[0] - p0[0]) / 2;
		p1 = [p0[0] + dx, sy];
		p2 = [p3[0] - dx, ty];
	} else if (t.x + t.w <= s.x) {
		p0 = [s.x, sy];
		p3 = [t.x + t.w, ty];
		const dx = (p0[0] - p3[0]) / 2;
		p1 = [p0[0] - dx, sy];
		p2 = [p3[0] + dx, ty];
	} else {
		// Same column: bow out to the right so the line clears the boxes between.
		const x = Math.max(s.x + s.w, t.x + t.w);
		const bow = 36 + Math.min(48, Math.abs(ty - sy) / 6);
		p0 = [s.x + s.w, sy];
		p3 = [t.x + t.w, ty];
		p1 = [x + bow, sy];
		p2 = [x + bow, ty];
	}
	const r = (n: number) => Math.round(n * 10) / 10;
	const d = `M${r(p0[0])},${r(p0[1])} C${r(p1[0])},${r(p1[1])} ${r(p2[0])},${r(p2[1])} ${r(p3[0])},${r(p3[1])}`;
	const mid = {
		x: r((p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8),
		y: r((p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8)
	};
	return { d, mid };
}
