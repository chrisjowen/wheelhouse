import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBounded, type RunOptions, type RunResult } from './firstmate/exec';
import { which } from './sessions/tmux';
import { getRuntime } from './runtime';
import { parseMateTaskId } from './firstmate/matetasks';
import { grokSignInFile, resolveHelperProgram } from './helperprogram';
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
 * the captain sends about a task's preview is answered by one headless run
 * that is given only that task: its page's text, the part pointed at, its
 * screenshots (which it may read, and nothing else), its instructions from
 * Firstmate's backlog and its history from the fleet ledger. It answers in a
 * fixed JSON shape and never writes, sends or runs anything: the feedback
 * list stays with the captain.
 *
 * Claude Code (`claude -p`) keeps no session and loads no settings, tools or
 * MCP servers beyond reading files. Grok, checked against 1.0.77, has no
 * flags that do the same. Wheelhouse runs it in a throwaway GROK_HOME that
 * holds only a copy of the sign-in, with a private leader socket,
 * `--permission-mode default`, `--sandbox read-only`, and a tool list that
 * allows only reading a file (or nothing, for a summary). The home is
 * deleted when the run ends, which is how the conversation is removed: Grok
 * has no `--no-session-persistence`, so a crash before that delete can leave
 * the folder in the temp directory, not in the user's own sessions.
 * `--add-dir` is refused, so screenshots are copied into the run's folder.
 * `--sandbox read-only` can still read files outside that folder. A built-in
 * sandbox that cannot be enforced continues without it, and that answer is
 * refused. Plugins, hooks and connected tools in the user's Grok home are
 * not copied across. A requirements pin outside that home, where the machine
 * has one, can still apply, and the child-process network block is Linux.
 *
 * Which program runs for preview help and feedback summaries is `helper` in
 * harness.json: `claude` or `grok`, whatever agent Firstmate runs in. No
 * field, or any other value, stays on Claude Code. Live review and soundings
 * stay on Claude Code and pass their own model and time limit.
 *
 * The same run, with its own instructions and shape and no tools, tidies a
 * plugin's feedback list into points before the captain sends it
 * (`summariseFeedback`, for a shared review's comments, say).
 *
 * `WHEELHOUSE_PREVIEW_CLAUDE` names Claude's binary (default: `claude` on
 * PATH). `WHEELHOUSE_PREVIEW_MODEL` names the model (Claude's default:
 * sonnet; Grok's default: grok-4.7). A value set for one is passed to
 * whichever program runs.
 */

const TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 3_000;
const PAGE_MAX_BYTES = 512 * 1024;
const HISTORY_MAX = 30;

/**
 * A helper run's instructions and answer shape, whether it may read files,
 * and, for a run that must answer quickly (a live review's scribe), its own
 * model and time limit.
 */
export interface Run {
	system: string;
	schema: object;
	read?: boolean;
	model?: string;
	timeoutMs?: number;
}

export type HelperFailure = { ok: false; status: 404 | 409 | 502 | 503; error: string };

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

/** Grok's helper model when WHEELHOUSE_PREVIEW_MODEL is unset. Checked against Grok 1.0.77. */
export const GROK_HELPER_MODEL = 'grok-4.7';

const CLAUDE_MISSING =
	'Claude Code (`claude`) is not installed or not on PATH, so the preview helper cannot answer.';
const GROK_MISSING =
	'Grok (`grok`) is not installed or not on PATH, so the preview helper cannot answer.';
const SANDBOX_OPEN =
	'The preview helper’s sandbox was not enforced, so its answer was not used. Try again.';

/** Tools the helper must not have. An empty `--tools` does not clear Grok's list (1.0.77). */
const GROK_DENIED = [
	'run_terminal_cmd',
	'run_terminal_command',
	'write',
	'search_replace',
	'web_search',
	'web_fetch',
	'task',
	'Agent',
	'CallMcpTool',
	'GetMcpTools',
	'FetchMcpResource',
	'ListMcpResources',
	'search_tool',
	'use_tool',
	'image_gen',
	'image_edit',
	'workflow',
	'Execute',
	'grep',
	'list_dir'
];

/**
 * The grok arguments for one answer, checked against Grok 1.0.77. The prompt
 * is a file (a page is too long for the command line). Reading is `read_file`
 * only; a summary disallows that too. No `--add-dir`: this Grok refuses it.
 */
export function grokArgs(
	model: string,
	promptFile: string,
	socket: string,
	o: Run = { system: HELPER_SYSTEM, schema: HELPER_SCHEMA }
): string[] {
	const read = o.read !== false;
	const denied = read ? GROK_DENIED : ['read_file', ...GROK_DENIED];
	const system = read ? o.system.replace('the Read tool', 'your file-reading tool') : o.system;
	return [
		'--leader-socket',
		socket,
		'--prompt-file',
		promptFile,
		'-m',
		model,
		'--reasoning-effort',
		'low',
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(o.schema),
		'--system-prompt-override',
		system,
		'--permission-mode',
		'default',
		'--sandbox',
		'read-only',
		'--no-subagents',
		'--disable-web-search',
		'--no-auto-update',
		'--max-turns',
		read ? '6' : '2',
		'--verbatim',
		'--tools',
		'read_file',
		'--disallowed-tools',
		denied.join(','),
		'--deny',
		'Bash',
		'--deny',
		'Edit',
		'--deny',
		'Write',
		'--deny',
		'WebFetch',
		'--deny',
		'MCPTool',
		...(read ? [] : ['--deny', 'Read'])
	];
}

/** A built-in sandbox that fails to apply continues without enforcement (Grok's own guide). */
const sandboxGaveWay = (stderr: string) => /without enforcement/i.test(stderr);

/** Copy screenshots into `work` and point the prompt at the copies. A copy that fails keeps its path. */
function stageShots(work: string, prompt: string, shots: { file: string }[]): string {
	if (!shots.length) return prompt;
	const dir = path.join(work, 'shots');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const pairs: { from: string; to: string }[] = [];
	shots.forEach((shot, index) => {
		const base =
			path
				.basename(shot.file)
				.replace(/[^A-Za-z0-9._-]/g, '_')
				.slice(0, 80) || 'shot';
		const dest = path.join(dir, `${index}-${base}`);
		try {
			copyFileSync(shot.file, dest);
			pairs.push({ from: shot.file, to: dest });
		} catch {
			// The page text is still there. The original path is left as written.
		}
	});
	pairs.sort((a, b) => b.from.length - a.from.length);
	let out = prompt;
	for (const pair of pairs) out = out.split(pair.from).join(pair.to);
	return out;
}

const removeTree = (root: string) => {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		spawnSync('chmod', ['-R', 'u+rwX', root], { stdio: 'ignore' });
		try {
			rmSync(root, { recursive: true, force: true });
		} catch {
			// Left in the temp directory. It is not the user's Grok sessions.
		}
	}
};

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
		brief: runtime.collector.backlog(task.id)?.body ?? null,
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

