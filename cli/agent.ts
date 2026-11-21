import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import { addPresetStep, STEP_PRESETS, type StepPreset } from '../src/lib/server/passages/presets';
import { LOOPBACK_HOST } from '../src/lib/server/session';
import { askTerminal } from './plugin';
import { readRunning, RESTART_PATH, type RunningRecord } from './running';

/**
 * The commands an agent (Firstmate, or a crewmate) runs against a running
 * Wheelhouse instead of scraping its pages: `status`, `doctor`, `restart`,
 * `plugin search|inspect|config|role`, `service`, `passage`, `preview check`
 * and `inbox`. Each finds the Wheelhouse with `--url`, else $WHEELHOUSE_URL,
 * else the one running record in the plugins directory (cli/running.ts), and
 * makes changes with that record's token as `Authorization: Bearer`, which
 * the server takes only for the routes open to agents
 * (src/lib/server/agentauth.ts); the captain's own calls are refused with the
 * page to make them on. The token is never printed.
 *
 * `--json` prints a stable `wheelhouse.<command>.v1` payload. Exit codes: 0
 * ok, 1 failed, 2 usage error, 3 Wheelhouse not running, 4 refused as the
 * captain's call, 5 conflict (something changed since it was read).
 */

export const EXIT = { ok: 0, failed: 1, usage: 2, notRunning: 3, captain: 4, conflict: 5 } as const;

export class CliError extends Error {
	constructor(
		message: string,
		readonly code: number = EXIT.failed
	) {
		super(message);
	}
}

export interface AgentDeps {
	env: NodeJS.ProcessEnv;
	fetch: typeof fetch;
	readRunning: (pluginsDir: string) => Promise<RunningRecord[]>;
	confirm: (question: string) => Promise<boolean>;
	readText: (file: string) => Promise<string>;
	log: (line: string) => void;
	error: (line: string) => void;
	sleep: (ms: number) => Promise<void>;
}

export const defaultAgentDeps = (): AgentDeps => ({
	env: process.env,
	fetch: (...a) => fetch(...a),
	readRunning,
	confirm: askTerminal,
	readText: (file) => (file === '-' ? readStdin() : readFile(file, 'utf8')),
	log: (line) => console.log(line),
	error: (line) => console.error(line),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms))
});

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) chunks.push(c as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

/** A running Wheelhouse, and the token to change things with (null: none found for it). */
export interface Instance {
	url: string;
	token: string | null;
}

const portOf = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');

/**
 * The Wheelhouse a command talks to: `url` (or $WHEELHOUSE_URL) when given,
 * else the only one running from `pluginsDir`; null when none is running. Its
 * token comes only from a record for that same port on this computer, so it
 * is never sent anywhere else.
 */
export async function findInstance(
	o: { url?: string; pluginsDir: string },
	deps: Pick<AgentDeps, 'env' | 'readRunning'>
): Promise<Instance | null> {
	const records = await deps.readRunning(o.pluginsDir);
	const named = o.url ?? deps.env.WHEELHOUSE_URL;
	if (named) {
		const u = URL.parse(named);
		if (!u || u.protocol !== 'http:' || !LOOPBACK_HOST.test(u.host)) {
			throw new CliError(
				`${named} is not a Wheelhouse on this computer (http://127.0.0.1:<port>)`,
				EXIT.usage
			);
		}
		const mine = records.find((r) => {
			const at = URL.parse(r.url);
			return at && LOOPBACK_HOST.test(at.host) && portOf(at) === portOf(u);
		});
		return { url: `${u.origin}/`, token: mine?.token ?? null };
	}
	if (records.length > 1) {
		throw new CliError(
			`several Wheelhouses are running (${records.map((r) => r.url).join(', ')}); pass --url`,
			EXIT.usage
		);
	}
	return records.length ? { url: records[0].url, token: records[0].token } : null;
}

const refusedConnection = (e: unknown) =>
	['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(
		(e as { cause?: { code?: string } }).cause?.code ?? ''
	);

/** Talks to one running Wheelhouse, turning its refusals into exit codes. */
export class Client {
	constructor(
		readonly instance: Instance,
		private deps: Pick<AgentDeps, 'fetch'>,
		readonly pluginsDir: string
	) {}

	get url(): string {
		return this.instance.url;
	}

	private headers(auth: boolean, body: boolean): Record<string, string> {
		const h: Record<string, string> = { accept: 'application/json' };
		if (body) h['content-type'] = 'application/json';
		if (auth) {
			if (!this.instance.token) {
				throw new CliError(
					`found no running record for ${this.url} in ${path.join(this.pluginsDir, '.running')}, so it cannot make changes; pass the --plugins-dir it runs with`
				);
			}
			h.authorization = `Bearer ${this.instance.token}`;
		}
		return h;
	}

	async request<T>(
		method: 'GET' | 'POST' | 'PUT',
		route: string,
		body?: unknown,
		o: { accept?: number[]; auth?: boolean } = {}
	): Promise<{ status: number; body: T }> {
		const write = method !== 'GET';
		let res: Response;
		try {
			res = await this.deps.fetch(new URL(route, this.url), {
				method,
				headers: this.headers(o.auth ?? write, body !== undefined),
				body: body !== undefined ? JSON.stringify(body) : undefined,
				redirect: 'manual',
				signal: AbortSignal.timeout(120_000)
			});
		} catch (e) {
			if (e instanceof CliError) throw e;
			if (refusedConnection(e)) {
				throw new CliError(`Wheelhouse is not running at ${this.url}`, EXIT.notRunning);
			}
			throw new CliError(`could not reach Wheelhouse at ${this.url}: ${(e as Error).message}`);
		}
		const text = await res.text();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = { message: text.trim() };
		}
		if (res.ok || o.accept?.includes(res.status)) return { status: res.status, body: parsed as T };
		const msg = (parsed as { message?: unknown } | null)?.message;
		const why =
			typeof msg === 'string' && msg ? msg.replace(/\.$/, '') : `it answered ${res.status}`;
		if (res.status === 403 && typeof (parsed as { captain?: unknown })?.captain === 'string') {
			throw new CliError(why, EXIT.captain);
		}
		if (res.status === 409) throw new CliError(why, EXIT.conflict);
		throw new CliError(why);
	}

	get = async <T>(route: string) => (await this.request<T>('GET', route)).body;
	post = async <T>(route: string, body: unknown = {}) =>
		(await this.request<T>('POST', route, body)).body;
}

