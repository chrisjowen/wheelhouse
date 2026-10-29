import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	removeRunning,
	requestRestart,
	restartHandler,
	RESTART_PATH,
	writeRunning
} from './running';

/**
 * A running Wheelhouse's record and restart endpoint, against real loopback
 * servers that answer with restartHandler as `wheelhouse open` does.
 */

let dir: string;
let servers: Server[];

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-running-'));
	servers = [];
});
afterEach(async () => {
	await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
	rmSync(dir, { recursive: true, force: true });
});

/** A server that answers restart requests for `token`, counting restarts; its URL. */
async function serve(token: string, restarts: { n: number }): Promise<string> {
	const restart = restartHandler(token, () => restarts.n++);
	const server = createServer((req, res) => {
		if (!restart(req, res)) res.writeHead(404).end();
	});
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const a = server.address();
	return `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/`;
}

const records = () => readdirSync(path.join(dir, '.running')).sort();

describe('the restart endpoint', () => {
	it('restarts only on a POST carrying the token, after answering', async () => {
		const restarts = { n: 0 };
		const url = await serve('secret', restarts);
		const at = new URL(RESTART_PATH, url);
		expect((await fetch(at)).status).toBe(405);
		expect((await fetch(at, { method: 'POST' })).status).toBe(403);
		const wrong = { authorization: 'Bearer nope' };
		expect((await fetch(at, { method: 'POST', headers: wrong })).status).toBe(403);
		expect((await fetch(new URL('/api/health', url))).status).toBe(404);
		expect(restarts.n).toBe(0);
		const right = { authorization: 'Bearer secret' };
		expect((await fetch(at, { method: 'POST', headers: right })).status).toBe(202);
		expect(restarts.n).toBe(1);
	});
});

describe('restarting the Wheelhouses that load from a plugins directory', () => {
	it('finds none when nothing has run', async () => {
		expect(await requestRestart(dir)).toEqual({ restarted: [], failed: [] });
	});

	it('asks each running one to restart, keeping the record private', async () => {
		const restarts = { n: 0 };
		const url = await serve('t1', restarts);
		const file = writeRunning(dir, { pid: process.pid, url, token: 't1' });
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(await requestRestart(dir)).toEqual({ restarted: [url], failed: [] });
		expect(restarts.n).toBe(1);
		removeRunning(file);
		expect(existsSync(file)).toBe(false);
	});

	it('says which one would not, and keeps its record', async () => {
		const url = await serve('right', { n: 0 });
		writeRunning(dir, { pid: process.pid, url, token: 'wrong' });
		expect(await requestRestart(dir)).toEqual({
			restarted: [],
			failed: [{ url, reason: 'it answered 403' }]
		});
		expect(records()).toEqual([`${process.pid}.json`]);
	});

	it('removes records whose Wheelhouse is gone', async () => {
		// A process that has exited, a port nothing listens on, and a record that is not one.
		writeRunning(dir, { pid: 2 ** 22 + 1, url: 'http://127.0.0.1:9/', token: 'x' });
		const closed = await serve('x', { n: 0 });
		await new Promise((r) => servers.pop()!.close(r));
		writeRunning(dir, { pid: process.pid, url: closed, token: 'x' });
		writeFileSync(path.join(dir, '.running', '7.json'), '{');
		expect(await requestRestart(dir)).toEqual({ restarted: [], failed: [] });
		expect(records()).toEqual([]);
	});
});
