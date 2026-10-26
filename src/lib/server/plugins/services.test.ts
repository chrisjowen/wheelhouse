import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceSpec } from '../../plugins/types';
import { refuseSpec, ServiceManager } from './services';

/**
 * The service manager against a real (tiny) server: it starts a service
 * detached, waits for its health check, refuses what it must not start, and
 * says why a start failed.
 */

let dir: string;
const started: string[] = [];

/** A free loopback port. */
function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});
}

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-services-'));
	// Serves /health, and /quit stops it; prints a line so the log has something.
	writeFileSync(
		path.join(dir, 'server.mjs'),
		`import http from 'node:http';
const port = Number(process.argv[2]);
console.log('serving on ' + port + ' with ' + (process.env.MARK ?? 'no mark'));
http.createServer((req, res) => {
  if (req.url === '/quit') { res.end('bye'); process.exit(0); }
  res.statusCode = req.url === '/health' ? 200 : 404;
  res.end('ok');
}).listen(port, '127.0.0.1');
`
	);
	writeFileSync(
		path.join(dir, 'fail.mjs'),
		`console.error('cannot start: no config'); process.exit(3);`
	);
});
afterAll(async () => {
	for (const url of started) await fetch(`${url}/quit`).catch(() => {});
	rmSync(dir, { recursive: true, force: true });
});

const spec = (port: number, o: Partial<ServiceSpec> = {}): ServiceSpec => ({
	url: `http://127.0.0.1:${port}`,
	health: `http://127.0.0.1:${port}/health`,
	argv: [process.execPath, path.join(dir, 'server.mjs'), String(port)],
	cwd: dir,
	binds: 'loopback',
	readyTimeoutMs: 10_000,
	...o
});

describe('ServiceManager', () => {
	it('refuses anything not on loopback, not a command, or with no directory', () => {
		expect(refuseSpec(spec(1))).toBeNull();
		expect(refuseSpec(spec(1, { url: 'http://example.com:1' }))).toContain('not on this computer');
		expect(refuseSpec(spec(1, { health: 'http://10.0.0.2:1/health' }))).toContain('health check');
		expect(refuseSpec(spec(1, { url: 'file:///etc/passwd' }))).toContain('not http');
		expect(refuseSpec(spec(1, { argv: [] }))).toContain('command');
		expect(refuseSpec(spec(1, { cwd: 'relative' }))).toContain('directory');
	});

	it('starts a service detached, after its setup, and answers once it is up', async () => {
		const port = await freePort();
		const s = spec(port, {
			env: { MARK: 'marked' },
			setup: [
				{
					label: 'Preparing',
					argv: [process.execPath, '-e', "require('fs').writeFileSync('prepared', 'yes')"],
					timeoutMs: 10_000
				}
			]
		});
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		expect(await m.status('t-up', s)).toMatchObject({ state: 'stopped', reason: null });
		const [a, b] = await Promise.all([m.launch('t-up', s), m.launch('t-up', s)]);
		started.push(s.url);
		expect(a).toEqual({ state: 'running', url: s.url, reason: null });
		expect(b).toEqual(a);
		expect(existsSync(path.join(dir, 'prepared'))).toBe(true);
		expect(readFileSync(path.join(dir, 'logs', 't-up.log'), 'utf8')).toContain(
			`serving on ${port} with marked`
		);
		expect(await m.status('t-up', s)).toMatchObject({ state: 'running' });
		// Launching again does nothing but say so.
		expect(await m.launch('t-up', s)).toMatchObject({ state: 'running' });
	});

	it('counts only a 2xx answer as running, not a server that answers 404', async () => {
		const port = await freePort();
		const s = spec(port);
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		expect(await m.launch('t-404', s)).toMatchObject({ state: 'running' });
		started.push(s.url);
		expect(await m.status('t-404', { ...s, health: `${s.url}/elsewhere` })).toMatchObject({
			state: 'stopped'
		});
	});

	it('starts each launch with a fresh log', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const s = spec(port, { argv: [process.execPath, path.join(dir, 'fail.mjs')] });
		mkdirSync(path.join(dir, 'logs'), { recursive: true });
		writeFileSync(path.join(dir, 'logs', 't-fresh.log'), 'x'.repeat(10_000));
		const r = await m.launch('t-fresh', s);
		expect(r.log).toBe('cannot start: no config\n');
	});

	it('says why a start failed, with the end of what it printed', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const r = await m.launch(
			't-fail',
			spec(port, { argv: [process.execPath, path.join(dir, 'fail.mjs')] })
		);
		expect(r.state).toBe('failed');
		expect(r.reason).toContain('it stopped (exit 3)');
		expect(r.log).toContain('cannot start: no config');

		const setup = await m.launch(
			't-setup',
			spec(port, {
				setup: [
					{
						label: 'Installing',
						argv: [process.execPath, '-e', 'process.exit(1)'],
						timeoutMs: 5000
					}
				]
			})
		);
		expect(setup).toMatchObject({ state: 'failed' });
		expect(setup.reason).toContain('Installing did not finish (exit 1)');
	});

	it('never starts a service that listens on every interface', async () => {
		const port = await freePort();
		const m = new ServiceManager({ logDir: path.join(dir, 'logs') });
		const s = spec(port, { binds: 'all' });
		expect((await m.status('t-all', s)).reason).toContain('every network interface');
		expect(await m.launch('t-all', s)).toMatchObject({ state: 'unavailable' });
		expect(existsSync(path.join(dir, 'logs', 't-all.log'))).toBe(false);
	});
});
