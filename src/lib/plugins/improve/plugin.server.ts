import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
	PLUGIN_API_VERSION,
	type ExecResult,
	type ProviderContext,
	type WheelhousePlugin
} from '../../server/plugins/types';
import type { Available } from '../../types';
import type { HarnessView, ImproveUi, ProposalSection } from './types';
import {
	buildHarness,
	parseChecks,
	parseLedger,
	parseRouted,
	proposalItem,
	readProposal,
	type Raw
} from './view';

/**
 * Improve: the captain's harness-improvement plugin for Claude Code, as it
 * studies this Firstmate home. On only while the home has improve's
 * `.harness/improve.json`, and silent unless its Firstmate adapter is enabled
 * there. It reads improve's state by running improve's own adapter CLI
 * (detect, import without --save, inventory, due, and dry runs of route and
 * decisions) and its proposal check, plus the proposal files under
 * `.harness/proposals/`; it never passes --apply or --save, and runs `due`
 * only when that cannot write (see dueIsReadOnly).
 */

const CLI = path.join('adapters', 'firstmate', 'cli.mjs');
const CHECK = path.join('scripts', 'proposal-check-cli.mjs');
const MAX_OUT = 8 * 1024 * 1024;
const RUN_MS = 8_000;
const DEFAULT_UI = 'http://127.0.0.1:5173';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `.harness/improve.json` turns the Firstmate adapter on. */
export function adapterEnabled(text: string | null): boolean {
	if (!text) return false;
	try {
		const v = JSON.parse(text);
		return isRecord(v) && isRecord(v.adapters) && isRecord(v.adapters.firstmate)
			? v.adapters.firstmate.enabled === true
			: false;
	} catch {
		return false;
	}
}

/**
 * Where improve's adapter CLI may be, in order: the `adapter` setting (the CLI
 * itself or an improve checkout), improve's installed copy as Claude Code
 * records it, then the improve clone in the home (`projects/improve`), for an
 * installed copy that predates the adapter. Relative paths are the home's.
 */
export function adapterCandidates(
	settings: Record<string, unknown>,
	env: NodeJS.ProcessEnv = process.env,
	read: (file: string) => string | null = readText
): string[] {
	const out: string[] = [];
	const set = settings.adapter;
	if (typeof set === 'string' && set.trim()) {
		out.push(set.endsWith('.mjs') ? set : path.join(set, CLI));
	}
	const config = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), '.claude');
	const installed = read(path.join(config, 'plugins', 'installed_plugins.json'));
	if (installed) {
		try {
			const v = JSON.parse(installed);
			const plugins = isRecord(v) && isRecord(v.plugins) ? v.plugins : {};
			for (const [k, installs] of Object.entries(plugins)) {
				if (!k.startsWith('improve@') || !Array.isArray(installs)) continue;
				for (const i of installs) {
					if (isRecord(i) && typeof i.installPath === 'string')
						out.push(path.join(i.installPath, CLI));
				}
			}
		} catch {
			// unreadable: fall through to the home's clone
		}
	}
	out.push(path.join('projects', 'improve', CLI));
	return out;
}

function readText(file: string): string | null {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

async function findAdapter(ctx: ProviderContext): Promise<string | null> {
	for (const c of adapterCandidates(ctx.settings)) {
		if (
			path.isAbsolute(c)
				? existsSync(c)
				: (await ctx.readFile(c, { root: 'home', maxBytes: 1 })) !== null
		)
			return c;
	}
	return null;
}

/** The home's absolute path, as improve's `detect` reports it. */
async function homeOf(ctx: ProviderContext, cli: string | null): Promise<string | null> {
	if (!cli) return null;
	const r = await ctx.exec({
		argv: [process.execPath, cli, 'detect', '--project', '.'],
		cwd: 'home',
		timeoutMs: RUN_MS,
		maxBytes: MAX_OUT
	});
	const d = json(r);
	return isRecord(d) && typeof d.home === 'string' ? d.home : null;
}

/** improve's checkout root, from its adapter CLI's path. */
const improveRoot = (cli: string) => path.dirname(path.dirname(path.dirname(cli)));

const json = (r: ExecResult): unknown => {
	try {
		return JSON.parse(r.stdout);
	} catch {
		return null;
	}
};
const why = (r: ExecResult) =>
	r.ok ? '' : (r.stderr.trim().split('\n')[0] || r.reason).replace(/\.$/, '');

/**
 * `due` records when periodic review started counting, or forgets it, the first
 * time it runs after periodic review is turned on or off. It writes nothing when
 * periodic review is on and the count has already started, so only then is it run.
 */
export function dueIsReadOnly(detect: unknown, reviewState: unknown): boolean {
	const p = isRecord(detect) && isRecord(detect.periodic_review) ? detect.periodic_review : null;
	const s = isRecord(reviewState) ? reviewState : {};
	return (
		isRecord(detect) &&
		detect.detected === true &&
		detect.enabled === true &&
		p?.enabled === true &&
		(typeof s.last_reviewed_at === 'string' || typeof s.enabled_at === 'string')
	);
}

/** Whether improve's own UI answers at `url`, and whether it opens a proposal by file. */
async function probeUi(
	url: string,
	signal: AbortSignal
): Promise<{ running: boolean; deepLinks: boolean }> {
	const ok = async (p: string) => {
		try {
			const r = await fetch(`${url}${p}`, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(800)]),
				redirect: 'manual'
			});
			return r.ok;
		} catch {
			return false;
		}
	};
	// The redesigned review UI has /api/health and /proposals?p=<file>; the first one only /api/status.
	if (await ok('/api/health')) return { running: true, deepLinks: true };
	if (await ok('/api/status')) return { running: true, deepLinks: false };
	return { running: false, deepLinks: false };
}