/** The options every command that talks to Wheelhouse takes. */
function withInstance(c: Command): Command {
	return c
		.option(
			'--url <url>',
			'the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)'
		)
		.option(
			'--plugins-dir <dir>',
			'the plugins directory the running Wheelhouse loads from, to find it and its token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		);
}

interface InstanceOpts {
	url?: string;
	pluginsDir?: string;
}

/** The client for a command's options, or exit 3 when no Wheelhouse is running. */
export async function connect(o: InstanceOpts, deps: AgentDeps): Promise<Client> {
	const pluginsDir = o.pluginsDir ? path.resolve(o.pluginsDir) : defaultPluginsDir(deps.env);
	const found = await findInstance({ url: o.url, pluginsDir }, deps);
	if (!found) {
		throw new CliError(
			'Wheelhouse is not running (no running record in the plugins directory); start it with `wheelhouse open`',
			EXIT.notRunning
		);
	}
	return new Client(found, deps, pluginsDir);
}

/** Run an action, printing a CliError and setting its exit code instead of throwing. */
export function act<A extends unknown[]>(
	deps: Pick<AgentDeps, 'error'>,
	fn: (...a: A) => Promise<void>
): (...a: A) => Promise<void> {
	return async (...a) => {
		try {
			await fn(...a);
		} catch (e) {
			if (!(e instanceof CliError)) throw e;
			deps.error(`wheelhouse: ${e.message}.`);
			process.exitCode = e.code;
		}
	};
}

/** Commander's own usage errors (unknown option, missing argument) exit 2 on these commands. */
export function usageExits(c: Command): Command {
	c.exitOverride();
	for (const sub of c.commands) usageExits(sub);
	return c;
}

const print = (deps: AgentDeps, schema: string, payload: object) =>
	deps.log(JSON.stringify({ schema: `wheelhouse.${schema}.v1`, ...payload }, null, 2));

// ---------------------------------------------------------------------------
// status and doctor

interface HealthLike {
	version: string;
	configured: boolean;
	firstmate: {
		dir: string | null;
		home: string | null;
		version: string | null;
		compatible: boolean;
		problems: string[];
	};
	collector: { consecutiveFailures: number; lastError: string | null };
	messaging: { available: boolean; reason: string | null };
	passages: { problem: string | null };
	material: {
		state: string;
		message: string | null;
		items: { id: string; state: string; target: string }[];
		drift: { file: string; marker: string }[];
	};
}

interface UpdateLike {
	source: string;
	installKind: string;
	mismatch: boolean;
	check: {
		state: string;
		reason: string | null;
		current: { version: string | null };
		latest: { version: string | null; commit: string } | null;
	} | null;
	job: { state: string; error: string | null } | null;
	canRestart: boolean;
	busy: string[];
}

async function readStatus(client: Client) {
	const health = await client.get<HealthLike>('/api/health');
	const update = await client.get<UpdateLike>('/api/wheelhouse/update').catch(() => null);
	return { health, update };
}

function statusPayload(client: Client, health: HealthLike, update: UpdateLike | null) {
	return {
		url: client.url,
		version: health.version,
		configured: health.configured,
		canChange: client.instance.token !== null,
		firstmate: health.firstmate,
		material: health.material,
		update: update && {
			source: update.source,
			installKind: update.installKind,
			mismatch: update.mismatch,
			state: update.check?.state ?? null,
			latest: update.check?.latest?.version ?? null,
			job: update.job?.state ?? null,
			canRestart: update.canRestart
		}
	};
}

function updateLine(u: UpdateLike): string {
	const c = u.check;
	const where = `${u.source} source (${u.installKind} install)`;
	if (u.job)
		return `${where}; ${u.job.state === 'failed' ? `last upgrade failed: ${u.job.error}` : 'an upgrade is under way'}`;
	if (!c) return `${where}; not checked yet`;
	if (c.state === 'available')
		return `${where}; ${c.latest?.version ?? c.latest?.commit.slice(0, 7)} available (wheelhouse upgrade)`;
	if (c.state === 'current') return `${where}; up to date`;
	return `${where}; ${c.reason ?? c.state}`;
}

type CheckState = 'ok' | 'warn' | 'fail';
interface DoctorCheck {
	id: string;
	state: CheckState;
	message: string;
	fix: string | null;
}

export function doctorChecks(client: Client, h: HealthLike, u: UpdateLike | null): DoctorCheck[] {
	const out: DoctorCheck[] = [];
	const add = (id: string, state: CheckState, message: string, fix: string | null = null) =>
		out.push({ id, state, message, fix });
	add('running', 'ok', `Wheelhouse ${h.version} answers at ${client.url}`);
	if (client.instance.token) add('token', 'ok', 'found its running record, so it can make changes');
	else
		add(
			'token',
			'warn',
			'found no running record for it, so changes are refused',
			'pass the --plugins-dir it runs with'
		);
	if (!h.configured) add('firstmate', 'fail', 'no Firstmate is set up', `open ${client.url}setup`);
	else if (!h.firstmate.compatible)
		add('firstmate', 'fail', `Firstmate may not be compatible: ${h.firstmate.problems.join('; ')}`);
	else
		add(
			'firstmate',
			'ok',
			`Firstmate ${h.firstmate.version ?? ''} at ${h.firstmate.home}`.replace('  ', ' ')
		);
	if (h.collector?.consecutiveFailures)
		add(
			'collector',
			'warn',
			`reading Firstmate failed ${h.collector.consecutiveFailures} times: ${h.collector.lastError}`
		);
	if (h.messaging && !h.messaging.available)
		add('messaging', 'warn', `cannot send messages to Firstmate: ${h.messaging.reason}`);
	if (h.passages?.problem) add('passages', 'warn', h.passages.problem);
	const m = h.material;
	if (m.state === 'error')
		add('material', 'fail', m.message ?? 'installing the agent skills failed');
	else if (m.state === 'attention') {
		for (const i of m.items.filter((x) => x.state === 'modified' || x.state === 'foreign')) {
			add(
				'material',
				'warn',
				`${i.id} is ${i.state === 'modified' ? 'edited locally' : 'not managed by Wheelhouse'} (${i.target})`,
				`wheelhouse skills diff ${i.id}`
			);
		}
		for (const d of m.drift) {
			add(
				'material',
				'warn',
				`Firstmate no longer has \`${d.marker}\` in ${d.file}`,
				'wheelhouse skills status'
			);
		}
		if (!m.items.some((x) => x.state === 'modified' || x.state === 'foreign') && !m.drift.length)
			add(
				'material',
				'warn',
				m.message ?? 'the agent skills need attention',
				'wheelhouse skills status'
			);
	} else add('material', 'ok', `agent skills ${m.state}`);
	if (u) {
		if (!u.canRestart)
			add(
				'restart',
				'warn',
				'not started by `wheelhouse open`, so it cannot restart or upgrade itself'
			);
		if (u.mismatch)
			add(
				'update',
				'warn',
				`the ${u.source} update source does not match this ${u.installKind} install`,
				'wheelhouse upgrade --source published|github'
			);
		else if (u.job?.state === 'failed')
			add('update', 'warn', `the last upgrade failed: ${u.job.error}`, 'wheelhouse upgrade');
		else add('update', 'ok', updateLine(u));
	}
	return out;
}

// ---------------------------------------------------------------------------
// restart and upgrade, which wait for Wheelhouse to come back

/**
 * Wait until Wheelhouse answers again after a restart: once it has been seen
 * down, or once a new server has written a record with a new token for the
 * same address (a quick restart may never be seen down). Takes up the new
 * token. Its version, or null on timeout.
 */
export async function waitBack(
	client: Client,
	deps: Pick<AgentDeps, 'sleep' | 'readRunning' | 'env'>,
	o: { ms?: number } = {}
): Promise<string | null> {
	const end = Date.now() + (o.ms ?? 60_000);
	const before = client.instance.token;
	let seenDown = false;
	while (Date.now() < end) {
		let version: string | null = null;
		try {
			version = (await client.get<{ version: string }>('/api/health')).version;
		} catch {
			seenDown = true;
		}
		if (version !== null) {
			const now = await findInstance(
				{ url: client.url, pluginsDir: client.pluginsDir },
				deps
			).catch(() => null);
			const renewed = now?.token != null && now.token !== before;
			if (now?.token) client.instance.token = now.token;
			if (seenDown || renewed) return version;
		}
		await deps.sleep(500);
	}
	return null;
}

async function restart(client: Client, deps: AgentDeps, yes: boolean): Promise<void> {
	// The restart route is the CLI server's own (cli/running.ts): it answers 403 with no reason.
	const ask = async <T>(method: 'GET' | 'POST') => {
		try {
			return (await client.request<T>(method, RESTART_PATH, undefined, { auth: true })).body;
		} catch (e) {
			if (e instanceof CliError && e.message === 'it answered 403') {
				throw new CliError(
					`Wheelhouse at ${client.url} refused the token; pass the --plugins-dir it runs with`
				);
			}
			throw e;
		}
	};
	const { busy } = await ask<{ busy: string[] }>('GET');
	if (busy.length) {
		deps.log(`Restarting Wheelhouse at ${client.url} stops what it is running:`);
		for (const b of busy) deps.log(`  - ${b}`);
		if (!yes && !(await deps.confirm('Restart it now?'))) throw new CliError('not restarted');
	}
	await ask('POST');
	deps.log(`Restarting Wheelhouse at ${client.url}…`);
	const version = await waitBack(client, deps);
	if (!version)
		throw new CliError(`Wheelhouse at ${client.url} did not answer again within a minute`);
	deps.log(`Wheelhouse ${version} is back at ${client.url}.`);
}

// ---------------------------------------------------------------------------
// The commands

const enc = encodeURIComponent;

/** `<id>` as the server names projects and plugins, so a typo is a usage error, not a request. */
const id = (what: string) => (v: string) => {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) throw new InvalidArgumentError(`Not a ${what} id.`);
	return v;
};

