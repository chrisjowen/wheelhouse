import os from 'node:os';
import {
	fleetyardMachine,
	HERE,
	linkProblem,
	withoutTransport,
	type LinkJob,
	type LinkProblem,
	type LinkStep,
	type LinkTest,
	type MateLinkStatus,
	type MateLinkView
} from '../../matelink';
import type { SecondMate } from '../../types';
import { runBounded, type RunOptions, type RunResult } from './exec';
import { remoteCommand, sshArgs } from './remotegit';

/**
 * The link to a second mate on a Fleetyard machine, as this computer sees it
 * (lib/matelink.ts has the words). Everything here asks Fleetyard's connector
 * on this computer, the same one the mate's host alias runs as its
 * ProxyCommand, so it speaks for this computer's own pairing and approval:
 *
 * - status: `machine status <alias>`, a request signed by this computer, which
 *   says whether the machine is up and has let this computer in;
 * - Test connection: that, then one timed round trip to the second mate's home;
 * - Wake: `machine start <alias>`;
 * - Approve and Connect: `ssh-setup <alias>` and `pair`, left running while
 *   the captain approves on Fleetyard with a passkey, which only a Fleetyard
 *   page can ask for.
 *
 * Fleetyard gains nothing from any of it: the connector dials out, and the
 * machine checks the captain's approval itself. A status is asked for at most
 * once a minute per second mate in the background (refresh), and again when
 * the card asks; Fleetyard allows a computer far more than that.
 */

/** Fleetyard's connector as an alias's ProxyCommand runs it, and the key that alias uses. */
export interface Connector {
	command: string;
	args: string[];
	env: Record<string, string>;
	identityFile: string | null;
}

/**
 * Words as a POSIX shell splits them, for the one ProxyCommand line the
 * connector writes (double quotes with backslash escapes); null when a quote
 * is left open.
 */
export function shellWords(s: string): string[] | null {
	const out: string[] = [];
	let cur = '';
	let has = false;
	for (let i = 0; i < s.length;) {
		const ch = s[i];
		if (ch === ' ' || ch === '\t') {
			if (has) out.push(cur);
			cur = '';
			has = false;
			i++;
			continue;
		}
		has = true;
		if (ch === "'") {
			const end = s.indexOf("'", i + 1);
			if (end < 0) return null;
			cur += s.slice(i + 1, end);
			i = end + 1;
		} else if (ch === '"') {
			i++;
			while (i < s.length && s[i] !== '"') {
				if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) {
					cur += s[i + 1];
					i += 2;
				} else cur += s[i++];
			}
			if (i >= s.length) return null;
			i++;
		} else if (ch === '\\' && i + 1 < s.length) {
			cur += s[i + 1];
			i += 2;
		} else {
			cur += ch;
			i++;
		}
	}
	if (has) out.push(cur);
	return out;
}

/**
 * The connector in `ssh -G <alias>`'s ProxyCommand (`[env K=V ...] <program>
 * <args...> dial %h`), and the alias's first IdentityFile; null when the alias
 * does not go through Fleetyard's connector.
 */
export function connectorFromConfig(config: string, home: string): Connector | null {
	let proxy: string | null = null;
	let identity: string | null = null;
	for (const line of config.split('\n')) {
		const m = /^(\S+)\s+(.+)$/.exec(line.trim());
		if (!m) continue;
		const key = m[1].toLowerCase();
		if (key === 'proxycommand' && proxy === null) proxy = m[2];
		if (key === 'identityfile' && identity === null) identity = m[2];
	}
	if (!proxy || proxy === 'none') return null;
	const words = shellWords(proxy)?.map((w) => w.replace(/%%/g, '%'));
	const at = words?.indexOf('dial') ?? -1;
	if (!words || at < 1) return null;
	const env: Record<string, string> = {};
	let i = 0;
	if (words[0] === 'env') {
		i = 1;
		while (i < at && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) {
			const eq = words[i].indexOf('=');
			env[words[i].slice(0, eq)] = words[i].slice(eq + 1);
			i++;
		}
	}
	if (i >= at) return null;
	const file = identity ? (shellWords(identity)?.[0] ?? null) : null;
	return {
		command: words[i],
		args: words.slice(i + 1, at),
		env,
		identityFile: file ? file.replace(/^~(?=\/|$)/, home) : null
	};
}

/** A machine as `whc-connector machine status` prints it (its cli.ts showMachine). */
export interface MachineLine {
	name: string;
	slug: string;
	id: string;
	state: string;
	reachable: boolean;
	/** Its connector carries this computer's connections; null while it is offline. */
	ssh: boolean | null;
	keysReady: boolean;
	matesRefused: string | null;
}

