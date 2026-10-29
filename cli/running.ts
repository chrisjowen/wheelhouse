import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { RestartOutcome } from '../src/lib/server/plugins/install';

/**
 * How `wheelhouse plugin` restarts a running Wheelhouse so a change loads at
 * once. While `wheelhouse open` serves, it keeps a record of itself in the
 * plugins directory it loaded from, `<plugins dir>/.running/<pid>.json`,
 * readable only by you: its address and a token made for this start. A plugin
 * command that changed something reads those records and POSTs the token to
 * each one's RESTART_PATH. The server answers, closes and exits with
 * RESTART_EXIT, and the supervisor `wheelhouse open` runs it under starts it
 * again with the same options. A record whose Wheelhouse is gone is removed.
 */

export const RESTART_EXIT = 75;
export const RESTART_PATH = '/api/wheelhouse/restart';
const RUNNING_DIR = '.running';
const TIMEOUT_MS = 3000;

export interface RunningRecord {
	pid: number;
	url: string;
	token: string;
}

export const newToken = () => randomBytes(24).toString('hex');

/** Record this Wheelhouse in `pluginsDir`; returns the file, to remove on close. */
export function writeRunning(pluginsDir: string, r: RunningRecord): string {
	const dir = path.join(pluginsDir, RUNNING_DIR);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = path.join(dir, `${r.pid}.json`);
	writeFileSync(file, `${JSON.stringify(r)}\n`, { mode: 0o600 });
	return file;
}

export function removeRunning(file: string): void {
	rmSync(file, { force: true });
}

const sameToken = (got: string, want: string) => {
	const a = Buffer.from(got);
	const b = Buffer.from(want);
	return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Answers a restart request carrying `token` and then calls `restart`; true
 * when the request was one for RESTART_PATH, answered or refused.
 */
export function restartHandler(
	token: string,
	restart: () => void
): (req: IncomingMessage, res: ServerResponse) => boolean {
	return (req, res) => {
		if (req.url !== RESTART_PATH) return false;
		const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
		if (req.method !== 'POST') {
			res.writeHead(405, { allow: 'POST' }).end();
		} else if (!sameToken(auth, token)) {
			res.writeHead(403).end();
		} else {
			res.once('finish', restart);
			res.writeHead(202, { 'content-type': 'text/plain' }).end('restarting\n');
		}
		return true;
	};
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
};

const refused = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED';

/** Ask every Wheelhouse that loads plugins from `pluginsDir` to restart. */
export async function requestRestart(pluginsDir: string): Promise<RestartOutcome> {
	const dir = path.join(pluginsDir, RUNNING_DIR);
	const out: RestartOutcome = { restarted: [], failed: [] };
	let names: string[];
	try {
		names = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n)).sort();
	} catch {
		return out;
	}
	for (const name of names) {
		const file = path.join(dir, name);
		let r: RunningRecord;
		try {
			r = JSON.parse(await readFile(file, 'utf8')) as RunningRecord;
			if (typeof r.url !== 'string' || typeof r.token !== 'string') throw new Error();
		} catch {
			await rm(file, { force: true });
			continue;
		}
		if (typeof r.pid === 'number' && !alive(r.pid)) {
			await rm(file, { force: true });
			continue;
		}
		try {
			const res = await fetch(new URL(RESTART_PATH, r.url), {
				method: 'POST',
				headers: { authorization: `Bearer ${r.token}` },
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			if (res.status === 202) out.restarted.push(r.url);
			else out.failed.push({ url: r.url, reason: `it answered ${res.status}` });
		} catch (e) {
			if (refused(e)) await rm(file, { force: true });
			else out.failed.push({ url: r.url, reason: (e as Error).message });
		}
	}
	return out;
}
