import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probe, type ProbeDeps } from './probe';

/**
 * Soundings' scan as a process of its own: built to dist/soundings-probe.js
 * and started by service.ts under `nice`, so the scan's tools run at low
 * priority, away from Wheelhouse's server and Firstmate. It reads its options
 * as JSON on standard input ({ wheelhousePid, logDirs }) and prints one
 * MachineSample as JSON.
 */

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 16 * 1024 * 1024;

/**
 * This computer, for the probe. `nice` runs each tool under `nice` itself: for
 * a scan run inside Wheelhouse's server (a development server without the
 * built probe), where the process as a whole is not lowered.
 */
export function systemDeps(o: { nice?: boolean } = {}): ProbeDeps {
	return {
		platform: process.platform,
		run: (file, args) =>
			new Promise((resolve) => {
				execFile(
					o.nice ? 'nice' : file,
					o.nice ? ['-n', '10', file, ...args] : args,
					{
						timeout: COMMAND_TIMEOUT_MS,
						maxBuffer: MAX_OUTPUT,
						env: { ...process.env, LC_ALL: 'C' }
					},
					(error, stdout) => resolve(error && !stdout ? null : stdout)
				);
			}),
		readFile: (file) => readFile(file, 'utf8').catch(() => null),
		list: async (dir) => {
			try {
				const entries = await readdir(dir, { withFileTypes: true });
				return await Promise.all(
					entries
						.filter((e) => e.isFile() || e.isDirectory())
						.map(async (e) => ({
							name: e.name,
							dir: e.isDirectory(),
							bytes: e.isFile()
								? await stat(path.join(dir, e.name)).then(
										(s) => s.size,
										() => 0
									)
								: 0
						}))
				);
			} catch {
				return null;
			}
		},
		home: os.homedir(),
		uid: process.getuid?.() ?? 0,
		cpus: os.availableParallelism?.() ?? os.cpus().length,
		totalMem: os.totalmem(),
		load: () => os.loadavg() as [number, number, number],
		now: Date.now
	};
}

async function main() {
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	const opts = (input.trim() ? JSON.parse(input) : {}) as {
		wheelhousePid?: number;
		logDirs?: string[];
	};
	const sample = await probe(systemDeps(), {
		wheelhousePid: typeof opts.wheelhousePid === 'number' ? opts.wheelhousePid : null,
		logDirs: Array.isArray(opts.logDirs) ? opts.logDirs : []
	});
	process.stdout.write(JSON.stringify(sample));
}

if (process.argv[1] && /soundings-probe\.(js|ts)$/.test(process.argv[1]))
	main().catch((error) => {
		process.stderr.write(String(error?.stack ?? error));
		process.exit(1);
	});
