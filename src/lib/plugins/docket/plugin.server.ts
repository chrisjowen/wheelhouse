import path from 'node:path';
import type { Available, Project, TaskSummary } from '../../types';
import {
	PLUGIN_API_VERSION,
	type ProviderContext,
	type WheelhousePlugin
} from '../../server/plugins/types';
import { parseGraph } from './graph';
import { hazardsOf, joinFiles } from './join';
import type { ChartData, DocketGraph, HazardsData, NoDocket, Vessel, WatersData } from './types';

/**
 * Docket: a read-only chart of a project's system, read from the project's own
 * docket (`.docket/`, see github.com/chrisjowen/team-memory) by running
 * `docket graph --json`. It fills the project's Chart tab, "Waters this
 * passage crosses" on task pages and "Hazards ahead" on the Harbour when a
 * task under way touches restricted waters. It never writes to `.docket/`.
 *
 * Settings (plugins.json, `plugins.docket.settings`), all optional:
 *   bin    absolute path of the docket CLI. Otherwise `docket` on PATH.
 *   roots  { "<project id>": "<absolute dir>" }: read that docket for the
 *          project instead of the clone's own, e.g. docket's example
 *          examples/acme-platform until a project keeps one.
 *   timeoutMs  how long `docket graph` may take (default 8000, at most 9500).
 */

const DOCKET_FILE = '.docket.yaml';
const GRAPH_TIMEOUT_MS = 8_000;
const MAX_GRAPH_TIMEOUT_MS = 9_500;
const GRAPH_MAX_BYTES = 8 * 1024 * 1024;
/** One graph read is shared by every provider that asks within this long. */
const GRAPH_TTL_MS = 20_000;
/** Provider values stay under the registry's 256 KiB limit. */
const MAX_VALUE_CHARS = 240 * 1024;

export const CHART_TAB = 'docket/chart';

export const chartHref = (projectId: string, vessel?: string) =>
	`/?project=${encodeURIComponent(projectId)}&tab=${encodeURIComponent(CHART_TAB)}${
		vessel ? `&vessel=${encodeURIComponent(vessel)}` : ''
	}`;

export interface DocketSettings {
	bin: string | null;
	roots: Record<string, string>;
	timeoutMs: number;
}

/** The plugin's settings, keeping only absolute paths. */
export function readSettings(raw: Record<string, unknown>): DocketSettings {
	const abs = (v: unknown): v is string => typeof v === 'string' && path.isAbsolute(v);
	const roots: Record<string, string> = {};
	if (typeof raw.roots === 'object' && raw.roots !== null && !Array.isArray(raw.roots)) {
		for (const [k, v] of Object.entries(raw.roots)) if (abs(v)) roots[k] = v;
	}
	const t = raw.timeoutMs;
	const timeoutMs =
		typeof t === 'number' && Number.isFinite(t)
			? Math.min(Math.max(Math.round(t), 100), MAX_GRAPH_TIMEOUT_MS)
			: GRAPH_TIMEOUT_MS;
	return { bin: abs(raw.bin) ? raw.bin : null, roots, timeoutMs };
}

type Read =
	| { kind: 'none' }
	| { kind: 'error'; reason: string }
	| { kind: 'ok'; graph: DocketGraph; root: string; configured: boolean; at: string };

const reads = new Map<string, { at: number; value: Promise<Read> }>();

