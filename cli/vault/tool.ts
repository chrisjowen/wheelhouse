import { spawn } from 'node:child_process';

/**
 * Runs a backend's command-line tool (`security` on macOS, `secret-tool` and
 * `gdbus` on Linux) with arguments and, when given, a value on its standard
 * input, which is the only way a backend hands a value to a tool: never in its
 * arguments, which any local process can read.
 */

export interface ToolResult {
	/** null when it did not exit on its own (killed, or never started). */
	code: number | null;
	stdout: string;
	stderr: string;
	/** Why it never started, e.g. ENOENT. */
	spawnError?: string;
	timedOut?: boolean;
}

/** Runs one tool with arguments and optional stdin. */
export type ToolRunner = (args: string[], input?: string) => Promise<ToolResult>;

export function toolRunner(file: string, timeoutMs: number): ToolRunner {
	return (args, input) =>
		new Promise((resolve) => {
			const child = spawn(file, args, {
				stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
			});
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, timeoutMs);
			child.stdout?.on('data', (c: Buffer) => out.push(c));
			child.stderr?.on('data', (c: Buffer) => err.push(c));
			child.on('error', (e) => {
				clearTimeout(timer);
				resolve({ code: null, stdout: '', stderr: '', spawnError: e.message });
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				resolve({
					code,
					stdout: Buffer.concat(out).toString('utf8'),
					stderr: Buffer.concat(err).toString('utf8'),
					timedOut
				});
			});
			if (input !== undefined && child.stdin) {
				child.stdin.on('error', () => {
					// The tool may exit before reading stdin; its status says why.
				});
				child.stdin.end(input);
			}
		});
}