/** Where improve's UI is, from the `uiUrl` setting; only http(s), without a trailing slash. */
export function uiUrl(settings: Record<string, unknown>): string {
	const v = settings.uiUrl;
	if (typeof v === 'string') {
		try {
			const u = new URL(v);
			if (u.protocol === 'http:' || u.protocol === 'https:') return u.href.replace(/\/+$/, '');
		} catch {
			// not a URL: use the default
		}
	}
	return DEFAULT_UI;
}

const shq = (s: string) => (/^[\w./:=@-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** How to start improve's UI on 127.0.0.1 for this home, as one command line. */
export function startCommand(root: string, home: string, url: string): string {
	const port = new URL(url).port || '5173';
	return `cd ${shq(path.join(root, 'ui'))} && npm install && IMPROVE_PROJECT_DIR=${shq(home)} npx vite dev --host 127.0.0.1 --port ${port}`;
}

async function ui(
	ctx: ProviderContext,
	cli: string | null,
	home: string | null
): Promise<ImproveUi> {
	const url = uiUrl(ctx.settings);
	const { running, deepLinks } = await probeUi(url, ctx.signal);
	const root = cli && home ? improveRoot(path.isAbsolute(cli) ? cli : path.join(home, cli)) : null;
	return {
		url,
		running,
		deepLinks,
		start: running || !root || !home ? null : startCommand(root, home, url)
	};
}

async function harness(ctx: ProviderContext): Promise<Available<HarnessView>> {
	const config = await ctx.readFile('.harness/improve.json', { root: 'home', maxBytes: 64 * 1024 });
	if (!adapterEnabled(config)) {
		return { available: false, reason: 'improve’s Firstmate adapter is off in this home.' };
	}
	const cli = await findAdapter(ctx);
	const problems: string[] = [];
	const run = (args: string[]): Promise<ExecResult> =>
		cli
			? ctx.exec({
					argv: [process.execPath, cli, ...args, '--project', '.'],
					cwd: 'home',
					timeoutMs: RUN_MS,
					maxBytes: MAX_OUT
				})
			: Promise.resolve({ ok: false, reason: 'no adapter', stdout: '', stderr: '' });
	if (!cli) {
		problems.push(
			'Wheelhouse could not find improve’s Firstmate adapter. Set plugins.improve.settings.adapter to improve’s checkout.'
		);
	}

	const [detectR, importR, inventoryR, routeR, decisionsR, names, stateText] = await Promise.all([
		run(['detect']),
		run(['import']),
		run(['inventory']),
		run(['route']),
		run(['decisions']),
		ctx.listDir('.harness/proposals', { root: 'home' }),
		ctx.readFile('.harness/firstmate/review-state.json', { root: 'home', maxBytes: 64 * 1024 })
	]);
	const detect = json(detectR);
	let reviewState: unknown = null;
	try {
		reviewState = stateText ? JSON.parse(stateText) : null;
	} catch {
		reviewState = null;
	}
	if (cli && !isRecord(detect)) problems.push(`improve could not be read: ${why(detectR)}.`);
	else if (isRecord(detect) && detect.detected !== true)
		problems.push('improve does not recognise this home as a Firstmate home.');
	if (cli && !importR.ok)
		problems.push(`improve could not read the home’s records: ${why(importR)}.`);

	const files = (names ?? []).filter((n) => /\.ya?ml$/i.test(n));
	const home = isRecord(detect) && typeof detect.home === 'string' ? detect.home : null;
	const [dueR, checkR, texts, uiState] = await Promise.all([
		dueIsReadOnly(detect, reviewState) ? run(['due']) : Promise.resolve(null),
		cli && files.length
			? ctx.exec({
					argv: [
						process.execPath,
						path.join(improveRoot(cli), CHECK),
						...files.map((f) => `.harness/proposals/${f}`)
					],
					cwd: 'home',
					timeoutMs: RUN_MS,
					maxBytes: MAX_OUT
				})
			: Promise.resolve(null),
		Promise.all(
			files.map((f) =>
				ctx.readFile(`.harness/proposals/${f}`, { root: 'home', maxBytes: 64 * 1024 })
			)
		),
		ui(ctx, cli, home)
	]);

	const routeOut = json(routeR);
	const raw: Raw = {
		detect,
		observations: json(importR),
		inventory: json(inventoryR),
		route: Array.isArray(routeOut)
			? { ok: true, entries: routeOut }
			: { ok: false, reason: cli ? `${why(routeR)}.` : 'improve’s adapter was not found.' },
		routed: decisionsR.ok
			? parseRouted(json(decisionsR))
			: parseLedger(
					await ctx.readFile('.harness/firstmate/routed.json', {
						root: 'home',
						maxBytes: 64 * 1024
					})
				),
		proposals: files.map((file, i) => ({ file, text: texts[i] })),
		checks: checkR ? parseChecks(checkR.stdout) : {},
		reviewState,
		due: dueR ? json(dueR) : null,
		tasks: ctx.tasks,
		ui: uiState,
		problems,
		now: Date.now()
	};
	return {
		available: true,
		value: buildHarness(raw),
		source: 'improve’s Firstmate adapter',
		observedAt: new Date().toISOString()
	};
}

async function proposal(ctx: ProviderContext): Promise<Available<ProposalSection>> {
	const none = (reason: string) => ({ available: false as const, reason });
	const task = ctx.task;
	if (!task?.id.startsWith('improve-')) return none('This task is not an improve proposal.');
	const config = await ctx.readFile('.harness/improve.json', { root: 'home', maxBytes: 64 * 1024 });
	if (!adapterEnabled(config)) return none('improve’s Firstmate adapter is off in this home.');
	const ledger = parseLedger(
		await ctx.readFile('.harness/firstmate/routed.json', { root: 'home', maxBytes: 64 * 1024 })
	);
	const routed = ledger.find((r) => r.taskId === task.id);
	if (!routed) return none('improve has no proposal filed as this task.');
	const rel = `.harness/proposals/${routed.file}`;
	const cli = await findAdapter(ctx);
	const [text, checkR, uiState] = await Promise.all([
		ctx.readFile(rel, { root: 'home', maxBytes: 64 * 1024 }),
		cli
			? ctx.exec({
					argv: [process.execPath, path.join(improveRoot(cli), CHECK), rel],
					cwd: 'home',
					timeoutMs: RUN_MS,
					maxBytes: MAX_OUT
				})
			: Promise.resolve(null),
		ui(ctx, cli, await homeOf(ctx, cli))
	]);
	const item = proposalItem(readProposal(routed.file, text), {
		check: checkR ? (parseChecks(checkR.stdout)[routed.file] ?? null) : null,
		routed,
		route: null,
		tasks: [task],
		ui: uiState
	});
	return {
		available: true,
		value: {
			schema: 'wheelhouse-improve-proposal.v1',
			proposal: item,
			improvementsHref: `/plugins/improve/improvements#${encodeURIComponent(routed.file)}`,
			ui: uiState
		},
		source: 'improve’s proposal file',
		observedAt: new Date().toISOString()
	};
}

export const improve: WheelhousePlugin = {
	apiVersion: PLUGIN_API_VERSION,
	id: 'improve',
	name: 'Improve',
	version: '0.1.0',
	enabledWhenHomeFile: '.harness/improve.json',
	providers: [
		{ id: 'harness', scope: 'fleet', ttlMs: 30_000, timeoutMs: 10_000, fetch: harness },
		{ id: 'proposal', scope: 'task', ttlMs: 30_000, timeoutMs: 9_000, fetch: proposal }
	],
	contributions: [
		{
			slot: 'nav.page',
			id: 'improvements',
			title: 'Improvements',
			provider: 'harness',
			when: 'provider-available',
			render: { component: 'improve/improvements' }
		},
		{
			slot: 'home.card',
			id: 'health',
			title: 'Harness',
			provider: 'harness',
			when: 'provider-available',
			badge: (v) => (v as HarnessView).waiting,
			render: { component: 'improve/health' }
		},
		{
			slot: 'header.indicator',
			id: 'indicator',
			title: 'Harness',
			provider: 'harness',
			when: 'provider-available',
			render: { component: 'improve/indicator' }
		},
		{
			slot: 'task.section',
			id: 'proposal',
			title: 'Improvement',
			provider: 'proposal',
			when: 'provider-available',
			placement: { order: 10 },
			render: { component: 'improve/proposal' }
		}
	]
};