const MACHINE_LINE =
	/^(.*?)\s+fy-(\S+)\s+(\S+)\s+(.*?)\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/;

/** The machine line in the connector's output, and the refusal line that may follow it. */
export function parseMachine(stdout: string): MachineLine | null {
	const lines = stdout.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const m = MACHINE_LINE.exec(lines[i]);
		if (!m) continue;
		const said = m[4].trim();
		const refused = /refused your latest approval:\s*(.*)$/.exec(lines[i + 1] ?? '');
		return {
			name: m[1].trim() || m[2],
			slug: m[2],
			id: m[5],
			state: m[3] === 'reachable' ? 'running' : m[3],
			reachable: m[3] === 'reachable',
			ssh: said === '' ? null : !/^no ssh/.test(said),
			keysReady: said === 'ssh ready',
			matesRefused: refused
				? refused[1].trim() || 'no reason given'
				: /refused/.test(said)
					? 'no reason given'
					: null
		};
	}
	return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The link's state from one machine line. */
export function statusOf(
	m: MachineLine,
	here: string,
	urls: MateLinkStatus['urls'],
	at: string
): MateLinkStatus {
	const base = { machine: m.name, here, checkedAt: at, urls };
	const say = (said: string) => linkProblem(said, m.name, here);
	if (!m.reachable) {
		const problem =
			m.state === 'running' || m.state === 'connecting'
				? say('is still connecting')
				: say(`${m.name} is ${m.state}`);
		return { ...base, health: 'down', online: false, approved: null, problem };
	}
	if (m.ssh === false) {
		return { ...base, health: 'down', online: true, approved: null, problem: say('old connector') };
	}
	if (m.matesRefused) {
		return {
			...base,
			health: 'down',
			online: true,
			approved: false,
			problem: say(`refused your latest approval: ${m.matesRefused}`)
		};
	}
	if (m.ssh === null) {
		return {
			...base,
			health: 'down',
			online: true,
			approved: null,
			problem: say('is still connecting')
		};
	}
	if (!m.keysReady) {
		return {
			...base,
			health: 'pending',
			online: true,
			approved: false,
			problem: say('not approved for')
		};
	}
	return { ...base, health: 'linked', online: true, approved: true, problem: null };
}

/** The connector's own last words on standard error, or the run's failure. */
function saidBy(r: Extract<RunResult, { ok: false }>): string {
	const lines = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim());
	const own = lines.filter((l) => /^whc-connector:/.test(l)).pop();
	if (own) return own;
	if (r.kind === 'timeout') return 'could not reach Fleetyard in time';
	if (r.kind === 'spawn-error') return 'no connector';
	return lines.filter(Boolean).pop() ?? r.message;
}

type Run = (cmd: string, args: string[], o: RunOptions) => Promise<RunResult>;

export interface MateLinksOptions {
	env?: NodeJS.ProcessEnv;
	/** The ssh program (default `ssh` on PATH), which reads the alias and runs the round trip. */
	ssh?: string;
	/** This computer, as the captain knows it. */
	here?: string;
	now?: () => number;
	run?: Run;
	/** How often a second mate's link is asked about in the background. */
	refreshMs?: number;
}

const CONNECTOR_TTL_MS = 5 * 60_000;
const GATEWAY_TTL_MS = 10 * 60_000;
const FRESH_MS = 15_000;
const CONNECT_MS = 15 * 60_000;
const APPROVE_MS = 16 * 60_000;
/** How long starting a fix waits for the connector to name its Fleetyard page. */
const NAMED_MS = 8_000;
/** How long a finished fix's outcome stays on the card. */
const SHOWN_MS = 2 * 60_000;

/** A status for a second mate whose link cannot be asked about at all. */
function unknown(
	machine: string,
	here: string,
	problem: LinkProblem,
	at: string,
	urls: MateLinkStatus['urls']
): MateLinkStatus {
	return {
		machine,
		here,
		health:
			problem.action === 'connect' ? 'pending' : problem.code === 'no-answer' ? 'unknown' : 'down',
		online: null,
		approved: null,
		problem,
		checkedAt: at,
		urls
	};
}

export class MateLinks {
	private statuses = new Map<string, MateLinkStatus>();
	private asking = new Map<
		string,
		Promise<{ status: MateLinkStatus; ms: number; answered: boolean }>
	>();
	private jobs = new Map<string, { job: LinkJob; abort: AbortController }>();
	private connectors = new Map<string, { at: number; value: Connector | null }>();
	private gateway: { at: number; value: string | null } | null = null;
	readonly here: string;

