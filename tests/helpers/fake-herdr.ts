import type { RunOptions, RunResult } from '../../src/lib/server/firstmate/exec';
import type { SpawnServer } from '../../src/lib/server/sessions/herdr';

/**
 * A stand-in for the herdr CLI (0.7.4, protocol 16), in memory, for unit
 * tests: it answers the calls the herdr session backend makes with the shapes
 * the real herdr gives (JSON on stdout; errors as JSON on stderr in either of
 * herdr's two shapes, or as plain text while the server is down) and records
 * every call. It never runs a real herdr.
 *
 * It refuses any call that does not name its session with `--session` before
 * any `--`, and records lifecycle calls (server stop, session stop or delete)
 * so a test can assert there were none.
 */

export interface FakePane {
	/** The agent name it was started under; herdr keeps it across a server restart. */
	name: string;
	terminalId: string;
	argv: string[];
	env: Record<string, string>;
	cwd: string;
	/** What `pane read` prints. */
	screen: string;
	/** Everything `pane send-text` delivered, in order. */
	text: string[];
	/** Every key `pane send-keys` pressed, in order. */
	keys: string[];
	size: [number, number];
}

export interface FakeHerdr {
	run: (file: string, args: readonly string[], opts: RunOptions) => Promise<RunResult>;
	spawnServer: SpawnServer;
	calls: { file: string; args: readonly string[]; opts: RunOptions }[];
	/** The herdr argument lists, without the `--session <name>` the backend adds. */
	args: () => string[][];
	/** Calls that would stop or restart a herdr server or session. */
	lifecycle: () => string[][];
	servers: { file: string; args: string[] }[];
	state: {
		running: boolean;
		version: string;
		protocol: number;
		serverVersion: string;
		serverProtocol: number;
		compatible: boolean;
		/** spawnServer brings the server up (default true). */
		spawnStarts: boolean;
		panes: Map<string, FakePane>;
		/** The next call matching this prefix fails with this stderr. */
		fail: { prefix: string; stderr: string } | null;
		/** What a pressed key does to the screen. */
		onKey: ((pane: FakePane, key: string) => void) | null;
	};
	/** A server restart: herdr restores each pane under its id, with a new terminal running a shell. */
	restart: () => void;
	/** The process in a pane exits: herdr removes the pane. */
	exit: (pane: string) => void;
}

const KEYS = new Set(['Enter', 'Escape', 'Up', 'Down', ...'0123456789']);
const ok = (stdout = ''): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 1 });
const fail = (stderr: string): RunResult => ({
	ok: false,
	kind: 'exit',
	code: 1,
	signal: null,
	stdout: '',
	stderr,
	message: 'exited with code 1',
	durationMs: 1
});
const notFound = (pane: string, id: string) =>
	fail(
		JSON.stringify({ error: { code: 'pane_not_found', message: `pane ${pane} not found` }, id })
	);

