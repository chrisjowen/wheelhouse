import { existsSync } from 'node:fs';
import { runBounded, type RunResult } from './exec';
import {
	ContractError,
	parseFleetSnapshot,
	parseInboxNote,
	parseInboxReceipts,
	parsePeekOutput,
	parsePrimaryReady,
	type FleetSnapshot,
	type InboxNoteResult,
	type InboxReceipts,
	type PrimaryReady
} from './contracts';
import { scriptPath, type FirstmateInstall } from './install';
import { scriptEnv } from './scriptenv';

/**
 * The Firstmate integration: one TypeScript interface over the supported
 * scripts. Scripts run with argument arrays, bounded output and timeouts (see
 * exec.ts), with FM_HOME pointing at the operational home. stdin is closed
 * except for a note's body, which is written to stdin with a size bound.
 *
 * The only write is `note`, which hands a message to Firstmate through
 * `fm-inbox.sh note --request-id <id> --json -`. A repeat of the same request
 * id returns the original note, so a retry never creates a second message.
 */

export type AdapterErrorKind =
	| 'missing-script'
	| 'timeout'
	| 'exit'
	| 'output-limit'
	| 'spawn-error'
	| 'malformed'
	| 'invalid-argument';

export interface AdapterError {
	kind: AdapterErrorKind;
	script: string;
	message: string;
	/** The script's exit code, when it exited on its own. */
	exitCode?: number | null;
}

export type AdapterResult<T> =
	| { ok: true; value: T; observedAt: string; durationMs: number }
	| { ok: false; error: AdapterError; observedAt: string };

export interface PeekOutput {
	lines: string[];
	requested: number;
}

export interface ReceiptsQuery {
	/** Only replies after this cursor. */
	after?: string;
	/** Lift the pending and handled bounds (used when a note we track was omitted). */
	allNotes?: boolean;
}

export interface FirstmateAdapter {
	snapshot(): Promise<AdapterResult<FleetSnapshot>>;
	ready(): Promise<AdapterResult<PrimaryReady>>;
	peek(taskId: string, lines: number): Promise<AdapterResult<PeekOutput>>;
	/**
	 * A bounded, read-only look at a remote second mate's own terminal, on its
	 * host: `fm-on.sh <id> fm-remote-secondmate-control.sh capture <id> <lines>`
	 * (at most REMOTE_PEEK_MAX_LINES). Exit 255 (REMOTE_UNREACHABLE) means the
	 * host could not be reached or the call's end is unknown; it is never retried here.
	 */
	remotePeek(mateId: string, lines: number): Promise<AdapterResult<PeekOutput>>;
	/**
	 * A file in a remote second mate's home, read-only and bounded:
	 * `fm-on.sh <id> fm-remote-file.sh get <path> <max-bytes>` (a larger file is refused).
	 */
	remoteFile(mateId: string, rel: string, maxBytes: number): Promise<AdapterResult<string>>;
	/**
	 * A bounded, read-only look at a worker's terminal in a second mate's home:
	 * on a remote host `fm-on.sh <id> fm-peek.sh <task> <lines>`; on this
	 * computer fm-peek.sh with FM_HOME set to that home.
	 */
	matePeekTask(mate: MateRoute, taskId: string, lines: number): Promise<AdapterResult<PeekOutput>>;
	/**
	 * Hand a note to a second mate, as `note` hands one to Firstmate: to that
	 * second mate's own inbox (`fm-inbox.sh note --request-id <id> --json -`),
	 * on its host through `fm-on.sh --stdin`, or on this computer with FM_HOME
	 * set to its home. The request id makes a repeat return the first note.
	 */
	mateNote(
		mate: MateRoute,
		requestId: string,
		body: string
	): Promise<AdapterResult<InboxNoteResult>>;
	/**
	 * Hand a message to Firstmate. Exit 0 and exit 3 (saved, but Firstmate was not
	 * woken) both succeed with the note; exit 3 always reports `announced: false`.
	 */
	note(requestId: string, body: string): Promise<AdapterResult<InboxNoteResult>>;
	receipts(query?: ReceiptsQuery): Promise<AdapterResult<InboxReceipts>>;
}

export interface ScriptAdapterOptions {
	snapshotTimeoutMs?: number;
	readyTimeoutMs?: number;
	peekTimeoutMs?: number;
	remotePeekTimeoutMs?: number;
	noteTimeoutMs?: number;
	receiptsTimeoutMs?: number;
	env?: NodeJS.ProcessEnv;
	/**
	 * The TMUX value for the tmux server Firstmate's session runs on, asked before
	 * each script (see firstmateTmux); null leaves the ambient TMUX as it is.
	 */
	tmux?: () => Promise<string | null>;
	/**
	 * The tmux server for the scripts that read a crewmate's terminal, asked
	 * before each one: the task's own for `peek`, the fleet's for `snapshot` (see
	 * crewTmux). A TMUX value, DEFAULT_SERVER, or null to leave the ambient TMUX.
	 */
	crew?: (taskId?: string) => Promise<string | null>;
}