const target = (v: string) => {
	if (v !== 'captain' && v !== 'project') {
		throw new InvalidArgumentError('Name the captain or project file.');
	}
	return v;
};

const FILE_HELP =
	'which passage file: captain (your Wheelhouse config, applies within a minute) or project (the repository’s .wheelhouse.yaml, applies once committed)';

type Opts = InstanceOpts & { json?: boolean };

export function statusCommand(deps: AgentDeps): Command {
	return withInstance(new Command('status'))
		.description(
			'Show the running Wheelhouse: version, Firstmate, installed agent skills and updates.'
		)
		.option('--json', 'print wheelhouse.status.v1')
		.action(
			act(deps, async (o: Opts) => {
				const client = await connect(o, deps);
				const { health, update } = await readStatus(client);
				const payload = statusPayload(client, health, update);
				if (o.json) return print(deps, 'status', payload);
				deps.log(`Wheelhouse ${health.version} at ${client.url}`);
				const f = health.firstmate;
				deps.log(
					`Firstmate:  ${!health.configured ? 'not set up' : f.compatible ? `compatible${f.version ? ` (Firstmate ${f.version})` : ''}` : 'may not be compatible'}${f.home ? `, ${f.home}` : ''}`
				);
				deps.log(
					`Skills:     ${health.material.state}${health.material.message ? ` (${health.material.message})` : ''}`
				);
				if (update) deps.log(`Updates:    ${updateLine(update)}`);
				if (!client.instance.token)
					deps.log('Changes:    refused (no running record found; pass --plugins-dir)');
			})
		);
}

