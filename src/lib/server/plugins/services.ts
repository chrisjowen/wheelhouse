import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ServiceSpec, ServiceStatus } from '../../plugins/types';

/**
 * Plugin companion services: a local web UI a first-party plugin declares
 * (improve's review UI, docket's viewer), which Wheelhouse checks and, only on
 * the captain's explicit click, starts. The command comes from the plugin's own
 * code, never from a repository's files; it must serve on loopback, and it runs
 * detached, so it keeps running when Wheelhouse stops. Its output goes to a log
 * in Wheelhouse's state directory.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DEFAULT_READY_MS = 30_000;
const MAX_READY_MS = 120_000;
const MAX_SETUP_MS = 10 * 60_000;
const POLL_MS = 400;
const LOG_TAIL = 2048;
const IDENTITY_MS = 5_000;

/** Why a spec cannot be checked or started here, or null when it can. */
export function refuseSpec(spec: ServiceSpec): string | null {
	for (const [what, u] of [
		['address', spec.url],
		['health check', spec.health],
		...(spec.identity ? [['identity check', spec.identity.url] as const] : [])
	] as const) {
		let url: URL;
		try {
			url = new URL(u);
		} catch {
			return `its ${what} is not a URL.`;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return `its ${what} is not http(s).`;
		}
		if (!LOOPBACK.has(url.hostname)) return `its ${what} is not on this computer (loopback).`;
	}
	if (
		!Array.isArray(spec.argv) ||
		!spec.argv.length ||
		spec.argv.some((a) => typeof a !== 'string')
	) {
		return 'its command is not a list of arguments.';
	}
	if (!path.isAbsolute(spec.cwd)) return 'it names no directory to run in.';
	return null;
}

export interface ServiceHost {
	/** Where launch logs go (Wheelhouse's state directory, never the Firstmate home). */
	logDir: string;
	env?: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
	spawn?: typeof spawn;
	now?: () => number;
}

interface Launch {
	done: Promise<ServiceStatus>;
	child: ChildProcess | null;
}

export class ServiceManager {
	private readonly launches = new Map<string, Launch>();
	private readonly fetch: typeof fetch;
	private readonly spawn: typeof spawn;

	constructor(private readonly host: ServiceHost) {
		this.fetch = host.fetch ?? fetch;
		this.spawn = host.spawn ?? spawn;
	}

	/** Whether the service answers its health check now. */
	async status(key: string, spec: ServiceSpec): Promise<ServiceStatus> {
		const refused = refuseSpec(spec);
		if (refused)
			return { state: 'unavailable', url: null, reason: `It cannot run here: ${refused}` };
		if (this.launches.has(key)) return { state: 'starting', url: spec.url, reason: null };
		const answer = await this.answers(spec);
		if (answer === 'other') return this.other(spec);
		return answer === 'up'
			? { state: 'running', url: spec.url, reason: null }
			: {
					state: 'stopped',
					url: spec.url,
					reason: spec.binds === 'loopback' ? null : this.bindReason()
				};
	}

	/**
	 * Start the service, unless it already answers, and wait until it does. Runs
	 * the spec's setup steps first (say, installing its dependencies). Concurrent
	 * launches of one service share one start.
	 */
	launch(key: string, spec: ServiceSpec): Promise<ServiceStatus> {
		const pending = this.launches.get(key);
		if (pending) return pending.done;
		const refused = refuseSpec(spec);
		if (refused) {
			return Promise.resolve({
				state: 'unavailable',
				url: null,
				reason: `It cannot run here: ${refused}`
			});
		}
		if (spec.binds !== 'loopback') {
			return Promise.resolve({ state: 'unavailable', url: spec.url, reason: this.bindReason() });
		}
		const launch: Launch = { done: Promise.resolve(null as never), child: null };
		launch.done = this.start(key, spec, launch).finally(() => this.launches.delete(key));
		this.launches.set(key, launch);
		return launch.done;
	}

	private bindReason() {
		return 'It listens on every network interface, and Wheelhouse only starts services that listen on this computer alone.';
	}

	private other(spec: ServiceSpec): ServiceStatus {
		return {
			state: 'unavailable',
			url: null,
			reason: `Something else answers at ${spec.url}, so Wheelhouse does not start this one there.`
		};
	}

	private logFile(key: string) {
		return path.join(this.host.logDir, `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.log`);
	}

