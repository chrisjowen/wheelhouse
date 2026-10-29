/**
 * The watcher around Wheelhouse's own server. `wheelhouse open` runs the
 * server in a child process and restarts it, on the same port, when it dies
 * unexpectedly (a crash or a kill), so the pages that lost it reconnect on
 * their own. It watches nothing else: Firstmate, its session and its crew are
 * never started, stopped or restarted by it.
 *
 * - The child says it is listening with an IPC `ready` message carrying its port.
 * - A child that exits 0 closed on request (Ctrl+C, SIGTERM): the watcher stops too.
 * - A first child that dies before it is ready (a port in use, say) is a
 *   startup failure, not a crash: the watcher stops with its exit code.
 * - Too many restarts within a minute means the server cannot stay up: the
 *   watcher gives up rather than loop.
 */

/** What the watcher needs of a child process (a ChildProcess from fork). */
export interface ServerChild {
	on(event: 'message', fn: (msg: unknown) => void): unknown;
	on(event: 'exit', fn: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

export interface SuperviseOptions {
	/** Start a server child on this port; `restart` is false only for the first. */
	start: (port: number, restart: boolean) => ServerChild;
	port: number;
	/** The first child is listening. */
	onReady: (port: number) => void;
	log: (line: string) => void;
	/** Restarts allowed within `windowMs` before the watcher gives up. */
	maxRestarts?: number;
	windowMs?: number;
	/** The wait before restart number `n` (1-based) within the window. */
	backoffMs?: (n: number) => number;
	/** How long a child gets to close on request before it is killed. */
	killAfterMs?: number;
}

export interface Supervisor {
	/** Settles with the exit code the CLI should exit with. */
	done: Promise<number>;
	/** Close the server on request (Ctrl+C, SIGTERM). */
	stop: () => void;
}

export const MAX_RESTARTS = 5;
export const RESTART_WINDOW_MS = 60_000;
export const backoff = (n: number) => Math.min(500 * 2 ** (n - 1), 8_000);

export function isReady(msg: unknown): msg is { type: 'ready'; port: number } {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		(msg as { type?: unknown }).type === 'ready' &&
		typeof (msg as { port?: unknown }).port === 'number'
	);
}

export function supervise(opts: SuperviseOptions): Supervisor {
	const maxRestarts = opts.maxRestarts ?? MAX_RESTARTS;
	const windowMs = opts.windowMs ?? RESTART_WINDOW_MS;
	const wait = opts.backoffMs ?? backoff;
	let port = opts.port;
	let everReady = false;
	let stopping = false;
	let child: ServerChild | null = null;
	let pending: ReturnType<typeof setTimeout> | null = null;
	let killer: ReturnType<typeof setTimeout> | null = null;
	let restarts: number[] = [];
	let finish: (code: number) => void = () => {};
	const done = new Promise<number>((resolve) => {
		finish = (code) => {
			if (pending) clearTimeout(pending);
			if (killer) clearTimeout(killer);
			pending = killer = null;
			resolve(code);
		};
	});

	const launch = (restart: boolean) => {
		pending = null;
		const c = opts.start(port, restart);
		child = c;
		c.on('message', (msg) => {
			if (!isReady(msg)) return;
			port = msg.port;
			if (!everReady) {
				everReady = true;
				opts.onReady(msg.port);
			} else {
				opts.log(`Wheelhouse's server is back on http://127.0.0.1:${msg.port}/.`);
			}
		});
		c.on('exit', (code, signal) => {
			if (child === c) child = null;
			if (stopping || code === 0) return finish(0);
			if (!everReady) return finish(code ?? 1);
			const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
			const now = Date.now();
			restarts = [...restarts.filter((t) => now - t < windowMs), now];
			if (restarts.length > maxRestarts) {
				opts.log(
					`Wheelhouse's server ${how} and has failed ${restarts.length} times within a minute, so Wheelhouse is closing. Firstmate and its crew are still running.`
				);
				return finish(1);
			}
			const ms = wait(restarts.length);
			opts.log(
				`Wheelhouse's server ${how}; restarting it in ${Math.round(ms / 100) / 10} s. Firstmate and its crew are untouched.`
			);
			pending = setTimeout(() => launch(true), ms);
		});
	};

	launch(false);
	return {
		done,
		stop: () => {
			if (stopping) return;
			stopping = true;
			if (!child) return finish(0);
			child.kill('SIGTERM');
			const c = child;
			killer = setTimeout(() => c.kill('SIGKILL'), opts.killAfterMs ?? 5_000);
			killer.unref?.();
		}
	};
}
