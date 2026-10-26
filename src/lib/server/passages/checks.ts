import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COMMAND_BASE_ENV } from '../../passage-meta';
import { runBounded, type RunOptions, type RunResult } from '../firstmate/exec';
import { durationMs, GIT_REF, type CheckSpec, type CommitValue } from './schema';

/**
 * The built-in typed checks. Each takes typed parameters and builds its own
 * query: commits are 40-hex values Wheelhouse looked up itself and passes as
 * separate arguments, never text spliced into a user-written string. Every
 * check only observes: GitHub reads go through `gh api` (GET), npm and HTTP
 * checks are GET/HEAD with a timeout, a redirect limit and a body cap, and git
 * checks run read-only commands with --no-optional-locks.
 *
 * A check that cannot tell (an error, a timeout, a missing value) returns no
 * outcome, which the stage rules treat as unknown, never as "not reached".
 */

export interface CheckResult {
	/** The outcome observed, or null when the check could not tell. */
	outcome: string | null;
	/** Every outcome name that holds (npm: published, and latest when it is). */
	outcomes: string[];
	/** What it found, in plain words. */
	summary: string;
	url: string | null;
	/** Extra values other checks may use (a release's tag). */
	fields: Record<string, string>;
	observedAt: string;
	/** A result that cannot change any more (a successful deploy of this commit); it is cached. */
	terminal: boolean;
	/** A command check's captured output (the last part of stdout and stderr together). */
	output?: string;
}

/** The commits a task's checks may need, looked up from its pull request. */
export interface TaskRefs {
	mergeCommit: string | null;
	prHead: string | null;
}

export interface CheckContext {
	taskId: string;
	refs: TaskRefs;
	/** owner/name of the GitHub repository (the check's own repo, else the PR's, else the clone's origin). */
	repo: string | null;
	/** The project's Firstmate clone, and its default-branch ref (e.g. origin/main). */
	clone: { dir: string; defaultRef: string } | null;
	/** The Firstmate checkout Wheelhouse is attached to. */
	firstmateRoot: string;
	/** A release check's tag, for npm.published's version_from. */
	releaseTag: string | null;
	/** The project the task belongs to (passed to command checks). */
	projectId?: string;
	/** The check's id in the passage (names a command check's checkout). */
	checkId?: string;
}

export interface CheckDeps {
	gh(args: string[]): Promise<RunResult>;
	git(dir: string, args: string[], timeoutMs?: number): Promise<RunResult>;
	fetch: typeof fetch;
	env: NodeJS.ProcessEnv;
	now(): number;
	npmRegistry: string;
	/** HTTP and npm request timeout (default 10 s). */
	httpTimeoutMs?: number;
	/** Runs a command check's program (default: runBounded). */
	run?: (file: string, args: readonly string[], opts: RunOptions) => Promise<RunResult>;
}

const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const HTTP_TIMEOUT_MS = 10_000;
export const HTTP_MAX_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

const short = (sha: string) => sha.slice(0, 7);

