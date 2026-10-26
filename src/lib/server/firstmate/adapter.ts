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
	noteTimeoutMs?: number;
	receiptsTimeoutMs?: number;
	env?: NodeJS.ProcessEnv;
}

/** Task ids are plain slugs; anything else never reaches a script argument. */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PEEK_MAX_LINES = 200;
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

export function createScriptAdapter(
	install: FirstmateInstall,
	opts: ScriptAdapterOptions = {}
): FirstmateAdapter {
	const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), FM_HOME: install.homeDir };

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
		const r: RunResult = await runBounded(file, args, {
			cwd: install.homeDir,
			env,
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

	return {
		snapshot: () =>
			run(
				'fm-fleet-snapshot.sh',
				['--json'],
				{ timeoutMs: opts.snapshotTimeoutMs ?? 30_000, maxOutputBytes: SNAPSHOT_MAX_BYTES },
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
				{ timeoutMs: opts.peekTimeoutMs ?? 10_000, maxOutputBytes: PEEK_MAX_BYTES },
				(r) => ({ lines: parsePeekOutput(r.stdout, n), requested: n })
			);
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