/** No TMUX at all: tmux's default server. */
export const DEFAULT_SERVER = 'default';

/** The socket path of a TMUX value ("<socket path>,<server pid>,<session index>"). */
const tmuxSocketPath = (value: string) => value.replace(/,[^,]*,[^,]*$/, '');

/**
 * The script environment with TMUX pointing at `tmux`'s server (or at none, for
 * DEFAULT_SERVER), unless the ambient TMUX already does. A TMUX_PANE from
 * another server means nothing there.
 */
export function withTmux(env: NodeJS.ProcessEnv, tmux: string | null): NodeJS.ProcessEnv {
	if (!tmux) return env;
	if (tmux === DEFAULT_SERVER) {
		if (env.TMUX === undefined && env.TMUX_PANE === undefined) return env;
		const out: NodeJS.ProcessEnv = { ...env };
		delete out.TMUX;
		delete out.TMUX_PANE;
		return out;
	}
	if (env.TMUX && tmuxSocketPath(env.TMUX) === tmuxSocketPath(tmux)) return env;
	const out: NodeJS.ProcessEnv = { ...env, TMUX: tmux };
	delete out.TMUX_PANE;
	return out;
}

/** Where a second mate's home is: on another host (reached by fm-on.sh), or on this computer. */
export type MateRoute = { id: string; remote: true } | { id: string; remote: false; home: string };

