import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Bounded child-process runner. Every Firstmate script and helper command goes
 * through here: argument arrays only (never a shell string), a hard timeout,
 * capped stdout/stderr, and bounded stdin.
 */

export interface RunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	/** stdout beyond this many bytes aborts the run with `output-limit` (keeping the first this many). */
	maxOutputBytes: number;
	/** stderr is truncated (not fatal) beyond this many bytes. */
	maxErrorBytes?: number;
	/** Text written to stdin. stdin is closed immediately when absent. */
	input?: string;
	maxInputBytes?: number;
	/**
	 * Keep only the last this many bytes of stdout and stderr together, in the
	 * order they arrived, as `stdout` (stderr is then empty), instead of
	 * aborting on `maxOutputBytes`: for long-running commands whose output is
	 * shown, not parsed.
	 */
	tailBytes?: number;
}

export type RunFailureKind = 'timeout' | 'spawn-error' | 'exit' | 'output-limit' | 'input-limit';

export type RunResult =
	| { ok: true; stdout: string; stderr: string; durationMs: number }
	| {
			ok: false;
			kind: RunFailureKind;
			code: number | null;
			signal: NodeJS.Signals | null;
			stdout: string;
			stderr: string;
			message: string;
			durationMs: number;
	  };

const running = new Set<ChildProcess>();

/** Number of child processes this module currently has in flight. */
export function runningCount(): number {
	return running.size;
}

/**
 * Kill every child this module started (used on Wheelhouse shutdown). Only our
 * own read-only script runs are affected; Firstmate and its crew are separate
 * processes that we never signal.
 */
export function killAllRunning(): void {
	for (const child of running) killTree(child);
}

function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	try {
		// Children run in their own process group, so this reaches helpers too.
		process.kill(-child.pid, 'SIGKILL');
	} catch {
		try {
			child.kill('SIGKILL');
		} catch {
			// already gone
		}
	}
}

export function runBounded(
	file: string,
	args: readonly string[],
	opts: RunOptions
): Promise<RunResult> {
	const started = Date.now();
	const maxErr = opts.maxErrorBytes ?? 16 * 1024;
	const maxIn = opts.maxInputBytes ?? 64 * 1024;

	if (opts.input !== undefined && Buffer.byteLength(opts.input) > maxIn) {
		return Promise.resolve({
			ok: false,
			kind: 'input-limit',
			code: null,
			signal: null,
			stdout: '',
			stderr: '',
			message: `input exceeds ${maxIn} bytes`,
			durationMs: 0
		});
	}

	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(file, [...args], {
				cwd: opts.cwd,
				env: opts.env,
				shell: false,
				detached: true,
				stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
			});
		} catch (err) {
			resolve({
				ok: false,
				kind: 'spawn-error',
				code: null,
				signal: null,
				stdout: '',
				stderr: '',
				message: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - started
			});
			return;
		}
		running.add(child);

		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let outBytes = 0;
		let errBytes = 0;
		let failure: { kind: RunFailureKind; message: string } | null = null;
		let settled = false;

		const timer = setTimeout(() => {
			failure ??= { kind: 'timeout', message: `timed out after ${opts.timeoutMs} ms` };
			killTree(child);
			if (child.exitCode !== null || child.signalCode !== null) {
				finish(child.exitCode, child.signalCode);
			}
		}, opts.timeoutMs);

		const tail = opts.tailBytes;
		const keepTail = (chunk: Buffer) => {
			out.push(chunk);
			outBytes += chunk.length;
			while (outBytes > tail! && out.length > 1 && outBytes - out[0].length >= tail!) {
				outBytes -= out.shift()!.length;
			}
		};

		child.stdout?.on('data', (chunk: Buffer) => {
			if (tail !== undefined) return keepTail(chunk);
			if (failure) return;
			const room = opts.maxOutputBytes - outBytes;
			outBytes += chunk.length;
			if (outBytes > opts.maxOutputBytes) {
				if (room > 0) out.push(chunk.subarray(0, room));
				failure = {
					kind: 'output-limit',
					message: `output exceeded ${opts.maxOutputBytes} bytes`
				};
				killTree(child);
				return;
			}
			out.push(chunk);
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			if (tail !== undefined) return keepTail(chunk);
			if (errBytes >= maxErr) return;
			const room = maxErr - errBytes;
			err.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
			errBytes += Math.min(chunk.length, room);
		});

		if (opts.input !== undefined && child.stdin) {
			child.stdin.on('error', () => {
				// The script may exit without reading stdin; that is not our failure.
			});
			child.stdin.end(opts.input);
		}

		const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			running.delete(child);
			let joined = Buffer.concat(out);
			if (tail !== undefined && joined.length > tail)
				joined = joined.subarray(joined.length - tail);
			const stdout = joined.toString('utf8');
			const stderr = Buffer.concat(err).toString('utf8');
			const durationMs = Date.now() - started;
			if (spawnError) {
				resolve({
					ok: false,
					kind: 'spawn-error',
					code: null,
					signal: null,
					stdout,
					stderr,
					message: spawnError.message,
					durationMs
				});
			} else if (failure) {
				resolve({ ok: false, ...failure, code, signal, stdout, stderr, durationMs });
			} else if (code !== 0) {
				resolve({
					ok: false,
					kind: 'exit',
					code,
					signal,
					stdout,
					stderr,
					message: signal ? `terminated by ${signal}` : `exited with code ${code}`,
					durationMs
				});
			} else {
				resolve({ ok: true, stdout, stderr, durationMs });
			}
		};

		child.on('error', (e) => finish(null, null, e));
		child.on('close', (code, signal) => finish(code, signal));
	});
}