	constructor(private opts: MateLinksOptions = {}) {
		this.here = opts.here ?? HERE;
	}

	private now() {
		return (this.opts.now ?? Date.now)();
	}

	private run(
		cmd: string,
		args: string[],
		o: Omit<RunOptions, 'env'>,
		env: Record<string, string> = {}
	) {
		return (this.opts.run ?? runBounded)(cmd, args, {
			...o,
			env: { ...(this.opts.env ?? process.env), ...env }
		});
	}

	/** The last status asked for, if any. */
	cached(id: string): MateLinkStatus | null {
		return this.statuses.get(id) ?? null;
	}

	/** The link's state, and a fix still under way or just finished (its outcome shows a while). */
	view(id: string): MateLinkView {
		const job = this.jobs.get(id)?.job ?? null;
		const ended = job?.endedAt ? this.now() - Date.parse(job.endedAt) : 0;
		return { status: this.cached(id), job: job && ended < SHOWN_MS ? job : null };
	}

	/** Asks about every Fleetyard second mate whose link was not asked about lately. */
	refresh(mates: SecondMate[]): void {
		const every = this.opts.refreshMs ?? 60_000;
		for (const m of mates) {
			if (!m.link || this.asking.has(m.id)) continue;
			const last = this.statuses.get(m.id);
			if (last && this.now() - Date.parse(last.checkedAt) < every) continue;
			void this.status(m, 0).catch(() => {});
		}
	}

	/** The link's state, asked for again when the last answer is older than maxAgeMs. */
	async status(mate: SecondMate, maxAgeMs = FRESH_MS): Promise<MateLinkStatus> {
		const last = this.statuses.get(mate.id);
		if (last && this.now() - Date.parse(last.checkedAt) < maxAgeMs) return last;
		return (await this.ask(mate)).status;
	}

	private connector(host: string): Promise<Connector | null> {
		const hit = this.connectors.get(host);
		if (hit && this.now() - hit.at < CONNECTOR_TTL_MS) return Promise.resolve(hit.value);
		return this.run(this.opts.ssh ?? 'ssh', ['-G', '--', host], {
			timeoutMs: 5_000,
			maxOutputBytes: 256 * 1024
		}).then((r) => {
			const home = (this.opts.env ?? process.env).HOME ?? os.homedir();
			const value = r.ok ? connectorFromConfig(r.stdout, home) : null;
			this.connectors.set(host, { at: this.now(), value });
			return value;
		});
	}

	private connectorRun(c: Connector, args: string[], timeoutMs = 20_000) {
		return this.run(
			c.command,
			[...c.args, ...args],
			{ timeoutMs, maxOutputBytes: 64 * 1024 },
			c.env
		);
	}

	/** Fleetyard's own pages, from the pairing the connector keeps. */
	private async urls(c: Connector): Promise<MateLinkStatus['urls']> {
		if (!this.gateway || this.now() - this.gateway.at > GATEWAY_TTL_MS) {
			const r = await this.connectorRun(c, ['status'], 10_000);
			const url = r.ok ? (/^gateway\s+(https?:\/\/\S+)/m.exec(r.stdout)?.[1] ?? null) : null;
			this.gateway = { at: this.now(), value: url ? url.replace(/\/+$/, '') : null };
		}
		const g = this.gateway.value;
		return { machines: g ? `${g}/machines` : null, approve: g ? `${g}/account` : null };
	}

	private ask(mate: SecondMate) {
		const running = this.asking.get(mate.id);
		if (running) return running;
		const p = this.askNow(mate).finally(() => this.asking.delete(mate.id));
		this.asking.set(mate.id, p);
		return p;
	}

	private async askNow(mate: SecondMate) {
		const slug = fleetyardMachine(mate.host);
		if (!slug || !mate.host) throw new Error(`${mate.id} is not on a Fleetyard machine.`);
		const machine = this.statuses.get(mate.id)?.machine ?? slug;
		const at = () => new Date(this.now()).toISOString();
		const save = (status: MateLinkStatus, ms: number, answered: boolean) => {
			status = this.remember(mate.id, status);
			this.statuses.set(mate.id, status);
			return { status, ms, answered };
		};
		const c = await this.connector(mate.host);
		if (!c) {
			const problem: LinkProblem = {
				code: 'no-connector',
				text: `${cap(this.here)} has no Fleetyard link set up for ${machine}.`,
				action: null
			};
			return save(
				unknown(machine, this.here, problem, at(), { machines: null, approve: null }),
				0,
				false
			);
		}
		const [r, urls] = await Promise.all([
			this.connectorRun(c, ['machine', 'status', mate.host]),
			this.urls(c)
		]);
		const line = r.ok ? parseMachine(r.stdout) : null;
		if (line) return save(statusOf(line, this.here, urls, at()), r.durationMs, true);
		const problem = r.ok
			? linkProblem('', machine, this.here)
			: linkProblem(saidBy(r), machine, this.here);
		const answered = !['no-answer', 'not-connected', 'unknown'].includes(problem.code);
		return save(unknown(machine, this.here, problem, at(), urls), r.durationMs, answered);
	}