export function doctorCommand(deps: AgentDeps): Command {
	return withInstance(new Command('doctor'))
		.description('Check the running Wheelhouse for problems, each with what to do about it.')
		.option('--json', 'print wheelhouse.doctor.v1')
		.action(
			act(deps, async (o: Opts) => {
				const client = await connect(o, deps);
				const { health, update } = await readStatus(client);
				const checks = doctorChecks(client, health, update);
				const ok = !checks.some((c) => c.state === 'fail');
				if (o.json) print(deps, 'doctor', { url: client.url, ok, checks });
				else
					for (const c of checks) {
						deps.log(`${c.state.padEnd(4)} ${c.id.padEnd(10)} ${c.message}`);
						if (c.fix) deps.log(`${''.padEnd(16)}→ ${c.fix}`);
					}
				if (!ok) process.exitCode = EXIT.failed;
			})
		);
}

export function restartCommand(deps: AgentDeps): Command {
	return withInstance(new Command('restart'))
		.description(
			'Restart the running Wheelhouse (Firstmate and its crew keep running); says first what a restart would stop.'
		)
		.option('-y, --yes', 'restart without asking, even mid-work')
		.action(
			act(deps, async (o: Opts & { yes?: boolean }) => {
				await restart(await connect(o, deps), deps, !!o.yes);
			})
		);
}

interface ServiceView {
	state?: string;
	url?: string | null;
	error?: string | null;
	[k: string]: unknown;
}

export function serviceCommand(deps: AgentDeps): Command {
	const cmd = new Command('service').description(
		"A plugin's companion service: whether it is up, and starting it."
	);
	const run = (start: boolean) =>
		act(deps, async (plugin: string, service: string, o: Opts & { project?: string }) => {
			const client = await connect(o, deps);
			const q = { plugin, service, ...(o.project ? { project: o.project } : {}) };
			const view = start
				? await client.post<ServiceView>('/api/services', q)
				: await client.get<ServiceView>(`/api/services?${new URLSearchParams(q)}`);
			if (o.json) return print(deps, 'service', { service: view });
			deps.log(
				`${plugin}/${service}: ${view.state ?? 'unknown'}${view.url ? ` at ${view.url}` : ''}`
			);
			if (view.error) deps.log(`  ${view.error}`);
		});
	for (const [name, start, what] of [
		['status', false, 'Say whether the service is up.'],
		['start', true, 'Start the service and wait until it is up or has failed.']
	] as const) {
		cmd.addCommand(
			withInstance(new Command(name))
				.description(what)
				.argument('<plugin>', 'the plugin id', id('plugin'))
				.argument('<service>', 'the service, as the plugin names it')
				.option('--project <id>', 'for one project', id('project'))
				.option('--json', 'print wheelhouse.service.v1')
				.action(run(start))
		);
	}
	return cmd;
}