/** Why `docket graph` failed, in plain words, or null when it found no docket. */
export function explainFailure(
	bin: string,
	r: { reason: string; stderr: string },
	timeoutMs = GRAPH_TIMEOUT_MS
): string | null {
	const err = r.stderr.trim();
	if (/No \.docket\.yaml found/i.test(err)) return null;
	if (/unknown (command ['"]?graph|option ['"]?--json)/i.test(err)) {
		return `The docket CLI (${bin}) is too old for the Chart. Update docket.`;
	}
	if (/ENOENT/.test(r.reason)) {
		return `Wheelhouse could not find the docket CLI (${bin}). Install docket, or set "bin" in the docket plugin's settings.`;
	}
	if (/EACCES/.test(r.reason)) {
		return `Wheelhouse could not run the docket CLI (${bin}): it is not executable.`;
	}
	if (/timed out/.test(r.reason)) {
		return `docket did not answer within ${timeoutMs / 1000} s.`;
	}
	if (/output exceeded/.test(r.reason)) {
		return 'This docket is too large for Wheelhouse to chart.';
	}
	const first = err.split('\n').find((l) => l.trim());
	return `docket could not read the graph (${r.reason}${first ? `: ${first.slice(0, 200)}` : ''}).`;
}

/** The project's docket graph, read once and shared for a few seconds. */
function readGraph(ctx: ProviderContext, project: Project): Promise<Read> {
	const settings = readSettings(ctx.settings);
	const configured = settings.roots[project.id] ?? null;
	const key = `${project.id}\n${project.path}\n${configured}\n${settings.bin}\n${settings.timeoutMs}`;
	const hit = reads.get(key);
	const now = Date.now();
	if (hit && now - hit.at < GRAPH_TTL_MS) return hit.value;
	const value = (async (): Promise<Read> => {
		if (!project.path) {
			return { kind: 'error', reason: 'Firstmate has not recorded a clone for this project.' };
		}
		if (!configured) {
			const marker = await ctx.readFile(DOCKET_FILE, {
				root: 'project',
				maxBytes: 1,
				project: project.id
			});
			if (marker === null) return { kind: 'none' };
		}
		const root = configured ?? project.path;
		const bin = settings.bin ?? 'docket';
		const r = await ctx.exec({
			argv: [bin, 'graph', '--json', '--root', root],
			cwd: 'project',
			project: project.id,
			timeoutMs: settings.timeoutMs,
			maxBytes: GRAPH_MAX_BYTES
		});
		if (!r.ok) {
			const reason = explainFailure(bin, r, settings.timeoutMs);
			return reason === null ? { kind: 'none' } : { kind: 'error', reason };
		}
		const parsed = parseGraph(r.stdout);
		if (!parsed.ok) return { kind: 'error', reason: parsed.reason };
		return {
			kind: 'ok',
			graph: parsed.graph,
			root,
			configured: configured !== null,
			at: new Date().toISOString()
		};
	})();
	reads.set(key, { at: now, value });
	void value.then((v) => {
		if (v.kind === 'error' && reads.get(key)?.value === value) reads.delete(key);
	});
	for (const [k, e] of reads) if (now - e.at >= GRAPH_TTL_MS) reads.delete(k);
	return value;
}

/** Forget shared graph reads (tests). */
export function clearDocketCache(): void {
	reads.clear();
}

const sourceOf = (r: Extract<Read, { kind: 'ok' }>) =>
	r.configured
		? `the docket at ${r.root}, set in Wheelhouse’s plugins file`
		: 'the project’s docket';

/** A path as one shell word, for a command the captain copies. */
const shellWord = (s: string) => (/^[\w./@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Tasks still under way: dispatched and not landed. */
export const underWay = (t: TaskSummary) => t.status !== 'queued' && t.status !== 'landed';

const stepOf = (t: TaskSummary) => t.passage?.steps[t.passage.current]?.label ?? t.statusLabel;

/** Where each task under way sits on the chart. */
async function vessels(
	ctx: ProviderContext,
	graph: DocketGraph
): Promise<{ vessels: Vessel[]; unplaced: number }> {
	const active = ctx.tasks.filter(underWay);
	const files = await Promise.all(active.map((t) => ctx.changedFiles(t.id)));
	const out: Vessel[] = [];
	let unplaced = 0;
	active.forEach((t, i) => {
		const f = files[i];
		const join = f ? joinFiles(graph, f) : null;
		if (!join || !join.touched.length) {
			unplaced++;
			return;
		}
		out.push({
			taskId: t.id,
			title: t.title,
			step: stepOf(t),
			status: t.statusLabel,
			touched: join.touched.map((x) => x.id),
			hazards: hazardsOf(join).map((h) => h.id)
		});
	});
	return { vessels: out, unplaced };
}

/** The value as the page gets it, trimmed until it fits. */
function fit(chart: ChartData): ChartData | null {
	const size = (c: ChartData) => JSON.stringify(c).length;
	if (size(chart) <= MAX_VALUE_CHARS) return chart;
	const g = chart.graph;
	const slim: ChartData = {
		...chart,
		graph: {
			...g,
			exhibits: g.exhibits.map((x) => ({ ...x, summary: null, evidence: x.evidence.slice(0, 3) })),
			links: g.links.map((l) => ({ ...l, evidence: l.evidence.slice(0, 2) }))
		}
	};
	return size(slim) <= MAX_VALUE_CHARS ? slim : null;
}

async function chart(ctx: ProviderContext): Promise<Available<ChartData | NoDocket>> {
	const project = ctx.project!;
	const r = await readGraph(ctx, project);
	if (r.kind === 'none') {
		return {
			available: true,
			value: { state: 'no-docket' },
			source: 'the project clone',
			observedAt: new Date().toISOString()
		};
	}
	if (r.kind === 'error') return { available: false, reason: r.reason };
	const v = await vessels(ctx, r.graph);
	const value = fit({
		state: 'chart',
		graph: r.graph,
		...v,
		configuredRoot: r.configured ? r.root : null,
		openCommand: `docket open --root ${shellWord(r.root)}`
	});
	if (!value) {
		return {
			available: false,
			reason: `This docket (${r.graph.exhibits.length} exhibits) is too large to chart here; browse it with docket open.`
		};
	}
	return { available: true, value, source: sourceOf(r), observedAt: r.at };
}

async function waters(ctx: ProviderContext): Promise<Available<WatersData>> {
	const task = ctx.task!;
	const project = ctx.project;
	if (!project) return { available: false, reason: 'The task’s project is not known.' };
	const r = await readGraph(ctx, project);
	if (r.kind === 'none') return { available: false, reason: 'This project keeps no docket.' };
	if (r.kind === 'error') {
		return {
			available: true,
			value: { state: 'unreadable', reason: r.reason },
			source: 'the project’s docket',
			observedAt: null
		};
	}
	const files = await ctx.changedFiles(task.id);
	if (!files) {
		return { available: false, reason: 'Wheelhouse cannot read this task’s changed files.' };
	}
	const join = joinFiles(r.graph, files);
	const titles = new Map(r.graph.exhibits.map((x) => [x.id, x]));
	const named = new Set<string>([
		...join.touched.map((x) => x.id),
		...[...join.touchedLinks, ...join.nearby, ...join.dependents].flatMap((l) => [
			l.source,
			l.target
		]),
		...join.restricted.flatMap((x) => [x.id, ...x.appliesTo]),
		...join.notices.flatMap((x) => [x.id, ...x.appliesTo])
	]);
	const exhibits: Record<string, { title: string; type: string }> = {};
	for (const id of named) {
		const x = titles.get(id);
		exhibits[id] = { title: x?.title ?? id, type: x?.type ?? 'unknown' };
	}
	return {
		available: true,
		value: { state: 'waters', join, exhibits, chartHref: chartHref(project.id, task.id) },
		source: `${sourceOf(r)}, matched against this task’s changed files`,
		observedAt: r.at
	};
}

async function hazards(ctx: ProviderContext): Promise<Available<HazardsData>> {
	const project = ctx.project!;
	const r = await readGraph(ctx, project);
	if (r.kind !== 'ok') {
		return {
			available: false,
			reason: r.kind === 'none' ? 'This project keeps no docket.' : r.reason
		};
	}
	const titles = new Map(r.graph.exhibits.map((x) => [x.id, x.title]));
	const title = (id: string) => ({ id, title: titles.get(id) ?? id });
	const out: HazardsData['hazards'] = [];
	for (const t of ctx.tasks.filter(underWay)) {
		const files = await ctx.changedFiles(t.id);
		if (!files) continue;
		const found = hazardsOf(joinFiles(r.graph, files));
		if (!found.length) continue;
		out.push({
			taskId: t.id,
			title: t.title,
			step: stepOf(t),
			exhibits: [...new Set(found.flatMap((h) => h.appliesTo))].map(title),
			restrictions: found.map((h) => title(h.id))
		});
	}
	if (!out.length)
		return { available: false, reason: 'No task under way is in restricted waters.' };
	return {
		available: true,
		value: { hazards: out, chartHref: chartHref(project.id) },
		source: `${sourceOf(r)}, matched against changed files of tasks under way`,
		observedAt: r.at
	};
}

export const docket: WheelhousePlugin = {
	apiVersion: PLUGIN_API_VERSION,
	id: 'docket',
	name: 'Docket',
	version: '0.1.0',
	enabledWhenFile: DOCKET_FILE,
	providers: [
		{ id: 'chart', scope: 'project', ttlMs: 30_000, timeoutMs: 10_000, fetch: chart },
		{ id: 'hazards', scope: 'project', ttlMs: 30_000, timeoutMs: 10_000, fetch: hazards },
		{ id: 'waters', scope: 'task', ttlMs: 30_000, timeoutMs: 10_000, fetch: waters }
	],
	contributions: [
		{
			slot: 'project.tab',
			id: 'chart',
			title: 'Chart',
			provider: 'chart',
			render: { component: 'docket/chart' }
		},
		{
			slot: 'harbour.card',
			id: 'hazards',
			title: 'Hazards ahead',
			provider: 'hazards',
			when: 'provider-available',
			placement: { order: 100 },
			render: { component: 'docket/hazards' }
		},
		{
			slot: 'task.section',
			id: 'waters',
			title: 'Waters this passage crosses',
			provider: 'waters',
			when: 'provider-available',
			placement: { step: 'building' },
			render: { component: 'docket/waters' }
		}
	]
};