const failedRun = (
	r: Extract<RunResult, { ok: false }>
): { ok: false; status: 502; error: string } => ({
	ok: false,
	status: 502,
	error:
		r.kind === 'timeout'
			? 'The preview helper took too long to answer. Try again.'
			: 'The preview helper could not answer. Try again.'
});

/**
 * One Claude run: `input` on standard input, answering in `o`'s shape.
 * Screenshots stay where they are; `--add-dir` names their folders.
 * Live review and soundings call this. Preview help and feedback summaries
 * go through `runChosen`, which can run Grok instead.
 */
export async function runHelper(
	input: string,
	dirs: string[],
	o: Run,
	deps: HelperDeps
): Promise<{ ok: true; stdout: string } | HelperFailure> {
	const bin = deps.env.WHEELHOUSE_PREVIEW_CLAUDE || deps.find('claude');
	if (!bin) return { ok: false, status: 503, error: CLAUDE_MISSING };
	const r = await deps.run(
		bin,
		helperArgs(o.model || deps.env.WHEELHOUSE_PREVIEW_MODEL || 'sonnet', dirs, o),
		{
			cwd: tmpdir(),
			env: deps.env,
			input,
			timeoutMs: o.timeoutMs ?? TIMEOUT_MS,
			maxOutputBytes: 1024 * 1024
		}
	);
	if (!r.ok) return failedRun(r);
	return { ok: true, stdout: r.stdout };
}