	/**
	 * A machine that is not online cannot say whether it lets this computer in,
	 * so what it last said stands until it can.
	 */
	private remember(id: string, next: MateLinkStatus): MateLinkStatus {
		const last = this.statuses.get(id);
		if (next.approved !== null || next.online !== false || last?.approved == null) return next;
		return { ...next, approved: last.approved };
	}

	/**
	 * Test connection: Fleetyard answers, the machine is online, this computer
	 * is approved on it, and the second mate answers one timed round trip. It
	 * stops at the first that fails, with the reason and what fixes it.
	 */
	async test(mate: SecondMate): Promise<LinkTest> {
		const slug = fleetyardMachine(mate.host) ?? mate.host ?? 'its machine';
		const { status, ms, answered } = await this.ask(mate);
		const machine = status.machine || slug;
		const steps: LinkStep[] = [
			{ key: 'fleetyard', label: 'Fleetyard answers', state: 'skipped', ms: null, problem: null },
			{ key: 'machine', label: `${machine} is online`, state: 'skipped', ms: null, problem: null },
			{
				key: 'approved',
				label: `${cap(this.here)} is approved on ${machine}`,
				state: 'skipped',
				ms: null,
				problem: null
			},
			{ key: 'mate', label: `${mate.id} answers`, state: 'skipped', ms: null, problem: null }
		];
		const done = (roundTripMs: number | null = null): LinkTest => ({
			steps,
			status: this.statuses.get(mate.id) ?? status,
			roundTripMs,
			at: new Date(this.now()).toISOString()
		});
		const bad = (i: number, problem: LinkProblem | null) => {
			steps[i] = {
				...steps[i],
				state: 'bad',
				problem: problem ?? { code: 'unknown', text: 'The link failed.', action: null }
			};
			return done();
		};
		if (!answered) return bad(0, status.problem);
		steps[0] = { ...steps[0], state: 'ok', ms };
		if (status.online !== true) return bad(1, status.problem);
		steps[1] = { ...steps[1], state: 'ok' };
		if (status.approved !== true) return bad(2, status.problem);
		steps[2] = { ...steps[2], state: 'ok' };

		const command = mate.home
			? remoteCommand('test -d "$1"', [mate.home])
			: remoteCommand('true', []);
		const r = await this.run(this.opts.ssh ?? 'ssh', sshArgs(mate.host!, command), {
			timeoutMs: 30_000,
			maxOutputBytes: 16 * 1024
		});
		if (r.ok) {
			steps[3] = { ...steps[3], state: 'ok', ms: r.durationMs };
			return done(r.durationMs);
		}
		if (r.kind === 'exit' && r.code === 1) {
			return bad(3, {
				code: 'mate',
				text: `Reached ${machine}, but ${mate.id}’s home ${mate.home} is not there.`,
				action: null
			});
		}
		if (r.kind === 'timeout') {
			return bad(3, { code: 'mate', text: `${mate.id} didn’t answer within 30 s.`, action: null });
		}
		const said = saidBy(r);
		const problem = /^whc-connector:/.test(said)
			? linkProblem(said, machine, this.here)
			: {
					code: 'mate' as const,
					text: `Could not reach ${mate.id} on ${machine}${said ? `: ${withoutTransport(said)}` : '.'}`,
					action: null
				};
		this.statuses.delete(mate.id);
		return bad(3, problem);
	}

	/** Wake: starts the machine when it is stopped; the card then watches it come up. */
	wake(mate: SecondMate): Promise<MateLinkStatus> {
		return this.machine(mate, 'start');
	}

	/**
	 * Stop: stops the machine, and the second mate on it with it, until Wake. Its work stays
	 * on the machine; Fleetyard keeps its disk.
	 */
	stop(mate: SecondMate): Promise<MateLinkStatus> {
		return this.machine(mate, 'stop');
	}