interface PassageStepLike {
	id: string;
	label: string;
	origin?: string;
}
interface PassageView {
	projectId: string;
	notes: string[];
	sources: { origin?: string; state?: string; errors?: string[]; [k: string]: unknown }[];
	passages: { track: string; custom: boolean; steps: PassageStepLike[] }[];
	consent: { needed: boolean; enabled: boolean };
	commands: { list: unknown[]; enabled: boolean };
}
interface FileLike {
	exists: boolean;
	text: string;
	digest: string | null;
	location: string;
	problem: string | null;
}
interface EditorLike {
	targets?: Record<string, { available: boolean; why: string | null }>;
	file: FileLike;
}
interface DraftLike {
	errors: string[];
	commands: unknown[];
}

const passagePage = (client: Client, project: string) =>
	`${client.url}projects/${enc(project)}/passage`;

/** A passage file as the editor opens it, or why that file cannot be edited here. */
async function readPassageFile(client: Client, project: string, file: string): Promise<FileLike> {
	const v = await client.get<EditorLike>(
		`/api/projects/${enc(project)}/passage/file?target=${file}`
	);
	const t = v.targets?.[file];
	if (t && !t.available)
		throw new CliError(t.why?.replace(/\.$/, '') ?? `there is no ${file} passage file here`);
	if (v.file.problem) throw new CliError(v.file.problem.replace(/\.$/, ''));
	return v.file;
}

async function check(
	client: Client,
	project: string,
	file: string,
	text: string
): Promise<DraftLike> {
	return client.post<DraftLike>(`/api/projects/${enc(project)}/passage/draft`, {
		target: file,
		text
	});
}

/** Save a passage file; 409 (changed since read) exits 5, problems exit 1 with each listed. */
async function save(
	client: Client,
	project: string,
	file: string,
	text: string,
	base: string | null
): Promise<string | null> {
	const r = await client.request<{ file?: FileLike; errors?: string[]; message?: string }>(
		'PUT',
		`/api/projects/${enc(project)}/passage/file`,
		{ target: file, text, baseDigest: base },
		{ accept: [422] }
	);
	if (r.status === 422) {
		throw new CliError(
			[
				r.body.message?.replace(/\.$/, '') ?? 'the file has problems',
				...(r.body.errors ?? [])
			].join('\n  ')
		);
	}
	return r.body.file?.digest ?? null;
}

const reportCommands = (deps: AgentDeps, client: Client, project: string, d: DraftLike) => {
	if (d.commands.length) {
		deps.log(
			`It runs ${d.commands.length} command check${d.commands.length === 1 ? '' : 's'}, which stay off until the captain allows them at ${passagePage(client, project)}.`
		);
	}
};

