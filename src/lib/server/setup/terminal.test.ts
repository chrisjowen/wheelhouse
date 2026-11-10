import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { sessionToken } from '../session';
import { TERMINAL_CLOSE, TERMINAL_PROTOCOL, TOKEN_PROTOCOL_PREFIX } from '../../terminal';
import { SETUP_TERMINAL_PATH } from '../../setup';
import type { Pty, PtyOptions } from '../sessions/terminal';
import { isLoopbackAddress, refusesSetup, SetupTerminals } from './terminal';

class FakePty implements Pty {
	killed = false;
	private data: ((d: string) => void)[] = [];
	constructor(
		readonly file: string,
		readonly args: string[],
		readonly opts: PtyOptions
	) {}
	onData(l: (d: string) => void) {
		this.data.push(l);
	}
	onExit() {}
	write() {}
	resize() {}
	kill() {
		this.killed = true;
	}
	pause() {}
	resume() {}
	emit(d: string) {
		for (const l of this.data) l(d);
	}
}

let server: Server;
let terminals: SetupTerminals;
let ptys: FakePty[];
let base: string;
let claude: string | null;
let state: string;

beforeEach(async () => {
	ptys = [];
	claude = '/opt/bin/claude';
	state = mkdtempSync(path.join(tmpdir(), 'wh-setup-terminal-'));
	terminals = new SetupTerminals({
		env: { HOME: state, WHEELHOUSE_STATE_DIR: state, PATH: '' },
		find: () => claude,
		spawn: (file, args, opts) => {
			const p = new FakePty(file, args, opts);
			ptys.push(p);
			return p;
		}
	});
	server = createServer((_req, res) => res.writeHead(404).end());
	server.on('upgrade', (req, socket, head) => {
		if (!terminals.handleUpgrade(req, socket, head)) socket.destroy();
	});
	await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
	base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	terminals.closeAll();
	server.closeAllConnections();
	await new Promise((res) => server.close(res));
	rmSync(state, { recursive: true, force: true });
});

const dial = (token = sessionToken()) =>
	new WebSocket(
		`ws://${base}${SETUP_TERMINAL_PATH}`,
		[TERMINAL_PROTOCOL, TOKEN_PROTOCOL_PREFIX + token],
		{
			origin: `http://${base}`
		}
	);
const until = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
	expect(cond()).toBe(true);
};

describe('the setup terminal', () => {
	it('runs claude in Wheelhouse’s own folder and kills it when the step ends', async () => {
		const ws = dial();
		const got: string[] = [];
		ws.on('message', (d) => got.push(d.toString()));
		const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
		await until(() => ptys.length === 1);
		expect(ptys[0].file).toBe('/opt/bin/claude');
		expect(ptys[0].args).toEqual([]);
		expect(ptys[0].opts.cwd).toBe(path.join(state, 'setup', 'claude'));
		ptys[0].emit('Welcome to Claude Code');
		await until(() => got.length > 0);
		terminals.closeAll('Signed in.');
		expect(await closed).toBe(TERMINAL_CLOSE.shutdown);
		expect(ptys[0].killed).toBe(true);
	});

	it('refuses without the session token, and before Claude Code is installed', async () => {
		const bad = dial('wrong');
		const status = await new Promise<number>((res) =>
			bad.once('unexpected-response', (_q, r) => res(r.statusCode ?? 0)).once('error', () => {})
		);
		expect(status).toBe(403);
		claude = null;
		const none = dial();
		const missing = await new Promise<number>((res) =>
			none.once('unexpected-response', (_q, r) => res(r.statusCode ?? 0)).once('error', () => {})
		);
		expect(missing).toBe(404);
		expect(ptys).toHaveLength(0);
	});

	it('knows a caller on this computer', () => {
		expect(isLoopbackAddress('127.0.0.1')).toBe(true);
		expect(isLoopbackAddress('::1')).toBe(true);
		expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
		expect(isLoopbackAddress('192.168.1.4')).toBe(false);
		expect(isLoopbackAddress(undefined)).toBe(false);
		expect(refusesSetup('127.0.0.1', null)).toBe(false);
		// Through Wheelhouse Cloud the connector dials from this computer, but the caller is not here.
		expect(refusesSetup('127.0.0.1', '1')).toBe(true);
		expect(refusesSetup('10.0.0.2', null)).toBe(true);
	});

	it('refuses a terminal relayed through Wheelhouse Cloud', async () => {
		const ws = new WebSocket(
			`ws://${base}${SETUP_TERMINAL_PATH}`,
			[TERMINAL_PROTOCOL, TOKEN_PROTOCOL_PREFIX + sessionToken()],
			{ origin: `http://${base}`, headers: { 'x-wheelhouse-remote': '1' } }
		);
		const status = await new Promise<number>((res) =>
			ws.once('unexpected-response', (_q, r) => res(r.statusCode ?? 0)).once('error', () => {})
		);
		expect(status).toBe(403);
		expect(ptys).toHaveLength(0);
	});
});
