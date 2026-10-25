import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { sessionToken } from '../session';
import {
	TERMINAL_CLOSE,
	TERMINAL_PROTOCOL,
	TERMINAL_PATH,
	TOKEN_PROTOCOL_PREFIX
} from '../../terminal';
import {
	TerminalServer,
	isTerminalUrl,
	type AttachTarget,
	type Pty,
	type PtyOptions,
	type ResolveTarget
} from './terminal';

const TARGET: AttachTarget = {
	argv: ['/opt/bin/tmux', '-L', 'wh-test', 'attach-session', '-t', '=wh-firstmate'],
	cwd: '/work/firstmate',
	env: { TERM: 'xterm-256color' }
};

/** A pty that records what it was given and lets the test play its output. */
class FakePty implements Pty {
	written: string[] = [];
	sizes: [number, number][] = [];
	killed = false;
	paused = false;
	private data: ((d: string) => void)[] = [];
	private exit: ((e: { exitCode: number }) => void)[] = [];
	constructor(
		readonly file: string,
		readonly args: string[],
		readonly opts: PtyOptions
	) {}
	onData(l: (d: string) => void) {
		this.data.push(l);
	}
	onExit(l: (e: { exitCode: number }) => void) {
		this.exit.push(l);
	}
	write(d: string) {
		this.written.push(d);
	}
	resize(cols: number, rows: number) {
		this.sizes.push([cols, rows]);
	}
	kill() {
		this.killed = true;
	}
	pause() {
		this.paused = true;
	}
	resume() {
		this.paused = false;
	}
	emit(d: string) {
		for (const l of this.data) l(d);
	}
	end() {
		for (const l of this.exit) l({ exitCode: 0 });
	}
}

let server: Server;
let terminals: TerminalServer;
let ptys: FakePty[];
let base: string;
let resolved: number;
let resolve: ResolveTarget;