export function passageCommand(deps: AgentDeps): Command {
	const cmd = new Command('passage').description(
		"A project's passage (the steps its tasks walk) and its passage files."
	);
	const sub = (name: string) =>
		withInstance(new Command(name)).argument('<project>', 'the project id', id('project'));

	cmd.addCommand(
		sub('show')
			.description(
				"Show the project's passage: its steps, where each comes from, and what waits on the captain."
			)
			.option('--json', 'print wheelhouse.passage-show.v1')
			.action(
				act(deps, async (project: string, o: Opts) => {
					const client = await connect(o, deps);
					const v = await client.get<PassageView>(`/api/projects/${enc(project)}/passage`);
					if (o.json) return print(deps, 'passage-show', { passage: v });
					for (const p of v.passages) {
						deps.log(`${p.track}${p.custom ? ' (customised)' : ''}:`);
						for (const s of p.steps)
							deps.log(
								`  ${s.id.padEnd(16)} ${s.label}${s.origin && s.origin !== 'builtin' ? `  [${s.origin}]` : ''}`
							);
					}
					for (const n of v.notes) deps.log(`Note: ${n}`);
					for (const s of v.sources)
						for (const e of s.errors ?? []) deps.log(`Problem (${s.origin}): ${e}`);
					if (v.consent.needed && !v.consent.enabled)
						deps.log(
							`The project file's network checks are off until the captain enables them at ${passagePage(client, project)}.`
						);
					if (v.commands.list.length && !v.commands.enabled)
						deps.log(
							`Its command checks are off until the captain allows them at ${passagePage(client, project)}.`
						);
				})
			)
	);
	cmd.addCommand(
		sub('get')
			.description('Print a passage file (its digest goes to stderr, for `passage apply --base`).')
			.option('--file <which>', FILE_HELP, target, 'captain')
			.option('--json', 'print wheelhouse.passage-get.v1')
			.action(
				act(deps, async (project: string, o: Opts & { file: string }) => {
					const client = await connect(o, deps);
					const f = await readPassageFile(client, project, o.file);
					if (o.json) return print(deps, 'passage-get', { project, target: o.file, file: f });
					if (!f.exists)
						deps.error(`There is no ${o.file} passage file yet (apply with --base new).`);
					else {
						process.stdout.write(f.text);
						deps.error(`digest ${f.digest}`);
					}
				})
			)
	);
	cmd.addCommand(
		sub('check')
			.argument('<yaml>', 'the passage file to check, or - for stdin')
			.description('Check a passage file as it would apply, without saving it.')
			.option('--file <which>', FILE_HELP, target, 'captain')
			.option('--json', 'print wheelhouse.passage-check.v1')
			.action(
				act(deps, async (project: string, yaml: string, o: Opts & { file: string }) => {
					const client = await connect(o, deps);
					const d = await check(client, project, o.file, await deps.readText(yaml));
					if (o.json) print(deps, 'passage-check', { ok: !d.errors.length, ...d });
					else if (!d.errors.length) {
						deps.log('The passage file is valid.');
						reportCommands(deps, client, project, d);
					} else for (const e of d.errors) deps.log(`problem: ${e}`);
					if (d.errors.length) process.exitCode = EXIT.failed;
				})
			)
	);
	cmd.addCommand(
		sub('apply')
			.argument('<yaml>', 'the passage file to save, or - for stdin')
			.description(
				'Save a passage file, only if it is unchanged since you read it (exit 5 when it changed).'
			)
			.requiredOption(
				'--base <digest>',
				'the digest `passage get` printed, or new for a file that does not exist yet'
			)
			.option('--file <which>', FILE_HELP, target, 'captain')
			.option('--json', 'print wheelhouse.passage-apply.v1')
			.action(
				act(
					deps,
					async (project: string, yaml: string, o: Opts & { file: string; base: string }) => {
						if (o.base !== 'new' && !/^[0-9a-f]{64}$/.test(o.base)) {
							throw new CliError('--base is the digest `passage get` printed, or new', EXIT.usage);
						}
						const client = await connect(o, deps);
						const text = await deps.readText(yaml);
						const digest = await save(
							client,
							project,
							o.file,
							text,
							o.base === 'new' ? null : o.base
						);
						if (o.json) return print(deps, 'passage-apply', { project, file: o.file, digest });
						deps.log(`Saved the ${o.file} passage file (digest ${digest}).`);
						if (o.file === 'project')
							deps.log('It applies once it is committed to the default branch.');
					}
				)
			)
	);
	cmd.addCommand(
		sub('add-step')
			.argument('<step>', `the step to add: ${STEP_PRESETS.join(', ')}`, (v: string) => {
				if (!(STEP_PRESETS as readonly string[]).includes(v)) {
					throw new InvalidArgumentError(`Choose ${STEP_PRESETS.join(', ')}.`);
				}
				return v as StepPreset;
			})
			.description(
				'Add Released, On npm or Deployed to the passage from a preset, checked and saved like `passage apply`.'
			)
			.option('--package <name>', 'on-npm: the npm package the project publishes')
			.option(
				'--environment <name>',
				'deployed: the GitHub deployment environment, such as Production'
			)
			.option(
				'--workflow <file>',
				'deployed: the GitHub Actions workflow that deploys, such as deploy.yml'
			)
			.option(
				'--after <step>',
				'the step it follows (default: landed for released, released for on-npm, the last step for deployed)'
			)
			.option('--file <which>', FILE_HELP, target, 'captain')
			.option('--dry-run', 'print the file it would save, and save nothing')
			.option('--json', 'print wheelhouse.passage-add-step.v1')
			.action(
				act(
					deps,
					async (
						project: string,
						step: StepPreset,
						o: Opts & {
							file: string;
							package?: string;
							environment?: string;
							workflow?: string;
							after?: string;
							dryRun?: boolean;
						}
					) => {
						const client = await connect(o, deps);
						const view = await client.get<PassageView>(`/api/projects/${enc(project)}/passage`);
						const ship = view.passages.find((p) => p.track === 'ship');
						const done = (added: string[], digest: string | null, text?: string) =>
							o.json
								? print(deps, 'passage-add-step', {
										project,
										file: o.file,
										step,
										added,
										digest,
										...(text !== undefined ? { text } : {})
									})
								: undefined;
						if (ship?.steps.some((s) => s.id === step)) {
							if (o.json) return done([], null);
							return deps.log(`The ${project} passage already has the ${step} step.`);
						}
						const after = o.after ?? (step === 'deployed' ? ship?.steps.at(-1)?.id : undefined);
						const f = await readPassageFile(client, project, o.file);
						const r = addPresetStep(f.exists ? f.text : '', {
							preset: step,
							package: o.package,
							environment: o.environment,
							workflow: o.workflow,
							after
						});
						if (!r.ok) throw new CliError(r.error, EXIT.usage);
						const d = await check(client, project, o.file, r.text);
						if (d.errors.length) {
							throw new CliError(['the new passage file has problems', ...d.errors].join('\n  '));
						}
						if (o.dryRun) {
							if (o.json) return done(r.added, null, r.text);
							process.stdout.write(r.text);
							return;
						}
						const digest = await save(client, project, o.file, r.text, f.exists ? f.digest : null);
						if (o.json) return done(r.added, digest);
						deps.log(`Added ${r.added.join(', ')} to the ${o.file} passage file of ${project}.`);
						if (o.file === 'project')
							deps.log('It applies once it is committed to the default branch.');
						else deps.log('It applies within a minute.');
					}
				)
			)
	);
	return cmd;
}

interface PreviewLike {
	url: string | null;
	state: string;
	reason: string | null;
}