export function defaultDeps(env: NodeJS.ProcessEnv = process.env): CheckDeps {
	return {
		gh: (args) =>
			runBounded('gh', args, {
				env: { ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
				timeoutMs: 15_000,
				maxOutputBytes: 256 * 1024
			}),
		git: (dir, args, timeoutMs = 8000) =>
			runBounded('git', ['--no-optional-locks', '-C', dir, ...args], {
				env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
				timeoutMs,
				maxOutputBytes: 64 * 1024
			}),
		fetch: (...a) => fetch(...a),
		env,
		now: Date.now,
		npmRegistry: 'https://registry.npmjs.org'
	};
}

class Unknown extends Error {}

function result(
	deps: CheckDeps,
	outcome: string | null,
	summary: string,
	o: {
		url?: string | null;
		fields?: Record<string, string>;
		terminal?: boolean;
		also?: string[];
		output?: string;
	} = {}
): CheckResult {
	return {
		...(o.output !== undefined ? { output: o.output } : {}),
		outcome,
		outcomes: outcome ? [outcome, ...(o.also ?? [])] : [],
		summary,
		url: o.url && /^https?:\/\//i.test(o.url) ? o.url : null,
		fields: o.fields ?? {},
		observedAt: new Date(deps.now()).toISOString(),
		terminal: o.terminal ?? false
	};
}

function commit(ctx: CheckContext, which: CommitValue): string {
	const v = which === 'merge.commit' ? ctx.refs.mergeCommit : ctx.refs.prHead;
	if (!v || !SHA.test(v)) {
		throw new Unknown(
			which === 'merge.commit'
				? 'the merge commit is not known'
				: 'the pull request head is not known'
		);
	}
	return v;
}

function repoOf(ctx: CheckContext, spec: { repo?: string }): string {
	const r = spec.repo ?? ctx.repo;
	if (!r) throw new Unknown('the GitHub repository is not known (set repo: owner/name)');
	return r;
}

/** `gh api <path> --jq <filter>`, parsed as JSON. */
async function ghJson<T>(deps: CheckDeps, path: string, jq: string): Promise<T> {
	const r = await deps.gh(['api', '-H', 'Accept: application/vnd.github+json', path, '--jq', jq]);
	if (!r.ok) {
		if (r.kind === 'spawn-error') throw new Unknown('the GitHub CLI (gh) is not installed');
		if (r.kind === 'timeout') throw new Unknown('GitHub did not answer in time');
		const http = /HTTP (\d{3})/.exec(r.stderr)?.[1];
		throw new Unknown(http ? `GitHub answered ${http}` : 'GitHub could not be read');
	}
	try {
		return JSON.parse(r.stdout.trim() || 'null') as T;
	} catch {
		throw new Unknown('GitHub returned an unexpected response');
	}
}

const name = (spec: CheckSpec, fallback: string) => spec.label ?? fallback;

async function githubDeployment(
	spec: Extract<CheckSpec, { type: 'github.deployment' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	const repo = repoOf(ctx, spec);
	const sha = commit(ctx, spec.ref);
	const what = name(spec, `${spec.environment} deployment`);
	const list = await ghJson<{ id: number }[]>(
		deps,
		`repos/${repo}/deployments?sha=${sha}&environment=${encodeURIComponent(spec.environment)}&per_page=5`,
		'[.[] | {id}]'
	);
	if (!Array.isArray(list) || !list.length) {
		return result(deps, 'absent', `No ${what} for ${short(sha)} yet.`);
	}
	const status = await ghJson<{
		state?: string;
		environment_url?: string;
		target_url?: string;
	} | null>(
		deps,
		`repos/${repo}/deployments/${Number(list[0].id)}/statuses?per_page=1`,
		'if .[0] == null then null else .[0] | {state, environment_url, target_url} end'
	);
	const url = status?.environment_url || status?.target_url || null;
	switch (status?.state ?? 'pending') {
		case 'success':
			return result(deps, 'success', `${cap(what)} of ${short(sha)} succeeded.`, {
				url,
				terminal: true
			});
		case 'failure':
		case 'error':
			return result(deps, 'failure', `${cap(what)} of ${short(sha)} failed.`, { url });
		case 'inactive':
			return result(
				deps,
				'inactive',
				`${cap(what)} of ${short(sha)} succeeded and was replaced by a later one.`,
				{
					url,
					terminal: true,
					also: ['success']
				}
			);
		case 'in_progress':
		case 'queued':
		case 'pending':
			return result(deps, 'in_progress', `${cap(what)} of ${short(sha)} is in progress.`, { url });
		default:
			throw new Unknown(`GitHub reported an unrecognised deployment state '${status?.state}'`);
	}
}

async function githubWorkflow(
	spec: Extract<CheckSpec, { type: 'github.workflow' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	const repo = repoOf(ctx, spec);
	const sha = commit(ctx, spec.ref);
	const what = name(spec, `the ${spec.workflow} workflow`);
	const event = spec.event ? `&event=${spec.event}` : '';
	const run = await ghJson<{
		status?: string;
		conclusion?: string | null;
		html_url?: string;
	} | null>(
		deps,
		`repos/${repo}/actions/workflows/${encodeURIComponent(spec.workflow)}/runs?head_sha=${sha}&per_page=1${event}`,
		'if .workflow_runs[0] == null then null else .workflow_runs[0] | {status, conclusion, html_url} end'
	);
	if (!run) return result(deps, 'absent', `No run of ${what} for ${short(sha)} yet.`);
	const url = run.html_url ?? null;
	if (run.status !== 'completed') {
		return result(deps, 'in_progress', `${cap(what)} is running for ${short(sha)}.`, { url });
	}
	if (run.conclusion === 'success') {
		return result(deps, 'success', `${cap(what)} succeeded for ${short(sha)}.`, {
			url,
			terminal: true
		});
	}
	return result(
		deps,
		'failure',
		`${cap(what)} ended ${run.conclusion ?? 'without a result'} for ${short(sha)}.`,
		{
			url
		}
	);
}

/** A tag pattern with * wildcards, matched against the whole tag. */
export function tagMatches(pattern: string | undefined, tag: string): boolean {
	if (!pattern) return true;
	const re = new RegExp(
		`^${pattern
			.split('*')
			.map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
			.join('.*')}$`
	);
	return re.test(tag);
}

const RELEASES_PAGE = 30;

async function githubRelease(
	spec: Extract<CheckSpec, { type: 'github.release' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	const repo = repoOf(ctx, spec);
	const sha = commit(ctx, spec.contains);
	const releases = await ghJson<{ tag: string; url: string; draft: boolean }[]>(
		deps,
		`repos/${repo}/releases?per_page=${RELEASES_PAGE}`,
		'[.[] | {tag: .tag_name, url: .html_url, draft}]'
	);
	const tags = (Array.isArray(releases) ? releases : []).filter(
		(r) =>
			!r.draft &&
			typeof r.tag === 'string' &&
			/^[A-Za-z0-9._/-]{1,200}$/.test(r.tag) &&
			tagMatches(spec.tag_pattern, r.tag)
	);
	if (!tags.length)
		return result(
			deps,
			'not_yet',
			`No release${spec.tag_pattern ? ` matching ${spec.tag_pattern}` : ''} yet.`
		);
	const contains = async (r: (typeof tags)[number]) => {
		const status = await ghJson<string>(
			deps,
			`repos/${repo}/compare/${sha}...${encodeURIComponent(r.tag)}?per_page=1`,
			'.status'
		);
		return status === 'ahead' || status === 'identical';
	};
	if (!(await contains(tags[0]))) {
		return result(
			deps,
			'not_yet',
			`${short(sha)} is not in a release yet (latest: ${tags[0].tag}).`
		);
	}
	// Releases come newest first and every release after the first one containing the commit
	// contains it too, so a binary search finds the earliest one in a few comparisons.
	let lo = 0;
	let hi = tags.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (await contains(tags[mid])) lo = mid;
		else hi = mid - 1;
	}
	const found = tags[lo];
	if (lo === tags.length - 1 && releases.length >= RELEASES_PAGE) {
		return result(
			deps,
			'included',
			`${short(sha)} shipped in ${found.tag} or an earlier release.`,
			{ url: found.url, terminal: true }
		);
	}
	return result(deps, 'included', `${short(sha)} shipped in ${found.tag}.`, {
		url: found.url,
		fields: { tag: found.tag },
		terminal: true
	});
}

async function npmPublished(
	spec: Extract<CheckSpec, { type: 'npm.published' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	if (!ctx.releaseTag)
		throw new Unknown(`the version is not known until ${spec.version_from} finds a release`);
	const version = ctx.releaseTag.replace(/^v/, '');
	if (!VERSION.test(version)) throw new Unknown(`release tag ${ctx.releaseTag} is not a version`);
	const pkg = spec.package.startsWith('@') ? spec.package.replace('/', '%2f') : spec.package;
	const page = `https://www.npmjs.com/package/${spec.package}/v/${version}`;
	const v = await getBounded(
		deps,
		`${deps.npmRegistry}/${pkg}/${encodeURIComponent(version)}`,
		'GET',
		{}
	);
	if (v.status === 404)
		return result(deps, 'absent', `${spec.package}@${version} is not on npm yet.`);
	if (v.status !== 200) throw new Unknown(`the npm registry answered ${v.status}`);
	const tags = await getBounded(deps, `${deps.npmRegistry}/-/package/${pkg}/dist-tags`, 'GET', {});
	let latest: string | null = null;
	if (tags.status === 200) {
		try {
			const t = JSON.parse(tags.body);
			latest = typeof t?.latest === 'string' ? t.latest : null;
		} catch {
			latest = null;
		}
	}
	const fields = { version };
	if (latest === version) {
		return result(deps, 'published', `${spec.package}@${version} is on npm as latest.`, {
			url: page,
			fields,
			terminal: true,
			also: ['latest']
		});
	}
	return result(
		deps,
		'published',
		`${spec.package}@${version} is on npm${latest ? ` (latest is ${latest})` : ''}.`,
		{ url: page, fields }
	);
}

interface Bounded {
	status: number;
	body: string;
	url: string;
}

/**
 * GET or HEAD with a timeout, at most three http(s) redirects, no cookies and a
 * body cap. The given headers are dropped once a redirect leaves the URL's
 * origin (another host, port or scheme, so never sent over a downgrade to http).
 */
export async function getBounded(
	deps: CheckDeps,
	url: string,
	method: 'GET' | 'HEAD',
	headers: Record<string, string>
): Promise<Bounded> {
	let current = url;
	const origin = new URL(url).origin;
	const timeoutMs = deps.httpTimeoutMs ?? HTTP_TIMEOUT_MS;
	const signal = AbortSignal.timeout(timeoutMs);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const u = new URL(current);
		if (u.protocol !== 'https:' && u.protocol !== 'http:')
			throw new Unknown('only http(s) URLs are checked');
		let res: Response;
		try {
			res = await deps.fetch(u, {
				method,
				headers: { 'user-agent': 'wheelhouse-passage-check', ...headers },
				redirect: 'manual',
				credentials: 'omit',
				signal
			});
		} catch (e) {
			const err = e as Error;
			throw new Unknown(
				err.name === 'TimeoutError' || err.name === 'AbortError'
					? `${u.host} did not answer within ${timeoutMs / 1000} s`
					: `${u.host} could not be reached`
			);
		}
		if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
			await res.body?.cancel().catch(() => {});
			const next = new URL(res.headers.get('location')!, u);
			if (next.origin !== origin) headers = {};
			current = next.toString();
			continue;
		}
		return {
			status: res.status,
			body: method === 'HEAD' ? '' : await readCapped(res),
			url: current
		};
	}
	throw new Unknown(`more than ${MAX_REDIRECTS} redirects`);
}

async function readCapped(res: Response): Promise<string> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > HTTP_MAX_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Unknown(`the response is larger than ${HTTP_MAX_BYTES / 1024} KiB`);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** RFC 6901 JSON pointer lookup. */
export function pointer(doc: unknown, ptr: string): { found: boolean; value: unknown } {
	let v: unknown = doc;
	for (const raw of ptr.split('/').slice(1)) {
		const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
		if (Array.isArray(v) && /^\d+$/.test(key) && Number(key) < v.length) v = v[Number(key)];
		else if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.hasOwn(v, key)) {
			v = (v as Record<string, unknown>)[key];
		} else return { found: false, value: undefined };
	}
	return { found: true, value: v };
}

/** What `equals:` compares with: a Wheelhouse value (validated) or the literal text. */
function expected(equals: string, ctx: CheckContext): { kind: 'commit' | 'text'; value: string } {
	if (equals === 'merge.commit' || equals === 'pr.head')
		return { kind: 'commit', value: commit(ctx, equals) };
	if (equals === 'task.id') return { kind: 'text', value: ctx.taskId };
	return { kind: 'text', value: equals };
}

async function httpCheck(
	spec: Extract<CheckSpec, { type: 'http' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	const headers: Record<string, string> = {};
	for (const [h, envName] of Object.entries(spec.headers_from_env ?? {})) {
		const v = deps.env[envName];
		if (!v) throw new Unknown(`the environment variable ${envName} is not set`);
		headers[h] = v;
	}
	const want = spec.expect?.equals !== undefined ? expected(spec.expect.equals, ctx) : null;
	const host = new URL(spec.url).host;
	const r = await getBounded(deps, spec.url, spec.method ?? 'GET', headers);
	const statusOk =
		spec.expect?.status !== undefined
			? r.status === spec.expect.status
			: r.status >= 200 && r.status < 300;
	if (!statusOk) return result(deps, 'error', `${host} answered ${r.status}.`, { url: spec.url });
	if (!spec.expect?.json_pointer) {
		return result(deps, 'ok', `${host} answered ${r.status}.`, { url: spec.url, terminal: true });
	}
	let doc: unknown;
	try {
		doc = JSON.parse(r.body);
	} catch {
		throw new Unknown(`${host} did not answer with JSON`);
	}
	const at = pointer(doc, spec.expect.json_pointer);
	if (!at.found) {
		return result(deps, 'mismatch', `${host} has no ${spec.expect.json_pointer}.`, {
			url: spec.url
		});
	}
	const got =
		typeof at.value === 'string' || typeof at.value === 'number' || typeof at.value === 'boolean'
			? String(at.value)
			: JSON.stringify(at.value);
	const shown = got.length > 60 ? `${got.slice(0, 59)}…` : got;
	if (!want) {
		return result(deps, 'ok', `${host} reports ${spec.expect.json_pointer} = ${shown}.`, {
			url: spec.url,
			terminal: true
		});
	}
	const matches =
		want.kind === 'commit'
			? got.length >= 7 && want.value.startsWith(got.toLowerCase())
			: got === want.value;
	return matches
		? result(deps, 'ok', `${host} reports ${spec.expect.json_pointer} = ${shown}, as expected.`, {
				url: spec.url,
				terminal: true
			})
		: result(
				deps,
				'mismatch',
				`${host} reports ${spec.expect.json_pointer} = ${shown}, not ${want.kind === 'commit' ? short(want.value) : want.value}.`,
				{
					url: spec.url
				}
			);
}

async function gitContains(
	spec: Extract<CheckSpec, { type: 'git.contains' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	const sha = commit(ctx, spec.commit);
	const dir = spec.repo === 'firstmate-root' ? ctx.firstmateRoot : ctx.clone?.dir;
	if (!dir) throw new Unknown('this project has no Firstmate clone');
	const ref = spec.ref ?? (spec.repo === 'firstmate-root' ? 'HEAD' : ctx.clone!.defaultRef);
	if (!GIT_REF.test(ref)) throw new Unknown(`'${ref}' is not a ref Wheelhouse will read`);
	const where =
		spec.repo === 'firstmate-root'
			? `${ref} of the Firstmate checkout`
			: `${ref} of the project clone`;
	const hasRef = await deps.git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	if (!hasRef.ok) throw new Unknown(`${where} is not there`);
	const has = await deps.git(dir, ['cat-file', '-e', `${sha}^{commit}`]);
	if (!has.ok) return result(deps, 'no', `${short(sha)} is not on ${where} yet.`);
	const r = await deps.git(dir, ['merge-base', '--is-ancestor', sha, ref]);
	if (r.ok) return result(deps, 'yes', `${short(sha)} is on ${where}.`, { terminal: true });
	if (r.kind === 'exit' && r.code === 1)
		return result(deps, 'no', `${short(sha)} is not on ${where} yet.`);
	throw new Unknown(`git could not compare ${short(sha)} with ${ref}`);
}

/** How much of a command's output is kept and shown. */
export const COMMAND_OUTPUT_BYTES = 16 * 1024;
export const DEFAULT_COMMAND_TIMEOUT = '5m';

/** Terminal output as plain text: colour codes dropped, carriage-return redraws collapsed. */
export function plainOutput(text: string): string {
	/* eslint-disable no-control-regex -- terminal control codes are what this removes */
	return text
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
		.split('\n')
		.map((line) => {
			const parts = line.replace(/\r$/, '').split('\r');
			return parts[parts.length - 1];
		})
		.join('\n')
		.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
	/* eslint-enable no-control-regex */
}

/** A program and its arguments as one readable command line (POSIX shell quoting, for reading only). */
export function commandLine(run: string[]): string {
	return run
		.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
		.join(' ');
}

/** An elapsed time in words: 12 s, 3 min 5 s, 1 h 2 min. */
export function elapsed(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	const m = Math.floor(s / 60);
	if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
	return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** How long checking out a command check's commit may take. */
const CHECKOUT_TIMEOUT_MS = 120_000;

/**
 * Run a command check: the program and its arguments directly (never a shell),
 * in a temporary checkout of the pinned commit (the task's merge commit or pull
 * request head when the check names one, else the default branch's tip), in a
 * folder that resolves inside that checkout, with a minimal environment plus
 * the names the check allows, and a hard timeout. The checkout is removed
 * afterwards. Exit 0 is passed; any other exit, a signal or the timeout is
 * failed. A program that cannot be started is unknown.
 */
async function commandCheck(
	spec: Extract<CheckSpec, { type: 'command' }>,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	if (!ctx.clone) throw new Unknown('this project has no Firstmate clone to run it in');
	const clone = ctx.clone.dir;
	let sha: string;
	if (spec.ref) {
		sha = commit(ctx, spec.ref);
	} else {
		const tip = await deps.git(clone, [
			'rev-parse',
			'--verify',
			'--quiet',
			`${ctx.clone.defaultRef}^{commit}`
		]);
		sha = tip.ok ? tip.stdout.trim() : '';
		if (!SHA.test(sha))
			throw new Unknown(`${ctx.clone.defaultRef} of the project clone is not there`);
	}
	const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
	const checkout = path.join(
		tmpdir(),
		`wheelhouse-${safe(ctx.projectId ?? 'project')}-${safe(ctx.taskId)}-${safe(ctx.checkId ?? 'command')}-${sha}`
	);
	await deps.git(clone, ['worktree', 'remove', '--force', checkout]);
	const added = await deps.git(
		clone,
		['worktree', 'add', '--force', '--detach', checkout, sha],
		CHECKOUT_TIMEOUT_MS
	);
	if (!added.ok)
		throw new Unknown(`the commit ${short(sha)} could not be checked out from the project clone`);
	try {
		const top = await realpath(checkout).catch(() => null);
		if (!top) throw new Unknown(`the checkout of ${short(sha)} could not be found`);
		const cwd = spec.cwd ?? '.';
		const dir = await realpath(path.join(top, cwd)).catch(() => null);
		if (!dir) throw new Unknown(`the folder ${cwd} is not in the project at ${short(sha)}`);
		if (dir !== top && !dir.startsWith(top + path.sep))
			throw new Unknown(`the folder ${cwd} leads outside the project`);
		const env: NodeJS.ProcessEnv = {};
		for (const name of [...COMMAND_BASE_ENV, ...(spec.env ?? [])]) {
			if (deps.env[name] !== undefined) env[name] = deps.env[name];
		}
		env.WHEELHOUSE_TASK_ID = ctx.taskId;
		if (ctx.projectId) env.WHEELHOUSE_PROJECT = ctx.projectId;
		env.WHEELHOUSE_COMMIT = sha;
		const limit = spec.timeout ?? DEFAULT_COMMAND_TIMEOUT;
		const r = await (deps.run ?? runBounded)(spec.run[0], spec.run.slice(1), {
			cwd: dir,
			env,
			timeoutMs: durationMs(limit) ?? 300_000,
			maxOutputBytes: COMMAND_OUTPUT_BYTES,
			tailBytes: COMMAND_OUTPUT_BYTES
		});
		const output = plainOutput(r.stdout + (r.ok ? '' : r.stderr));
		const took = elapsed(r.durationMs);
		if (r.ok) return result(deps, 'passed', `Passed in ${took}.`, { terminal: true, output });
		if (r.kind === 'spawn-error') {
			throw new Unknown(
				/ENOENT/.test(r.message)
					? `could not find ${spec.run[0]} on the PATH Wheelhouse runs with`
					: `could not start ${spec.run[0]} (${r.message})`
			);
		}
		if (r.kind === 'timeout')
			return result(deps, 'failed', `Failed: it did not finish within ${limit}.`, { output });
		return result(
			deps,
			'failed',
			r.signal
				? `Failed: it was stopped by ${r.signal} after ${took}.`
				: `Failed: it exited with code ${r.code} after ${took}.`,
			{ output }
		);
	} finally {
		await deps.git(clone, ['worktree', 'remove', '--force', checkout], CHECKOUT_TIMEOUT_MS);
	}
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Run one check. Never throws: a check that cannot tell returns no outcome. */
export async function runCheck(
	spec: CheckSpec,
	ctx: CheckContext,
	deps: CheckDeps
): Promise<CheckResult> {
	try {
		switch (spec.type) {
			case 'github.deployment':
				return await githubDeployment(spec, ctx, deps);
			case 'github.workflow':
				return await githubWorkflow(spec, ctx, deps);
			case 'github.release':
				return await githubRelease(spec, ctx, deps);
			case 'npm.published':
				return await npmPublished(spec, ctx, deps);
			case 'http':
				return await httpCheck(spec, ctx, deps);
			case 'git.contains':
				return await gitContains(spec, ctx, deps);
			case 'command':
				return await commandCheck(spec, ctx, deps);
			case 'status.note':
				throw new Unknown('status notes are read from the fleet ledger, not run');
		}
	} catch (e) {
		const why = e instanceof Unknown ? e.message : `the check failed (${(e as Error).message})`;
		// A sentence starts with a capital, but a host name keeps its own spelling.
		return result(deps, null, `${/^\S*\./.test(why) ? why : cap(why)}.`);
	}
}

/** A preview the worker reported with the `preview <url>` status convention. */
export function statusNote(
	preview: { url: string; at: string } | null | undefined,
	now: number
): CheckResult {
	return preview
		? {
				outcome: 'present',
				outcomes: ['present'],
				summary: `The worker reported ${preview.url}.`,
				url: /^https?:\/\//i.test(preview.url) ? preview.url : null,
				fields: {},
				observedAt: preview.at,
				terminal: false
			}
		: {
				outcome: 'absent',
				outcomes: ['absent'],
				summary: 'The worker has not reported a preview.',
				url: null,
				fields: {},
				observedAt: new Date(now).toISOString(),
				terminal: false
			};
}

const PR = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#]|$)/;

/** owner/name of a GitHub pull request URL. */
export function repoOfPr(url: string | null): string | null {
	return url ? (PR.exec(url)?.[1] ?? null) : null;
}

/** owner/name of a GitHub remote URL (https or ssh). */
export function repoOfRemote(remote: string): string | null {
	const m =
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
			remote.trim()
		);
	return m?.[1] ?? null;
}

/** Look up a pull request's head and merge commits with `gh pr view`. */
export async function readTaskRefs(
	prUrl: string,
	deps: CheckDeps
): Promise<{ refs: TaskRefs; merged: boolean; problem: string | null }> {
	const none = { mergeCommit: null, prHead: null };
	if (!PR.test(prUrl))
		return { refs: none, merged: false, problem: 'the pull request is not on GitHub' };
	const r = await deps.gh(['pr', 'view', prUrl, '--json', 'headRefOid,mergeCommit,state']);
	if (!r.ok) {
		return {
			refs: none,
			merged: false,
			problem:
				r.kind === 'spawn-error'
					? 'the GitHub CLI (gh) is not installed'
					: 'the pull request could not be read'
		};
	}
	try {
		const v = JSON.parse(r.stdout);
		const head = typeof v.headRefOid === 'string' && SHA.test(v.headRefOid) ? v.headRefOid : null;
		const merge =
			typeof v.mergeCommit?.oid === 'string' && SHA.test(v.mergeCommit.oid)
				? v.mergeCommit.oid
				: null;
		return {
			refs: { prHead: head, mergeCommit: merge },
			merged: String(v.state).toUpperCase() === 'MERGED',
			problem: null
		};
	} catch {
		return { refs: none, merged: false, problem: 'GitHub returned an unexpected response' };
	}
}
