import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBounded, type RunOptions, type RunResult } from './firstmate/exec';
import { which } from './sessions/tmux';
import { getRuntime } from './runtime';
import { parseMateTaskId } from './firstmate/matetasks';
import { loopbackPreview } from '../preview';
import { plainStatus } from '../plain';
import {
	HELPER_SCHEMA,
	HELPER_SYSTEM,
	SUMMARY_SCHEMA,
	SUMMARY_SYSTEM,
	helperPrompt,
	pageText,
	readReply,
	readSummary,
	summaryPrompt,
	type HelperContext,
	type HelperReply,
	type HelperRequest,
	type SummaryPoint,
	type SummaryRequest
} from '../previewhelper';

/**
 * The preview helper's other half (see lib/previewhelper.ts): each message
 * the captain sends about a task's preview is answered by one headless
 * Claude run (`claude -p`) that is given only that task: its page's text, the
 * part pointed at, its screenshots (which it may read, and nothing else), its
 * instructions from Firstmate's backlog and its history from the fleet
 * ledger. The run keeps no session and loads no settings, tools or MCP
 * servers beyond reading files, and answers in a fixed JSON shape. It never
 * writes, sends or runs anything: the feedback list stays with the captain.
 *
 * The same run, with its own instructions and shape and no tools,
 * tidies a plugin's feedback list into points before the captain sends it
 * (`summariseFeedback`, for a shared review's comments, say).
 *
 * `WHEELHOUSE_PREVIEW_CLAUDE` names the binary (default: `claude` on PATH),
 * and `WHEELHOUSE_PREVIEW_MODEL` the model (default: sonnet).
 */

const TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 3_000;
const PAGE_MAX_BYTES = 512 * 1024;
const HISTORY_MAX = 30;

/** A helper run's instructions and answer shape, and whether it may read files. */
interface Run {
	system: string;
	schema: object;
	read?: boolean;
}

type HelperFailure = { ok: false; status: 404 | 409 | 502 | 503; error: string };

export type HelperResult = { ok: true; value: HelperReply } | HelperFailure;

export type SummaryResult = { ok: true; points: SummaryPoint[] } | HelperFailure;

export interface HelperDeps {
	env: NodeJS.ProcessEnv;
	run: (file: string, args: string[], opts: RunOptions) => Promise<RunResult>;
	fetch: typeof fetch;
	find: (name: string) => string | null;
}

const defaults = (): HelperDeps => ({
	env: process.env,
	run: runBounded,
	fetch,
	find: (name) => which(name, process.env.PATH)
});

/**
 * The claude arguments for one answer: no session, no settings or MCP
 * servers, reading files only (in `dirs`), or no tools at all (`read: false`).
 * The preview helper's instructions and shape unless others are given (the
 * summary's).
 */
export function helperArgs(
	model: string,
	dirs: string[],
	o: Run = { system: HELPER_SYSTEM, schema: HELPER_SCHEMA }
): string[] {
	return [
		'-p',
		'--model',
		model,
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(o.schema),
		'--system-prompt',
		o.system,
		'--tools',
		o.read === false ? '' : 'Read',
		'--no-session-persistence',
		'--strict-mcp-config',
		'--setting-sources',
		'',
		...(dirs.length ? ['--add-dir', ...dirs] : [])
	];
}

/** The text of a loopback preview's page as served, or null when it cannot be read. */
export async function readPage(
	url: string,
	deps: Pick<HelperDeps, 'fetch'>
): Promise<string | null> {
	const target = loopbackPreview(url);
	if (!target.ok) return null;
	try {
		const r = await deps.fetch(target.url, {
			signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
			redirect: 'manual'
		});
		if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null;
		const body = await r.text();
		return pageText(body.slice(0, PAGE_MAX_BYTES));
	} catch {
		return null;
	}
}