export function previewCommand(deps: AgentDeps): Command {
	const cmd = new Command('preview').description(
		'Previews the captain sees embedded in Wheelhouse.'
	);
	cmd.addCommand(
		withInstance(new Command('check'))
			.description(
				'Say whether a preview shows embedded now (exit 0) or why not (exit 1): a task’s reported preview, or an address Wheelhouse has shown.'
			)
			.argument('[url]', 'the preview address, on this computer')
			.option('--task <id>', 'the task whose reported preview to check')
			.option('--json', 'print wheelhouse.preview-check.v1')
			.action(
				act(deps, async (url: string | undefined, o: Opts & { task?: string }) => {
					if (!url === !o.task)
						throw new CliError('name a preview address or --task <id>', EXIT.usage);
					const client = await connect(o, deps);
					const c = o.task
						? await client.get<PreviewLike>(`/api/tasks/${enc(o.task)}/preview`)
						: await client.get<PreviewLike>(`/api/previews/check?url=${enc(url!)}`);
					if (o.json) print(deps, 'preview-check', { preview: c });
					else
						deps.log(
							`${c.state}: ${c.url ?? url ?? 'no preview reported'}${c.reason ? ` (${c.reason})` : ''}`
						);
					if (c.state !== 'live') process.exitCode = EXIT.failed;
				})
			)
	);
	return cmd;
}

interface InboxLike {
	available: boolean;
	reason: string | null;
	cards: {
		id: string;
		taskId: string;
		projectId: string | null;
		kind: string;
		title: string;
		question: string;
		following: string | null;
	}[];
}

export function inboxCommand(deps: AgentDeps): Command {
	return withInstance(new Command('inbox'))
		.description(
			"List what waits on the captain in Wheelhouse's inbox (read-only: the captain answers there)."
		)
		.option('--json', 'print wheelhouse.inbox.v1')
		.action(
			act(deps, async (o: Opts) => {
				const client = await connect(o, deps);
				const v = await client.get<InboxLike>('/api/inbox');
				const cards = v.cards.map(
					({ id, taskId, projectId, kind, title, question, following }) => ({
						id,
						taskId,
						projectId,
						kind,
						title,
						question,
						following: following !== null
					})
				);
				if (o.json)
					return print(deps, 'inbox', { available: v.available, reason: v.reason, cards });
				if (!v.available) deps.log(`The inbox is unavailable: ${v.reason}`);
				else if (!cards.length) deps.log('Nothing waits on the captain.');
				for (const c of cards)
					deps.log(
						`${c.kind.padEnd(10)} ${c.taskId.padEnd(24)} ${c.title}${c.following ? ' (following up)' : ''}`
					);
			})
		);
}

// ---------------------------------------------------------------------------
// plugin search | inspect | config | role, added to `wheelhouse plugin`

interface MarketLike {
	registries: { id?: string; source?: string; state?: string; error?: string | null }[];
	plugins: {
		name: string;
		displayName: string;
		description: string;
		repository: string;
		ref: string | null;
		keywords: string[];
	}[];
}
interface PluginPreviewLike {
	id: string;
	name: string;
	version: string;
	description: string | null;
	repository: string;
	commit: string;
	capabilities: string[];
	settings: { key: string; title?: string }[];
	installed: { version: string } | null;
}
interface PluginPageLike {
	plugin: { id: string; name?: string; settings?: { key: string; title?: string }[] };
	on: boolean;
	enabled: boolean | null;
	projects: { id: string; on: boolean; enabled: boolean | null }[];
	settings: { key: string; title?: string; value?: unknown }[];
}

const collect = (v: string, all: string[] = []) => [...all, v];

