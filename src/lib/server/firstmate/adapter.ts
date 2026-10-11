import { existsSync } from 'node:fs';
import { runBounded, type RunResult } from './exec';
import {
	ContractError,
	parseFleetSnapshot,
	parsePeekOutput,
	parsePrimaryReady,
	type FleetSnapshot,
	type PrimaryReady
} from './contracts';
import { scriptPath, type FirstmateInstall } from './install';

/**
 * The read side of the Firstmate integration: one TypeScript interface over the
 * three supported scripts. Scripts run with argument arrays, closed stdin,
 * bounded output and timeouts (see exec.ts), with FM_HOME pointing at the
 * operational home. Nothing here writes to Firstmate.
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
}

export type AdapterResult<T> =
	| { ok: true; value: T; observedAt: string; durationMs: number }
	| { ok: false; error: AdapterError; observedAt: string };

export interface PeekOutput {
	lines: string[];
	requested: number;
}

export interface FirstmateAdapter {
	snapshot(): Promise<AdapterResult<FleetSnapshot>>;
	ready(): Promise<AdapterResult<PrimaryReady>>;
	peek(taskId: string, lines: number): Promise<AdapterResult<PeekOutput>>;
}

export interface ScriptAdapterOptions {
	snapshotTimeoutMs?: number;
	readyTimeoutMs?: number;
	peekTimeoutMs?: number;
	env?: NodeJS.ProcessEnv;
}

/** Task ids are plain slugs; anything else never reaches a script argument. */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PEEK_MAX_LINES = 200;
export const PEEK_DEFAULT_LINES = 40;

const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
const READY_MAX_BYTES = 64 * 1024;
const PEEK_MAX_BYTES = 512 * 1024;

export function createScriptAdapter(
	install: FirstmateInstall,
	opts: ScriptAdapterOptions = {}
): FirstmateAdapter {
	const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), FM_HOME: install.homeDir };

	async function run<T>(
		name: string,
		args: string[],
		limits: { timeoutMs: number; maxOutputBytes: number },
		parse: (r: Extract<RunResult, { ok: true }>) => T
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
		const r = await runBounded(file, args, {
			cwd: install.homeDir,
			env,
			timeoutMs: limits.timeoutMs,
			maxOutputBytes: limits.maxOutputBytes
		});
		if (!r.ok) {
			const detail = r.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
			return {
				ok: false,
				observedAt: observedAt(),
				error: {
					kind: r.kind === 'input-limit' ? 'invalid-argument' : r.kind,
					script: name,
					message: detail ? `${name} ${r.message}: ${detail}` : `${name} ${r.message}`
				}
			};
		}
		try {
			return { ok: true, value: parse(r), observedAt: observedAt(), durationMs: r.durationMs };
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
		}
	};
}