beforeEach(async () => {
	ptys = [];
	resolved = 0;
	resolve = async () => {
		resolved++;
		return { ok: true, target: TARGET };
	};
	terminals = new TerminalServer({
		resolve: () => resolve(),
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
	terminals.close();
	server.closeAllConnections();
	await new Promise((res) => server.close(res));
});

interface Caller {
	path?: string;
	origin?: string | null;
	token?: string | null;
	protocol?: string | null;
	host?: string;
	query?: string;
}

function dial(c: Caller = {}): WebSocket {
	const protocols = [
		...(c.protocol === null ? [] : [c.protocol ?? TERMINAL_PROTOCOL]),
		...(c.token === null ? [] : [TOKEN_PROTOCOL_PREFIX + (c.token ?? sessionToken())])
	];
	const headers: Record<string, string> = {};
	if (c.host) headers.host = c.host;
	return new WebSocket(`ws://${base}${c.path ?? TERMINAL_PATH}${c.query ?? ''}`, protocols, {
		...(c.origin === null ? {} : { origin: c.origin ?? `http://${base}` }),
		headers
	});
}

/** The HTTP status an upgrade was refused with. */
const refusal = (ws: WebSocket) =>
	new Promise<number>((res, rej) => {
		ws.once('unexpected-response', (_req, r) => res(r.statusCode ?? 0));
		ws.once('open', () => rej(new Error('the upgrade was accepted')));
		ws.once('error', () => {});
	});

const opened = (ws: WebSocket) =>
	new Promise<void>((res, rej) => ws.once('open', () => res()).once('error', rej));

const until = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
	expect(cond()).toBe(true);
};

describe('terminal URL', () => {
	it('is the Firstmate terminal URL, with any query, and nothing else', () => {
		expect(isTerminalUrl('/api/firstmate/terminal')).toBe(true);
		expect(isTerminalUrl('/api/firstmate/terminal?cols=80&rows=24')).toBe(true);
		expect(isTerminalUrl('/api/firstmate/terminal/x')).toBe(false);
		expect(isTerminalUrl('/api/firstmate')).toBe(false);
		expect(isTerminalUrl('/@vite/client')).toBe(false);
		expect(isTerminalUrl(undefined)).toBe(false);
	});
});

describe('refusing the upgrade', () => {
	it('without the session token, or with a wrong one', async () => {
		expect(await refusal(dial({ token: null }))).toBe(403);
		expect(await refusal(dial({ token: 'not-the-token' }))).toBe(403);
	});

	it('without the served Origin', async () => {
		expect(await refusal(dial({ origin: null }))).toBe(403);
		expect(await refusal(dial({ origin: 'http://evil.example' }))).toBe(403);
		expect(await refusal(dial({ origin: 'http://localhost:1' }))).toBe(403);
	});

	it('for a Host that is not loopback (DNS rebinding)', async () => {
		expect(await refusal(dial({ host: 'evil.example', origin: 'http://evil.example' }))).toBe(421);
	});

	it('without the terminal subprotocol', async () => {
		expect(await refusal(dial({ protocol: null }))).toBe(400);
	});

	it('when the session is not one Wheelhouse may attach to', async () => {
		resolve = async () => ({
			ok: false,
			status: 409,
			error: 'Firstmate is not running in Wheelhouse.'
		});
		expect(await refusal(dial())).toBe(409);
		resolve = async () => ({ ok: false, status: 503, error: 'tmux is missing.' });
		expect(await refusal(dial())).toBe(503);
	});

	it('before asking the manager or starting a pty', async () => {
		await refusal(dial({ token: 'nope' }));
		await refusal(dial({ origin: 'http://evil.example' }));
		expect(resolved).toBe(0);
		expect(ptys).toEqual([]);
		await until(() => terminals.connections === 0);
	});
});

describe('the live terminal', () => {
	it('runs the attach command in a pty at the browser’s size', async () => {
		const ws = dial({ query: '?cols=132&rows=40' });
		await opened(ws);
		expect(ws.protocol).toBe(TERMINAL_PROTOCOL);
		await until(() => ptys.length === 1);
		const [p] = ptys;
		expect([p.file, ...p.args]).toEqual(TARGET.argv);
		expect(p.opts).toEqual({ cols: 132, rows: 40, cwd: TARGET.cwd, env: TARGET.env });
		expect(resolved).toBe(1);
		ws.close();
	});

	it('streams output to the browser and keystrokes, paste and resizes to the pty', async () => {
		const ws = dial();
		const got: string[] = [];
		ws.on('message', (d: Buffer, isBinary) => {
			expect(isBinary).toBe(true);
			got.push(d.toString('utf8'));
		});
		await opened(ws);
		await until(() => ptys.length === 1);
		const [p] = ptys;

		p.emit('\x1b[1mWelcome\x1b[0m ⛵\r\n');
		await until(() => got.join('') === '\x1b[1mWelcome\x1b[0m ⛵\r\n');

		ws.send(JSON.stringify({ type: 'input', data: 'h' }));
		ws.send(JSON.stringify({ type: 'input', data: 'i\r' }));
		ws.send(JSON.stringify({ type: 'input', data: '\x1b[200~pasted\nlines\x1b[201~' }));
		ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
		await until(() => p.written.length === 3 && p.sizes.length === 1);
		expect(p.written).toEqual(['h', 'i\r', '\x1b[200~pasted\nlines\x1b[201~']);
		expect(p.sizes).toEqual([[100, 30]]);
		ws.close();
	});

	it('ignores malformed messages and clamps absurd sizes', async () => {
		const ws = dial();
		await opened(ws);
		await until(() => ptys.length === 1);
		const [p] = ptys;
		ws.send('not json');
		ws.send(JSON.stringify({ type: 'input', data: 42 }));
		ws.send(JSON.stringify({ type: 'exec', data: 'rm -rf ~' }));
		ws.send(Buffer.from('binary input is not accepted'), { binary: true });
		ws.send(JSON.stringify({ type: 'resize', cols: 1e9, rows: -5 }));
		await until(() => p.sizes.length === 1);
		expect(p.written).toEqual([]);
		expect(p.sizes).toEqual([[1000, 1]]);
		ws.close();
	});

	it('detaches its own tmux client when the browser goes, leaving the session', async () => {
		const ws = dial();
		await opened(ws);
		await until(() => ptys.length === 1);
		ws.close();
		await until(() => ptys[0].killed);
		await until(() => terminals.connections === 0);
	});

	it('tells the browser when the session ends', async () => {
		const ws = dial();
		await opened(ws);
		await until(() => ptys.length === 1);
		const code = new Promise<number>((res) => ws.once('close', (c) => res(c)));
		ptys[0].end();
		expect(await code).toBe(TERMINAL_CLOSE.detached);
	});

	it('gives each tab its own client on the same session', async () => {
		const a = dial();
		const b = dial();
		await Promise.all([opened(a), opened(b)]);
		await until(() => ptys.length === 2);
		expect(terminals.connections).toBe(2);
		a.send(JSON.stringify({ type: 'input', data: 'a' }));
		b.send(JSON.stringify({ type: 'input', data: 'b' }));
		await until(() => ptys[0].written.length === 1 && ptys[1].written.length === 1);
		expect(ptys.map((p) => p.written[0]).sort()).toEqual(['a', 'b']);
		a.close();
		b.close();
	});

	it('says why when the pty cannot start', async () => {
		terminals.close();
		terminals = new TerminalServer({
			resolve,
			spawn: () => {
				throw new Error('posix_spawnp failed.');
			}
		});
		const ws = dial();
		const closed = new Promise<[number, string]>((res) =>
			ws.once('close', (c, r) => res([c, r.toString()]))
		);
		expect(await closed).toEqual([
			TERMINAL_CLOSE.failed,
			'The terminal could not start: posix_spawnp failed.'
		]);
	});

	it('cuts a long, non-ASCII failure to a close reason that fits', async () => {
		terminals.close();
		const message = `Cannot find module '/Users/José/${'é'.repeat(200)}/pty.node'`;
		terminals = new TerminalServer({
			resolve,
			spawn: () => {
				throw new Error(message);
			}
		});
		const ws = dial();
		const closed = new Promise<[number, string]>((res) =>
			ws.once('close', (c, r) => res([c, r.toString()]))
		);
		const [code, reason] = await closed;
		expect(code).toBe(TERMINAL_CLOSE.failed);
		expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123);
		expect(`The terminal could not start: ${message}`.startsWith(reason)).toBe(true);
		await until(() => terminals.connections === 0);
	});

	it('closes every terminal on shutdown', async () => {
		const ws = dial();
		await opened(ws);
		await until(() => ptys.length === 1);
		const code = new Promise<number>((res) => ws.once('close', (c) => res(c)));
		terminals.close();
		expect(await code).toBe(TERMINAL_CLOSE.shutdown);
		expect(ptys[0].killed).toBe(true);
	});
});