/** Add the commands that talk to a running Wheelhouse to `wheelhouse plugin`. */
export function addPluginAgentCommands(cmd: Command, deps: AgentDeps): Command {
	const opts = (c: Command) => c.optsWithGlobals() as Opts;
	const withUrl = (c: Command) =>
		c.option(
			'--url <url>',
			'the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)'
		);
	cmd.addCommand(
		withUrl(new Command('search'))
			.description("Search the marketplace's plugins (by name, description or keyword).")
			.argument('[query]', 'words to look for (all plugins when left out)')
			.option('--refresh', 'read the registries again now')
			.option('--json', 'print wheelhouse.plugin-search.v1')
			.action(
				act(
					deps,
					async (
						query: string | undefined,
						o: { refresh?: boolean; json?: boolean },
						c: Command
					) => {
						const client = await connect(opts(c), deps);
						const m = await client.get<MarketLike>(
							`/api/plugins/marketplace${o.refresh ? '?refresh=1' : ''}`
						);
						const q = (query ?? '').toLowerCase().trim();
						const plugins = m.plugins.filter(
							(p) =>
								!q ||
								[p.name, p.displayName, p.description, p.repository, ...p.keywords].some((s) =>
									s.toLowerCase().includes(q)
								)
						);
						if (o.json)
							return print(deps, 'plugin-search', {
								query: query ?? null,
								plugins,
								registries: m.registries
							});
						if (!plugins.length) deps.log('No marketplace plugin matches.');
						for (const p of plugins)
							deps.log(
								`${p.name.padEnd(24)} ${p.repository}${p.ref ? `@${p.ref}` : ''}  ${p.description}`
							);
						deps.log('Install one with: wheelhouse plugin install <org/repo>');
					}
				)
			)
	);
	cmd.addCommand(
		withUrl(new Command('inspect'))
			.description(
				'Look a plugin up without installing it: what it is, the exact commit and what it may do.'
			)
			.argument('<repo>', 'org/repo, or org/repo@<tag, branch or commit>')
			.option('--json', 'print wheelhouse.plugin-inspect.v1')
			.action(
				act(deps, async (spec: string, o: { json?: boolean }, c: Command) => {
					const at = spec.indexOf('@');
					const repo = at < 0 ? spec : spec.slice(0, at);
					const ref = at < 0 ? null : spec.slice(at + 1);
					const client = await connect(opts(c), deps);
					const p = await client.post<PluginPreviewLike>('/api/plugins/inspect', { repo, ref });
					if (o.json) return print(deps, 'plugin-inspect', { plugin: p });
					deps.log(
						`${p.name} ${p.version} (${p.id})${p.installed ? `, installed ${p.installed.version}` : ''}`
					);
					deps.log(`From ${p.repository} at ${p.commit}`);
					if (p.description) deps.log(p.description);
					for (const x of p.capabilities) deps.log(`  may: ${x}`);
					for (const s of p.settings)
						deps.log(`  setting: ${s.key}${s.title ? ` (${s.title})` : ''}`);
				})
			)
	);
	cmd.addCommand(
		withUrl(new Command('config'))
			.description(
				"Show or change a plugin's settings, and where it is on; with no change, show them."
			)
			.argument('<id>', 'the plugin id', id('plugin'))
			.option('--on', 'turn it on (for every project, or --project)')
			.option('--off', 'turn it off (for every project, or --project)')
			.option('--default', 'go back to its default (for every project, or --project)')
			.option('--project <id>', 'change it for one project only', id('project'))
			.option(
				'--set <key=value>',
				'answer one of its settings (repeatable; key= clears it)',
				collect
			)
			.option('--json', 'print wheelhouse.plugin-config.v1')
			.action(
				act(
					deps,
					async (
						plugin: string,
						o: {
							on?: boolean;
							off?: boolean;
							default?: boolean;
							project?: string;
							set?: string[];
							json?: boolean;
						},
						c: Command
					) => {
						const switches = [o.on, o.off, o.default].filter(Boolean).length;
						if (switches > 1)
							throw new CliError('choose one of --on, --off or --default', EXIT.usage);
						if (o.project && !switches)
							throw new CliError('--project goes with --on, --off or --default', EXIT.usage);
						const settings: Record<string, string> = {};
						for (const kv of o.set ?? []) {
							const eq = kv.indexOf('=');
							if (eq < 1) throw new CliError(`--set ${kv} is not key=value`, EXIT.usage);
							settings[kv.slice(0, eq)] = kv.slice(eq + 1);
						}
						const client = await connect(opts(c), deps);
						const route = `/api/plugins/${enc(plugin)}/config`;
						let view: PluginPageLike | null = null;
						if (switches) {
							const enabled = o.on ? true : o.off ? false : null;
							view = await client.post<PluginPageLike>(
								route,
								o.project ? { project: o.project, enabled } : { enabled }
							);
						}
						if (Object.keys(settings).length)
							view = await client.post<PluginPageLike>(route, { settings });
						view ??= await client.get<PluginPageLike>(route);
						if (o.json) return print(deps, 'plugin-config', { plugin: view });
						deps.log(
							`${plugin}: ${view.on ? 'on' : 'off'} by default${view.enabled === null ? ' (its own default)' : ''}`
						);
						for (const p of view.projects)
							deps.log(
								`  ${p.id.padEnd(24)} ${p.on ? 'on' : 'off'}${p.enabled === null ? '' : ' (set for this project)'}`
							);
						for (const s of view.settings)
							deps.log(
								`  ${s.key} = ${s.value === undefined ? '(default)' : JSON.stringify(s.value)}`
							);
					}
				)
			)
	);
	cmd.addCommand(
		withUrl(new Command('role'))
			.description(
				'Choose the plugin that takes a role (review.surface), or builtin for Wheelhouse’s own.'
			)
			.argument('<role>', 'the role: review.surface')
			.argument('<provider>', 'the plugin id, or builtin')
			.option('--json', 'print wheelhouse.plugin-role.v1')
			.action(
				act(deps, async (role: string, provider: string, o: { json?: boolean }, c: Command) => {
					const client = await connect(opts(c), deps);
					const r = await client.post<{ roles: { role: string; provider: string | null }[] }>(
						'/api/plugins/roles',
						{ role, provider: provider === 'builtin' ? null : provider }
					);
					if (o.json) return print(deps, 'plugin-role', { roles: r.roles });
					for (const x of r.roles) deps.log(`${x.role}: ${x.provider ?? 'builtin'}`);
				})
			)
	);
	for (const name of ['search', 'inspect', 'config', 'role']) {
		usageExits(cmd.commands.find((c) => c.name() === name)!);
	}
	return cmd;
}

/** The top-level agent commands, for cli/index.ts. */
export function agentCommands(deps: AgentDeps = defaultAgentDeps()): Command[] {
	return [
		statusCommand(deps),
		doctorCommand(deps),
		restartCommand(deps),
		serviceCommand(deps),
		passageCommand(deps),
		previewCommand(deps),
		inboxCommand(deps)
	].map(usageExits);
}