	private async machine(mate: SecondMate, verb: 'start' | 'stop'): Promise<MateLinkStatus> {
		const slug = fleetyardMachine(mate.host);
		if (!slug || !mate.host) throw new Error(`${mate.id} is not on a Fleetyard machine.`);
		const c = await this.connector(mate.host);
		if (!c) return (await this.ask(mate)).status;
		const machine = this.statuses.get(mate.id)?.machine ?? slug;
		const [r, urls] = await Promise.all([
			this.connectorRun(c, ['machine', verb, mate.host], 60_000),
			this.urls(c)
		]);
		const at = new Date(this.now()).toISOString();
		const line = r.ok ? parseMachine(r.stdout) : null;
		const status = line
			? statusOf(line, this.here, urls, at)
			: unknown(
					machine,
					this.here,
					linkProblem(r.ok ? '' : saidBy(r), machine, this.here),
					at,
					urls
				);
		this.statuses.set(mate.id, this.remember(mate.id, status));
		return this.statuses.get(mate.id)!;
	}

	/**
	 * Connect (pair this computer with Fleetyard) or Approve (offer this
	 * computer's key for the machine), left running while the captain finishes
	 * on Fleetyard: the job names the page to open and the code it should show.
	 */
	async start(mate: SecondMate, kind: LinkJob['kind']): Promise<LinkJob> {
		const running = this.jobs.get(mate.id);
		if (running?.job.state === 'running') return running.job;
		const slug = fleetyardMachine(mate.host);
		if (!slug || !mate.host) throw new Error(`${mate.id} is not on a Fleetyard machine.`);
		const machine = this.statuses.get(mate.id)?.machine ?? slug;
		const c = await this.connector(mate.host);
		const job: LinkJob = {
			kind,
			state: 'running',
			url: null,
			code: null,
			message: null,
			startedAt: new Date(this.now()).toISOString(),
			endedAt: null
		};
		if (!c) {
			job.state = 'failed';
			job.message = `${cap(this.here)} has no Fleetyard link set up for ${machine}.`;
			job.endedAt = job.startedAt;
			this.jobs.set(mate.id, { job, abort: new AbortController() });
			return job;
		}
		const abort = new AbortController();
		this.jobs.set(mate.id, { job, abort });
		const args =
			kind === 'connect'
				? ['pair']
				: ['ssh-setup', mate.host, ...(c.identityFile ? ['--key', c.identityFile] : [])];
		// The answer waits (a few seconds at most) for the page to open, or for the job's end.
		let named: () => void = () => {};
		const ready = new Promise<void>((r) => (named = r));
		let out = '';
		const read = (chunk: Buffer) => {
			out += chunk.toString('utf8');
			const pair = /open ([^\s,]+), type code ([^\s,]+)/.exec(out);
			const approve = /with your passkey, on (\S+)/.exec(out);
			const code =
				/SSH key:\s+(\S+)/.exec(out) ??
				/^\S*\s*(\S+) is this computer's \S+ key, approved/m.exec(out);
			if (kind === 'connect' && pair) [job.url, job.code] = [pair[1], pair[2]];
			if (kind === 'approve' && approve) job.url = approve[1];
			if (kind === 'approve' && code) job.code = code[1];
			if (job.url) named();
		};
		void this.run(
			c.command,
			[...c.args, ...args],
			{
				timeoutMs: kind === 'connect' ? CONNECT_MS : APPROVE_MS,
				maxOutputBytes: 256 * 1024,
				onStdout: read,
				signal: abort.signal
			},
			c.env
		).then((r) => {
			this.statuses.delete(mate.id);
			this.gateway = null;
			if (r.ok) {
				job.state = 'done';
				job.message =
					kind === 'connect'
						? `${cap(this.here)} is connected to Fleetyard.`
						: `${cap(this.here)} is approved for ${machine}.`;
			} else {
				job.state = 'failed';
				job.message =
					r.kind === 'timeout'
						? 'Fleetyard didn’t hear back in time; start again when you’re ready.'
						: linkProblem(saidBy(r), machine, this.here).text;
			}
			job.endedAt = new Date(this.now()).toISOString();
			named();
			void this.status(mate, 0).catch(() => {});
		});
		let waited: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([ready, new Promise((r) => (waited = setTimeout(r, NAMED_MS)))]);
		clearTimeout(waited);
		return job;
	}

	/** Stops every job still running (Wheelhouse is shutting down). */
	close(): void {
		for (const { job, abort } of this.jobs.values()) if (job.state === 'running') abort.abort();
	}
}
