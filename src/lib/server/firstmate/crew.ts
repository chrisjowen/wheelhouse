import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from './exec';
import { DEFAULT_SERVER, TASK_ID } from './adapter';
import { DEFAULT_TMUX_SOCKET, sessionEnv, TMUX_SOCKET, which, type Run } from '../sessions/tmux';

/**
 * Which tmux server a crewmate's terminal is on, worked out per task from
 * Firstmate's own records.
 *
 * Firstmate's tmux backend has no notion of a server: fm-spawn.sh opens a
 * task's window in the current session of whatever server its ambient TMUX
 * names, or - with no TMUX - in a `firstmate` session on tmux's default
 * server, and records only `window=<session>:<window>` in state/<id>.meta.
 * fm-peek.sh and fm-crew-state.sh then read that target on the server their
 * own ambient TMUX names. So the server a window is on depends on the
 * environment Firstmate spawned it from (its primary's shell has no TMUX
 * today, so the crew are on the default server, while Firstmate's own session
 * is on Wheelhouse's), and no environment Wheelhouse happens to inherit says
 * anything about it.
 *
 * Instead, each script that reads a crewmate's terminal is pointed at the
 * server that actually has that task's recorded window: Wheelhouse's own
 * server, tmux's default server, and the server of any TMUX Wheelhouse was
 * started with are each asked for their windows, and the first with an exact
 * `<session>:<window>` match wins. Asked on every call, so it follows a worker
 * across restarts of tmux, Firstmate or Wheelhouse.
 */

/** A crew window that is on no server is looked for where Firstmate puts crew outside tmux. */
export const CREW_FALLBACK = DEFAULT_SERVER;

const TMUX_TIMEOUT_MS = 5_000;
const META_MAX_BYTES = 64 * 1024;
const LIST_MAX_BYTES = 1024 * 1024;
/** One window per line: its server's TMUX value, then its ids, then the session and window names. */
const WINDOW_FORMAT =
	'#{socket_path},#{pid},#{session_id}\t#{window_id}\t#{window_index}\t#{session_name}\t#{window_name}';

export interface CrewTmuxOptions {
	/** Firstmate's operational home; task records are under its state/. */
	homeDir: string;
	/** --tmux-socket / WHEELHOUSE_TMUX_SOCKET. */
	tmuxSocket?: string | null;
	/** Wheelhouse's own environment (its TMUX, if any, is one more server to look on). */
	env?: NodeJS.ProcessEnv;
	find?: (name: string) => string | null;
	run?: Run;
}

/** The tmux endpoint a task's meta records, or null when its terminal is not a local tmux window. */
export interface CrewEndpoint {
	session: string;
	window: string;
}

/** The last value of `key` in a meta file, as fm_meta_get reads it. */
function metaGet(text: string, key: string): string {
	let value = '';
	for (const line of text.split('\n'))
		if (line.startsWith(`${key}=`)) value = line.slice(key.length + 1);
	return value;
}

/**
 * The local tmux window a meta records: `window=<session>:<window>` for the
 * tmux backend (`backend=` absent or `tmux`), and nothing for another backend
 * or a remote secondmate, whose terminals are not tmux windows on this machine.
 */
export function crewEndpoint(meta: string): CrewEndpoint | null {
	const backend = metaGet(meta, 'backend') || 'tmux';
	if (backend !== 'tmux' || metaGet(meta, 'remote_host')) return null;
	const m = /^([^:]+):(.+)$/.exec(metaGet(meta, 'window'));
	return m ? { session: m[1], window: m[2] } : null;
}

interface Window {
	tmux: string;
	session: string;
	names: string[];
}

function parseWindows(stdout: string): Window[] {
	const out: Window[] = [];
	for (const line of stdout.split('\n')) {
		const [tmux, id, index, session, ...name] = line.split('\t');
		if (!session || !/^\/.*,\d+,\$\d+$/.test(tmux)) continue;
		out.push({
			tmux: tmux.replace(/,\$(\d+)$/, ',$1'),
			session,
			names: [name.join('\t'), id, index]
		});
	}
	return out;
}

const matches = (w: Window, e: CrewEndpoint) =>
	w.session === e.session && w.names.includes(e.window);

/**
 * The TMUX value for the server holding a task's window (`crew(id)`), or for
 * the server holding most of the fleet's windows (`crew()`, for the fleet
 * snapshot, which reads every task's terminal in one script run). A tmux
 * window found on no server gets CREW_FALLBACK; null (leave the environment as
 * it is) means the terminal is not a local tmux window, or there is no record.
 */
export function crewTmux(opts: CrewTmuxOptions): (taskId?: string) => Promise<string | null> {
	const state = path.join(opts.homeDir, 'state');
	const socket = opts.tmuxSocket || DEFAULT_TMUX_SOCKET;
	const own = opts.env ?? process.env;
	const env = sessionEnv(own);
	const find = opts.find ?? ((name) => which(name, env.PATH));
	const run = opts.run ?? runBounded;

	async function readMeta(id: string): Promise<string | null> {
		const file = path.join(state, `${id}.meta`);
		try {
			const st = await lstat(file);
			if (!st.isFile() || st.size > META_MAX_BYTES) return null;
			return await readFile(file, 'utf8');
		} catch {
			return null;
		}
	}

	async function endpoints(taskId?: string): Promise<CrewEndpoint[] | null> {
		if (taskId !== undefined) {
			if (!TASK_ID.test(taskId)) return null;
			const meta = await readMeta(taskId);
			const e = meta === null ? null : crewEndpoint(meta);
			return e ? [e] : null;
		}
		let names: string[];
		try {
			names = await readdir(state);
		} catch {
			return null;
		}
		const ids = names.filter((n) => n.endsWith('.meta')).map((n) => n.slice(0, -'.meta'.length));
		const metas = await Promise.all(ids.filter((id) => TASK_ID.test(id)).map(readMeta));
		const found = metas.map((m) => (m === null ? null : crewEndpoint(m)));
		const out = found.filter((e): e is CrewEndpoint => e !== null);
		return out.length ? out : null;
	}

	/** The servers to look on, in order: Wheelhouse's own, tmux's default, then any Wheelhouse inherited. */
	function servers(): string[][] {
		const list: string[][] = [];
		if (TMUX_SOCKET.test(socket)) list.push(['-L', socket]);
		list.push([]);
		const inherited = own.TMUX?.replace(/,[^,]*,[^,]*$/, '');
		if (inherited?.startsWith('/')) list.push(['-S', inherited]);
		return list;
	}

	return async (taskId) => {
		const wanted = await endpoints(taskId);
		if (!wanted) return null;
		const tmux = find('tmux');
		if (!tmux) return CREW_FALLBACK;
		const listed = await Promise.all(
			servers().map(async (server) => {
				const r = await run(tmux, [...server, 'list-windows', '-a', '-F', WINDOW_FORMAT], {
					env,
					timeoutMs: TMUX_TIMEOUT_MS,
					maxOutputBytes: LIST_MAX_BYTES
				});
				return r.ok ? parseWindows(r.stdout) : [];
			})
		);
		let best: { tmux: string; count: number } | null = null;
		for (const windows of listed) {
			const hits = windows.filter((w) => wanted.some((e) => matches(w, e)));
			if (hits.length && (!best || hits.length > best.count)) {
				best = { tmux: hits[0].tmux, count: hits.length };
			}
		}
		return best?.tmux ?? CREW_FALLBACK;
	};
}