	private async start(key: string, spec: ServiceSpec, launch: Launch): Promise<ServiceStatus> {
		const first = await this.answers(spec);
		if (first === 'other') return this.other(spec);
		if (first === 'up') return { state: 'running', url: spec.url, reason: null };
		mkdirSync(this.host.logDir, { recursive: true });
		const log = this.logFile(key);
		writeFileSync(log, '');
		const env = this.env(spec);

		for (const step of spec.setup ?? []) {
			const code = await this.runToLog(
				step.argv,
				step.cwd ?? spec.cwd,
				env,
				log,
				Math.min(step.timeoutMs, MAX_SETUP_MS),
				launch
			);
			if (code !== 0) {
				return this.failed(
					spec,
					`${step.label} did not finish (${code === null ? 'it ran out of time' : `exit ${code}`}).`,
					log
				);
			}
		}

		let exited: number | null | undefined;
		const fd = openSync(log, 'a');
		try {
			const child = this.spawn(spec.argv[0], spec.argv.slice(1), {
				cwd: spec.cwd,
				env,
				detached: true,
				stdio: ['ignore', fd, fd]
			});
			launch.child = child;
			child.on('exit', (code) => (exited = code));
			child.on('error', () => (exited = exited ?? -1));
			child.unref();
		} catch (e) {
			return this.failed(spec, `it could not be started: ${(e as Error).message}.`, log);
		} finally {
			closeSync(fd);
		}

		const until = Date.now() + Math.min(spec.readyTimeoutMs ?? DEFAULT_READY_MS, MAX_READY_MS);
		while (Date.now() < until) {
			const answer = await this.answers(spec);
			if (answer === 'other') return this.other(spec);
			if (answer === 'up') return { state: 'running', url: spec.url, reason: null };
			if (exited !== undefined)
				return this.failed(spec, `it stopped (exit ${exited ?? 'signal'}).`, log);
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		return this.failed(spec, 'it did not answer in time; it may still be starting.', log);
	}

	private env(spec: ServiceSpec): NodeJS.ProcessEnv {
		const env = this.host.env ?? process.env;
		return {
			PATH: env.PATH ?? '/usr/bin:/bin',
			HOME: env.HOME ?? '',
			LANG: env.LANG ?? 'C.UTF-8',
			...(spec.env ?? {})
		};
	}

	private runToLog(
		argv: string[],
		cwd: string,
		env: NodeJS.ProcessEnv,
		log: string,
		timeoutMs: number,
		launch: Launch
	): Promise<number | null> {
		return new Promise((resolve) => {
			const fd = openSync(log, 'a');
			let child: ChildProcess;
			try {
				child = this.spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', fd, fd] });
			} catch {
				closeSync(fd);
				resolve(-1);
				return;
			}
			closeSync(fd);
			launch.child = child;
			const timer = setTimeout(() => {
				child.kill('SIGTERM');
				resolve(null);
			}, timeoutMs);
			child.on('exit', (code) => {
				clearTimeout(timer);
				resolve(code ?? -1);
			});
			child.on('error', () => {
				clearTimeout(timer);
				resolve(-1);
			});
		});
	}

	private failed(spec: ServiceSpec, why: string, log: string): ServiceStatus {
		return { state: 'failed', url: spec.url, reason: `It did not start: ${why}`, log: tail(log) };
	}

	/** Whether the service answers its health check, and, when it says how, whether it is the one asked for. */
	private async answers(spec: ServiceSpec): Promise<'up' | 'down' | 'other'> {
		try {
			const r = await this.fetch(spec.health, {
				signal: AbortSignal.timeout(800),
				redirect: 'manual'
			});
			if (!r.ok) return 'down';
		} catch {
			return 'down';
		}
		const id = spec.identity;
		if (!id) return 'up';
		try {
			const r = await this.fetch(id.url, {
				signal: AbortSignal.timeout(IDENTITY_MS),
				redirect: 'manual'
			});
			if (!r.ok) return 'up';
			let v: unknown = await r.json();
			for (const k of id.path) {
				v = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined;
			}
			return v === undefined || v === id.value ? 'up' : 'other';
		} catch {
			return 'up';
		}
	}
}

/** The end of a launch log, for the page to show when a start fails. */
function tail(file: string): string {
	let fd: number;
	try {
		fd = openSync(file, 'r');
	} catch {
		return '';
	}
	try {
		const size = fstatSync(fd).size;
		const buf = Buffer.alloc(Math.min(size, LOG_TAIL));
		const n = readSync(fd, buf, 0, buf.length, size - buf.length);
		const text = buf.subarray(0, n).toString('utf8');
		return size > LOG_TAIL ? `…${text}` : text;
	} catch {
		return '';
	} finally {
		closeSync(fd);
	}
}
