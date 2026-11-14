import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { ANSWERS_SCHEMA, answersFile } from './answers';
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
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
	ptys = [];
	claude = '/opt/bin/claude';
	state = mkdtempSync(path.join(tmpdir(), 'wh-setup-terminal-'));
	env = { HOME: state, WHEELHOUSE_STATE_DIR: state, WHEELHOUSE_CONFIG_DIR: state, PATH: '' };
	terminals = new SetupTerminals({
		env,
		find: (name) => (claude ? path.join(path.dirname(claude), name) : null),
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

	it('runs the chosen agent’s own sign-in: Codex’s login, by device code on a cloud machine', async () => {
		env.WHEELHOUSE_HARNESS = 'codex';
		const first = dial();
		await until(() => ptys.length === 1);
		expect([ptys[0].file, ...ptys[0].args]).toEqual(['/opt/bin/codex', 'login']);
		first.close();
		writeFileSync(
			answersFile(state),
			JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'codex', auth: 'subscription' })
		);
		const second = dial();
		await until(() => ptys.length === 2);
		expect([ptys[1].file, ...ptys[1].args]).toEqual(['/opt/bin/codex', 'login', '--device-auth']);
		second.close();
		env.WHEELHOUSE_HARNESS = 'pi';
		dial();
		await until(() => ptys.length === 3);
		expect([ptys[2].file, ...ptys[2].args]).toEqual(['/opt/bin/pi', '--no-session']);
	});

	it('starts no terminal for an agent signed in with an API key', async () => {
		env.WHEELHOUSE_HARNESS = 'codex';
		writeFileSync(
			path.join(state, 'harness.json'),
			JSON.stringify({ harness: 'codex', auth: 'apikey', provider: 'openai' })
		);
		const ws = dial();
		const status = await new Promise<number>((res) =>
			ws.once('unexpected-response', (_q, r) => res(r.statusCode ?? 0)).once('error', () => {})
		);
		expect(status).toBe(404);
		expect(ptys).toHaveLength(0);
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