/** Task ids are plain slugs; anything else never reaches a script argument. */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PEEK_MAX_LINES = 200;
/** The largest file read from a remote second mate's home. */
export const REMOTE_FILE_MAX_BYTES = 1024 * 1024;
/** A path relative to a Firstmate home, of plain path segments. */
const SAFE_REL = /^(?![./])[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
/** fm-remote-secondmate-control.sh capture's own cap. */
export const REMOTE_PEEK_MAX_LINES = 100;
/** fm-on.sh: the host could not be reached, or whether the remote command ended is unknown. */
export const REMOTE_UNREACHABLE = 255;
export const PEEK_DEFAULT_LINES = 40;
/** fm-inbox.sh's request id rule: 1-128 of A-Za-z0-9._:- and no leading dot. */
export const REQUEST_ID = /^(?!\.)[A-Za-z0-9._:-]{1,128}$/;
/** The largest message body Wheelhouse writes to fm-inbox.sh's stdin. */
export const NOTE_MAX_BYTES = 16 * 1024;
/** fm-inbox.sh note: saved, but Firstmate's wake could not be appended. */
export const NOTE_EXIT_UNANNOUNCED = 3;

const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
const READY_MAX_BYTES = 64 * 1024;
const PEEK_MAX_BYTES = 512 * 1024;
const NOTE_RESULT_MAX_BYTES = 64 * 1024;
const RECEIPTS_MAX_BYTES = 8 * 1024 * 1024;

function invalid<T>(script: string, message: string): AdapterResult<T> {
	return {
		ok: false,
		observedAt: new Date().toISOString(),
		error: { kind: 'invalid-argument', script, message }
	};
}

export function createScriptAdapter(
	install: FirstmateInstall,
	opts: ScriptAdapterOptions = {}
): FirstmateAdapter {
	const env: NodeJS.ProcessEnv = {
		...scriptEnv(opts.env ?? process.env),
		FM_HOME: install.homeDir
	};

	async function run<T>(
		name: string,
		args: string[],
		limits: {
			timeoutMs: number;
			maxOutputBytes: number;
			input?: string;
			maxInputBytes?: number;
			/** Non-zero exit codes whose stdout still carries the result. */
			okExitCodes?: number[];
			/** The tmux server to run on, when not Firstmate's session's (opts.tmux). */
			tmux?: () => Promise<string | null>;
			/** Another Firstmate home on this computer (a local second mate's) to run in. */
			home?: string;
		},
		parse: (r: { stdout: string; exitCode: number }) => T
	): Promise<AdapterResult<T>> {
		const file = scriptPath(install.firstmateDir, name);
		const observedAt = () => new Date().toISOString();
		if (!existsSync(file)) {
			return {
				ok: false,
				observedAt: observedAt(),
				error: { kind: 'missing-script', script: name, message: `${name} is missing` }
			};
		}
		const ask = limits.tmux ?? opts.tmux;
		const tmux = ask ? await ask().catch(() => null) : null;
		const r: RunResult = await runBounded(file, args, {
			cwd: limits.home ?? install.homeDir,
			env: withTmux(limits.home ? { ...env, FM_HOME: limits.home } : env, tmux),
			timeoutMs: limits.timeoutMs,
			maxOutputBytes: limits.maxOutputBytes,
			input: limits.input,
			maxInputBytes: limits.maxInputBytes
		});
		const accepted =
			!r.ok && r.kind === 'exit' && r.code !== null && !!limits.okExitCodes?.includes(r.code);
		if (!r.ok && !accepted) {
			const detail = r.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
			return {
				ok: false,
				observedAt: observedAt(),
				error: {
					// Scripts are never given an abort signal, so `aborted` cannot happen here.
					kind:
						r.kind === 'input-limit' ? 'invalid-argument' : r.kind === 'aborted' ? 'exit' : r.kind,
					script: name,
					message: detail ? `${name} ${r.message}: ${detail}` : `${name} ${r.message}`,
					exitCode: r.kind === 'exit' ? r.code : null
				}
			};
		}
		try {
			const exitCode = r.ok ? 0 : (r.code ?? 0);
			const value = parse({ stdout: r.stdout, exitCode });
			return { ok: true, value, observedAt: observedAt(), durationMs: r.durationMs };
		} catch (e) {
			return {
				ok: false,
				observedAt: observedAt(),
				error: {
					kind: 'malformed',
					script: name,
					message: e instanceof ContractError ? e.message : `${name}: ${(e as Error).message}`
				}
			};
		}
	}

	/** The crew's server for a script that reads crewmates' terminals. */
	const crew = (taskId?: string) => (opts.crew ? () => opts.crew!(taskId) : undefined);

	return {
		snapshot: () =>
			run(
				'fm-fleet-snapshot.sh',
				['--json'],
				{
					// Room for the remote summary reads' own budget (scriptenv.ts) and the local reads.
					timeoutMs: opts.snapshotTimeoutMs ?? 60_000,
					maxOutputBytes: SNAPSHOT_MAX_BYTES,
					tmux: crew()
				},
				(r) => parseFleetSnapshot(r.stdout)
			),
		ready: () =>
			run(
				'fm-inbox.sh',
				['ready'],
				{ timeoutMs: opts.readyTimeoutMs ?? 10_000, maxOutputBytes: READY_MAX_BYTES },
				(r) => parsePrimaryReady(r.stdout)
			),
		peek: async (taskId, lines) => {
			if (!TASK_ID.test(taskId)) {
				return {
					ok: false,
					observedAt: new Date().toISOString(),
					error: { kind: 'invalid-argument', script: 'fm-peek.sh', message: 'invalid task id' }
				};
			}
			const n = Math.min(PEEK_MAX_LINES, Math.max(1, Math.floor(lines) || PEEK_DEFAULT_LINES));
			return run(
				'fm-peek.sh',
				[taskId, String(n)],
				{
					timeoutMs: opts.peekTimeoutMs ?? 10_000,
					maxOutputBytes: PEEK_MAX_BYTES,
					tmux: crew(taskId)
				},
				(r) => ({ lines: parsePeekOutput(r.stdout, n), requested: n })
			);
		},
		remotePeek: async (mateId, lines) => {
			if (!TASK_ID.test(mateId)) {
				return {
					ok: false,
					observedAt: new Date().toISOString(),
					error: { kind: 'invalid-argument', script: 'fm-on.sh', message: 'invalid second mate id' }
				};
			}
			const n = Math.min(
				REMOTE_PEEK_MAX_LINES,
				Math.max(1, Math.floor(lines) || PEEK_DEFAULT_LINES)
			);
			return run(
				'fm-on.sh',
				[mateId, 'fm-remote-secondmate-control.sh', 'capture', mateId, String(n)],
				{ timeoutMs: opts.remotePeekTimeoutMs ?? 20_000, maxOutputBytes: PEEK_MAX_BYTES },
				(r) => ({ lines: parsePeekOutput(r.stdout, n), requested: n })
			);
		},
		remoteFile: async (mateId, rel, maxBytes) => {
			if (!TASK_ID.test(mateId) || !SAFE_REL.test(rel) || rel.split('/').includes('..')) {
				return invalid('fm-on.sh', 'invalid second mate id or path');
			}
			const max = Math.max(1, Math.min(Math.floor(maxBytes) || 1, REMOTE_FILE_MAX_BYTES));
			return run(
				'fm-on.sh',
				[mateId, 'fm-remote-file.sh', 'get', rel, String(max)],
				{ timeoutMs: opts.remotePeekTimeoutMs ?? 20_000, maxOutputBytes: max },
				(r) => r.stdout
			);
		},
		matePeekTask: async (mate, taskId, lines) => {
			if (!TASK_ID.test(mate.id) || !TASK_ID.test(taskId)) {
				return invalid('fm-peek.sh', 'invalid second mate or task id');
			}
			const n = Math.min(PEEK_MAX_LINES, Math.max(1, Math.floor(lines) || PEEK_DEFAULT_LINES));
			const parse = (r: { stdout: string }) => ({
				lines: parsePeekOutput(r.stdout, n),
				requested: n
			});
			if (mate.remote) {
				return run(
					'fm-on.sh',
					[mate.id, 'fm-peek.sh', taskId, String(n)],
					{ timeoutMs: opts.remotePeekTimeoutMs ?? 20_000, maxOutputBytes: PEEK_MAX_BYTES },
					parse
				);
			}
			return run(
				'fm-peek.sh',
				[taskId, String(n)],
				{
					timeoutMs: opts.peekTimeoutMs ?? 10_000,
					maxOutputBytes: PEEK_MAX_BYTES,
					tmux: crew(),
					home: mate.home
				},
				parse
			);
		},
		mateNote: async (mate, requestId, body) => {
			if (!TASK_ID.test(mate.id)) return invalid('fm-inbox.sh', 'invalid second mate id');
			if (!REQUEST_ID.test(requestId)) return invalid('fm-inbox.sh', 'invalid request id');
			if (!body.trim()) return invalid('fm-inbox.sh', 'the message is empty');
			if (Buffer.byteLength(body) > NOTE_MAX_BYTES) {
				return invalid('fm-inbox.sh', `the message is longer than ${NOTE_MAX_BYTES} bytes`);
			}
			const note = ['note', '--request-id', requestId, '--json', '-'];
			const limits = {
				timeoutMs: opts.noteTimeoutMs ?? 20_000,
				maxOutputBytes: NOTE_RESULT_MAX_BYTES,
				input: body,
				maxInputBytes: NOTE_MAX_BYTES,
				okExitCodes: [NOTE_EXIT_UNANNOUNCED]
			};
			const parse = (r: { stdout: string; exitCode: number }) => {
				const n = parseInboxNote(r.stdout);
				if (n.requestId !== null && n.requestId !== requestId) {
					throw new ContractError(
						`fm-inbox.sh answered for request id ${n.requestId}, not ${requestId}`
					);
				}
				return r.exitCode === NOTE_EXIT_UNANNOUNCED ? { ...n, announced: false } : n;
			};
			return mate.remote
				? run('fm-on.sh', ['--stdin', mate.id, 'fm-inbox.sh', ...note], limits, parse)
				: run('fm-inbox.sh', note, { ...limits, home: mate.home }, parse);
		},
		note: async (requestId, body) => {
			const invalid = (message: string): AdapterResult<InboxNoteResult> => ({
				ok: false,
				observedAt: new Date().toISOString(),
				error: { kind: 'invalid-argument', script: 'fm-inbox.sh', message }
			});
			if (!REQUEST_ID.test(requestId)) return invalid('invalid request id');
			if (!body.trim()) return invalid('the message is empty');
			if (Buffer.byteLength(body) > NOTE_MAX_BYTES) {
				return invalid(`the message is longer than ${NOTE_MAX_BYTES} bytes`);
			}
			return run(
				'fm-inbox.sh',
				['note', '--request-id', requestId, '--json', '-'],
				{
					timeoutMs: opts.noteTimeoutMs ?? 20_000,
					maxOutputBytes: NOTE_RESULT_MAX_BYTES,
					input: body,
					maxInputBytes: NOTE_MAX_BYTES,
					okExitCodes: [NOTE_EXIT_UNANNOUNCED]
				},
				(r) => {
					const note = parseInboxNote(r.stdout);
					if (note.requestId !== null && note.requestId !== requestId) {
						throw new ContractError(
							`fm-inbox.sh answered for request id ${note.requestId}, not ${requestId}`
						);
					}
					return r.exitCode === NOTE_EXIT_UNANNOUNCED ? { ...note, announced: false } : note;
				}
			);
		},
		receipts: (query = {}) => {
			const args = ['receipts'];
			if (query.after && /^\d{1,32}$/.test(query.after)) args.push('--after', query.after);
			if (query.allNotes) args.push('--all-pending', '--all-handled');
			return run(
				'fm-inbox.sh',
				args,
				{ timeoutMs: opts.receiptsTimeoutMs ?? 15_000, maxOutputBytes: RECEIPTS_MAX_BYTES },
				(r) => parseInboxReceipts(r.stdout)
			);
		}
	};
}