export function fakeHerdr(session: string, herdrFile = '/opt/bin/herdr'): FakeHerdr {
	const calls: FakeHerdr['calls'] = [];
	const servers: FakeHerdr['servers'] = [];
	let terminals = 0;
	let panes = 0;
	const state: FakeHerdr['state'] = {
		running: true,
		version: '0.7.4',
		protocol: 16,
		serverVersion: '0.7.4',
		serverProtocol: 16,
		compatible: true,
		spawnStarts: true,
		panes: new Map(),
		fail: null,
		onKey: null
	};
	const terminal = () => `term_${(++terminals).toString(16).padStart(14, '0')}`;

	/** The call's own arguments, once `--session <session>` is checked and taken out. */
	function strip(args: readonly string[]): string[] | null {
		const dash = args.indexOf('--');
		const head = dash < 0 ? [...args] : args.slice(0, dash);
		const at = head.indexOf('--session');
		if (at < 0 || head[at + 1] !== session) return null;
		if (head.filter((a) => a === '--session').length !== 1) return null;
		head.splice(at, 2);
		return dash < 0 ? head : [...head, ...args.slice(dash)];
	}

	const args = () =>
		calls.map((c) => strip(c.args) ?? [...c.args]).filter((a): a is string[] => !!a);

	const run: FakeHerdr['run'] = async (file, all, opts) => {
		calls.push({ file, args: all, opts });
		if (file !== herdrFile) return fail(`not herdr: ${file}`);
		for (const name of ['HERDR_SOCKET_PATH', 'HERDR_SESSION', 'HERDR_PANE_ID'])
			if (opts.env?.[name] !== undefined) return fail(`inherited ${name}`);
		const a = strip(all);
		if (!a) return fail('error: every call must name the session with --session');
		if (state.fail && a.join(' ').startsWith(state.fail.prefix)) {
			const { stderr } = state.fail;
			state.fail = null;
			return fail(stderr);
		}
		if (a[0] === 'status' && a[1] === '--json') {
			return ok(
				JSON.stringify({
					client: { version: state.version, protocol: state.protocol, session },
					server: state.running
						? {
								status: 'running',
								running: true,
								version: state.serverVersion,
								protocol: state.serverProtocol,
								compatible: state.compatible,
								session
							}
						: {
								status: 'not_running',
								running: false,
								version: null,
								protocol: null,
								compatible: null,
								session
							}
				})
			);
		}
		if (!state.running)
			return fail('Error: Os { code: 2, kind: NotFound, message: "No such file or directory" }');
		const [group, verb, target] = a;
		if (group === 'agent' && verb === 'start') {
			const dash = a.indexOf('--');
			const opt = a.slice(3, dash);
			const env: Record<string, string> = {};
			let cwd = '/';
			for (let i = 0; i < opt.length; i++) {
				if (opt[i] === '--env') {
					const [k, ...v] = opt[++i].split('=');
					env[k] = v.join('=');
				} else if (opt[i] === '--cwd') cwd = opt[++i];
			}
			// As herdr does: an agent name names one pane, restored ones included.
			const taken = [...state.panes.entries()].find(([, p]) => p.name === target);
			if (taken)
				return fail(
					JSON.stringify({
						error: {
							code: 'agent_name_taken',
							message: `agent name ${target} is already used; candidates: terminal_id=${taken[1].terminalId} pane_id=${taken[0]}`
						},
						id: 'cli:agent:start'
					})
				);
			const paneId = `w1:p${++panes}`;
			const pane: FakePane = {
				name: target,
				terminalId: terminal(),
				argv: a.slice(dash + 1),
				env,
				cwd,
				screen: '',
				text: [],
				keys: [],
				size: [53, 23]
			};
			state.panes.set(paneId, pane);
			return ok(
				JSON.stringify({
					id: 'cli:agent:start',
					result: {
						agent: {
							agent_status: 'unknown',
							name: target,
							pane_id: paneId,
							terminal_id: pane.terminalId,
							tab_id: 'w1:t1',
							workspace_id: 'w1'
						},
						argv: pane.argv,
						type: 'agent_started'
					}
				})
			);
		}
		if (group === 'terminal' && verb === 'session' && target === 'control') {
			const id = a[3];
			const pane = [...state.panes.values()].find((p) => p.terminalId === id);
			if (!pane)
				return ok(
					JSON.stringify({
						reason: `terminal session control failed: terminal target ${id} not found`,
						type: 'terminal.closed'
					})
				);
			pane.size = [Number(a[a.indexOf('--cols') + 1]), Number(a[a.indexOf('--rows') + 1])];
			return ok(JSON.stringify({ reason: 'detached', type: 'terminal.closed' }));
		}
		if (group === 'pane') {
			const pane = state.panes.get(target);
			if (verb === 'read') {
				if (!pane)
					return fail(
						JSON.stringify({ code: 'pane_not_found', message: `pane ${target} not found` })
					);
				return ok(pane.screen);
			}
			if (!pane) return notFound(target, verb === 'get' ? 'cli:pane:get' : 'cli:request');
			if (verb === 'get') {
				return ok(
					JSON.stringify({
						id: 'cli:pane:get',
						result: {
							pane: {
								agent_status: 'unknown',
								pane_id: target,
								terminal_id: pane.terminalId,
								workspace_id: 'w1'
							},
							type: 'pane_info'
						}
					})
				);
			}
			if (verb === 'send-text') {
				pane.text.push(a.slice(3).join(' '));
				return ok();
			}
			if (verb === 'send-keys') {
				for (const key of a.slice(3)) {
					if (!KEYS.has(key))
						return fail(
							JSON.stringify({
								error: { code: 'invalid_key', message: `unsupported key ${key}` },
								id: 'cli:request'
							})
						);
					pane.keys.push(key);
					state.onKey?.(pane, key);
				}
				return ok();
			}
		}
		return fail(`fake herdr: unsupported call ${a.join(' ')}`);
	};

	const spawnServer: SpawnServer = (file, args) => {
		servers.push({ file, args });
		if (args.join(' ') === `server --session ${session}` && state.spawnStarts) state.running = true;
	};

	return {
		run,
		spawnServer,
		calls,
		args,
		lifecycle: () =>
			args().filter(
				(a) =>
					(a[0] === 'server' && a[1] !== undefined) ||
					(a[0] === 'session' && ['stop', 'delete'].includes(a[1]))
			),
		servers,
		state,
		restart() {
			state.running = true;
			for (const pane of state.panes.values()) {
				pane.terminalId = terminal();
				pane.argv = ['bash'];
				pane.screen = 'user@host:~$ ';
			}
		},
		exit(pane) {
			state.panes.delete(pane);
		}
	};
}