/** Answer the captain's latest message about a task's preview. */
export async function answerAboutPreview(
	taskId: string,
	req: HelperRequest,
	deps: HelperDeps = defaults()
): Promise<HelperResult> {
	const runtime = await getRuntime();
	if (!runtime.configured) return { ok: false, status: 503, error: runtime.error };
	// A second mate's task: its page through the forward, and its status log as its history.
	if (parseMateTaskId(taskId)) {
		const m = await runtime.mateTasks.helperContext(taskId);
		if (!m.ok) return m;
		return ask(
			{
				task: m.task,
				preview: { url: m.preview, text: await readPage(m.preview, deps) },
				brief: null,
				history: m.history,
				screenshots: []
			},
			req,
			deps
		);
	}
	const fleet = runtime.collector.getFleet();
	const task = fleet.tasks.find((t) => t.id === taskId);
	if (!task) return { ok: false, status: 404, error: `There is no task called ${taskId}.` };
	if (!task.preview) {
		return { ok: false, status: 409, error: 'This task has no preview to talk about.' };
	}
	const ledger = runtime.collector.ledgerTask(task.id);
	const shots = await runtime.evidence.screenshots(task.id, ledger?.runIds ?? []).catch(() => []);
	const ctx: HelperContext = {
		task: {
			id: task.id,
			title: task.shortTitle,
			project: fleet.projects.find((p) => p.id === task.projectId)?.name ?? task.projectId,
			status: task.status
		},
		preview: { url: task.preview.url, text: await readPage(task.preview.url, deps) },
		brief: runtime.collector.backlog(task.id)?.bodyExcerpt ?? null,
		history: (ledger?.statuses ?? [])
			.slice(-HISTORY_MAX)
			.map(
				(s) =>
					`${new Date(s.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} ${plainStatus(s.state, s.text)}`
			),
		screenshots: shots.map((s) => ({ name: s.name, file: s.file }))
	};
	return ask(ctx, req, deps);
}

/**
 * One helper run: claude given `input`, answering in `o`'s shape; its
 * standard output, or why there is none.
 */
async function runHelper(
	input: string,
	dirs: string[],
	o: Run,
	deps: HelperDeps
): Promise<{ ok: true; stdout: string } | HelperFailure> {
	const bin = deps.env.WHEELHOUSE_PREVIEW_CLAUDE || deps.find('claude');
	if (!bin) {
		return {
			ok: false,
			status: 503,
			error:
				'Claude Code (`claude`) is not installed or not on PATH, so the preview helper cannot answer.'
		};
	}
	const r = await deps.run(
		bin,
		helperArgs(deps.env.WHEELHOUSE_PREVIEW_MODEL || 'sonnet', dirs, o),
		{
			cwd: tmpdir(),
			env: deps.env,
			input,
			timeoutMs: TIMEOUT_MS,
			maxOutputBytes: 1024 * 1024
		}
	);
	if (!r.ok) {
		return {
			ok: false,
			status: 502,
			error:
				r.kind === 'timeout'
					? 'The preview helper took too long to answer. Try again.'
					: 'The preview helper could not answer. Try again.'
		};
	}
	return { ok: true, stdout: r.stdout };
}

/** One helper run over a gathered context. */
export async function ask(
	ctx: HelperContext,
	req: HelperRequest,
	deps: HelperDeps = defaults()
): Promise<HelperResult> {
	const dirs = [...new Set(ctx.screenshots.map((s) => path.dirname(s.file)))];
	const r = await runHelper(
		helperPrompt(ctx, req),
		dirs,
		{ system: HELPER_SYSTEM, schema: HELPER_SCHEMA },
		deps
	);
	if (!r.ok) return r;
	const reply = readReply(r.stdout);
	if (!reply)
		return {
			ok: false,
			status: 502,
			error: 'The preview helper’s answer could not be read. Try again.'
		};
	// A line already on the list is not suggested again.
	const have = new Set(req.list.map((l) => l.toLowerCase()));
	return {
		ok: true,
		value: { reply: reply.reply, suggest: reply.suggest.filter((s) => !have.has(s.toLowerCase())) }
	};
}

/**
 * Tidy a feedback list into points for the worker (see SummaryRequest): one
 * helper run with no tools. It sends nothing; the caller shows the
 * points to the captain, who edits and picks them.
 */
export async function summariseFeedback(
	req: SummaryRequest,
	deps: HelperDeps = defaults()
): Promise<SummaryResult> {
	const r = await runHelper(
		summaryPrompt(req),
		[],
		{ system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA, read: false },
		deps
	);
	if (!r.ok) return r;
	const points = readSummary(r.stdout, req.items.length);
	if (!points) {
		return {
			ok: false,
			status: 502,
			error: 'The preview helper’s summary could not be read. Try again.'
		};
	}
	return { ok: true, points };
}