/** The Claude runner under the name preview help uses when it stays on Claude Code. */
async function runClaude(
	input: string,
	dirs: string[],
	o: Run,
	deps: HelperDeps
): Promise<{ ok: true; stdout: string } | HelperFailure> {
	return runHelper(input, dirs, o, deps);
}

/**
 * One Grok run in a throwaway home. The prompt is a file in the run's folder,
 * and screenshots are copies there. The home, the prompt and the copies are
 * removed when the run returns, including when it fails.
 */
async function runGrok(
	input: string,
	shots: { file: string }[],
	o: Run,
	deps: HelperDeps
): Promise<{ ok: true; stdout: string } | HelperFailure> {
	const bin = deps.find('grok');
	if (!bin) return { ok: false, status: 503, error: GROK_MISSING };
	const root = mkdtempSync(path.join(tmpdir(), 'wheelhouse-helper-'));
	try {
		const home = path.join(root, 'home');
		const work = path.join(root, 'work');
		mkdirSync(home, { mode: 0o700 });
		mkdirSync(work, { mode: 0o700 });
		const auth = grokSignInFile(deps.env);
		if (auth) {
			const dest = path.join(home, 'auth.json');
			copyFileSync(auth, dest);
			chmodSync(dest, 0o600);
		}
		const promptFile = path.join(work, 'prompt.txt');
		writeFileSync(promptFile, stageShots(work, input, shots), { mode: 0o600 });
		const socket = path.join(root, 'leader.sock');
		const env: NodeJS.ProcessEnv = {
			...deps.env,
			GROK_HOME: home,
			GROK_MEMORY: '0',
			GROK_DISABLE_AUTOUPDATER: '1',
			GROK_CLAUDE_HOOKS_ENABLED: '0',
			GROK_CLAUDE_MCPS_ENABLED: '0',
			GROK_CURSOR_HOOKS_ENABLED: '0',
			GROK_CURSOR_MCPS_ENABLED: '0',
			GROK_SANDBOX: 'read-only'
		};
		delete env.GROK_ALWAYS_APPROVE;
		delete env.GROK_CONFIG;
		delete env.GROK_CONFIG_PATH;
		const r = await deps.run(
			bin,
			[
				'--cwd',
				work,
				...grokArgs(
					o.model || deps.env.WHEELHOUSE_PREVIEW_MODEL || GROK_HELPER_MODEL,
					promptFile,
					socket,
					o
				)
			],
			{ cwd: work, env, timeoutMs: o.timeoutMs ?? TIMEOUT_MS, maxOutputBytes: 1024 * 1024 }
		);
		if (sandboxGaveWay(r.stderr)) return { ok: false, status: 502, error: SANDBOX_OPEN };
		if (!r.ok) return failedRun(r);
		return { ok: true, stdout: r.stdout };
	} finally {
		removeTree(root);
	}
}

/** Preview help and feedback summaries: Claude Code, or Grok when harness.json says so. */
async function runChosen(
	input: string,
	shots: { file: string }[],
	dirs: string[],
	o: Run,
	deps: HelperDeps
): Promise<{ ok: true; stdout: string } | HelperFailure> {
	const plan = resolveHelperProgram(deps.env, deps.find);
	return plan.runs === 'grok' ? runGrok(input, shots, o, deps) : runClaude(input, dirs, o, deps);
}

/** One helper run over a gathered context. */
export async function ask(
	ctx: HelperContext,
	req: HelperRequest,
	deps: HelperDeps = defaults()
): Promise<HelperResult> {
	const dirs = [...new Set(ctx.screenshots.map((s) => path.dirname(s.file)))];
	const r = await runChosen(
		helperPrompt(ctx, req),
		ctx.screenshots,
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
	const r = await runChosen(
		summaryPrompt(req),
		[],
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
