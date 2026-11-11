import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
	FakeGateway,
	LIMITS,
	RELAY,
	type DeviceSocket
} from '../../../../tests/helpers/fake-cloud-gateway';
import { disconnect } from './pairing';
import { DEFAULT_LIMITS, newDeviceKey } from './protocol';
import { Relay } from './relay';
import { CloudService } from './service';
import { CloudSettings } from './settings';

/**
 * The connector end to end: a gateway (tests/helpers/fake-cloud-gateway.ts)
 * relays requests and WebSockets over the device socket to a stand-in for the
 * local Wheelhouse and a preview server, on loopback.
 */

const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
	const end = Date.now() + ms;
	while (!(await f())) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
};

async function listen(s: Server): Promise<number> {
	await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
	const a = s.address();
	return typeof a === 'object' && a ? a.port : 0;
}

/** A stand-in for the local Wheelhouse: it answers with what it was sent. */
function wheelhouse() {
	let sseNext: () => void = () => {};
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const body = Buffer.concat(chunks);
			if (req.url === '/big') {
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				return res.end(Buffer.alloc(1024 * 1024, 7));
			}
			if (req.url === '/sse') {
				res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
				res.write('data: one\n\n');
				sseNext = () => res.end('data: two\n\n');
				return;
			}
			if (req.url === '/moved') {
				res.writeHead(302, { location: `http://127.0.0.1:${port}/there?x=1` });
				return res.end();
			}
			if (req.url === '/nothing') {
				res.writeHead(204);
				return res.end();
			}
			res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=1; Path=/' });
			res.end(
				JSON.stringify({
					method: req.method,
					url: req.url,
					headers: req.headers,
					bytes: body.length,
					sha: createHash('sha256').update(body).digest('hex')
				})
			);
		});
	});
	const wss = new WebSocketServer({
		server,
		handleProtocols: (ps) => (ps.has('wheelhouse.terminal.v1') ? 'wheelhouse.terminal.v1' : false),
		verifyClient: (info, cb) => (info.req.url?.startsWith('/forbidden') ? cb(false, 403) : cb(true))
	});
	const upgrades: Record<string, unknown>[] = [];
	wss.on('connection', (ws, req) => {
		upgrades.push({ ...req.headers, url: req.url });
		ws.on('message', (data, binary) => {
			if (data.toString() === 'bye') return ws.close(4001, 'done');
			ws.send(data, { binary });
		});
	});
	let port = 0;
	return {
		server,
		upgrades,
		sse: () => sseNext(),
		start: async () => (port = await listen(server)),
		stop: () => {
			wss.close();
			server.closeAllConnections();
			server.close();
		}
	};
}

let gw: FakeGateway;
let dir: string;
let settings: CloudSettings;
let service: CloudService | null;
let local: ReturnType<typeof wheelhouse>;
let preview: Server;
let appPort: number;
let previewPort: number;
let deviceId: string;
const logs: string[] = [];

/** Paired and on, as `wheelhouse remote connect` leaves it; `started` as Start on the Remotes page does. */
async function paired(started = true) {
	const key = newDeviceKey();
	deviceId = 'd-1';
	gw.devices.set(deviceId, { publicKey: key.publicKey, name: 'Mac', revoked: false });
	await settings.setKey(key);
	await settings.update((s) => {
		s.enabled = true;
		s.started = started;
		s.gateway = gw.origin;
		s.device = {
			id: deviceId,
			name: 'Mac',
			gateway: gw.origin,
			publicKey: key.publicKey,
			user: 'Captain',
			pairedAt: new Date().toISOString()
		};
	});
}

function newService(over: Partial<ConstructorParameters<typeof CloudService>[0]> = {}) {
	return new CloudService({
		settings,
		version: '9.9.9',
		appPort: () => appPort,
		previewPorts: async () => new Set([previewPort, 1]),
		log: (l) => logs.push(l),
		pollMs: 50,
		...over
	});
}

async function connected(): Promise<DeviceSocket> {
	const next = gw.nextSocket();
	service = newService();
	await service.start();
	return next;
}

beforeEach(async () => {
	gw = await FakeGateway.start();
	dir = await mkdtemp(path.join(tmpdir(), 'wh-cloud-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	local = wheelhouse();
	appPort = await local.start();
	preview = createServer((req, res) => res.end(`preview ${req.headers.host} ${req.url}`));
	previewPort = await listen(preview);
	logs.length = 0;
	service = null;
	await paired();
});

afterEach(async () => {
	await service?.stop();
	await gw.stop();
	local.stop();
	preview.closeAllConnections();
	preview.close();
	await rm(dir, { recursive: true, force: true });
});

describe('starting', () => {
	it('never connects a paired machine that was not started on the Remotes page, as `wheelhouse open` runs it', async () => {
		await paired(false);
		service = newService();
		await service.start();
		await new Promise((r) => setTimeout(r, 200));
		expect(gw.connects).toHaveLength(0);
		expect((await settings.view()).state).toBe('off');
	});

	it('connects once started, and disconnects when stopped', async () => {
		await paired(false);
		service = newService();
		await service.start();
		const next = gw.nextSocket();
		await settings.update((s) => (s.started = true));
		const sock = await next;
		await until(async () => (await settings.view()).state === 'online');
		await settings.update((s) => {
			s.started = false;
			s.enabled = false;
		});
		await until(() => sock.closedWith !== null);
		await until(async () => (await settings.view()).state === 'off');
	});

	it('connects without a Start when asked for explicitly (`wheelhouse remote run`)', async () => {
		await paired(false);
		const next = gw.nextSocket();
		service = newService({ startedOnly: false });
		await service.start();
		await next;
	});
});

describe('the device socket', () => {
	it('dials out, proves it holds the key and says it is online', async () => {
		const sock = await connected();
		expect(gw.connects).toEqual([{ deviceId, ok: true, protocolHeader: '1' }]);
		expect(sock.deviceId).toBe(deviceId);
		await until(async () => (await settings.view()).state === 'online');
		const v = await settings.view();
		expect(v.since).not.toBeNull();
		expect(v.lastSeen).not.toBeNull();
	});

	it('answers a ping at once', async () => {
		const sock = await connected();
		sock.ping();
		await until(() => sock.pongs === 1);
	});

	it('reconnects when the gateway restarts', async () => {
		const sock = await connected();
		const again = gw.nextSocket();
		sock.close(1012);
		const second = await again;
		expect(second).not.toBe(sock);
		expect(gw.connects.filter((c) => c.ok)).toHaveLength(2);
	});

	it('stops for good when another connection replaces it', async () => {
		const sock = await connected();
		sock.close(4409);
		await until(async () => (await settings.view()).state === 'stopped');
		expect((await settings.view()).reason).toMatch(/replaced/);
		await new Promise((r) => setTimeout(r, 300));
		expect(gw.connects).toHaveLength(1);
	});

	it('deletes its key and record when the machine is removed on the gateway', async () => {
		await connected();
		gw.revoke(deviceId);
		// Forgetting the device and writing the stopped status run side by side; wait for both.
		await until(
			async () =>
				(await settings.read()).settings.device === null &&
				/removed/.test((await settings.view()).reason ?? '')
		);
		expect(await settings.findKey()).toBeNull();
	});

	it('stays off and stopped after Revoke, though the gateway then closes the socket (4403)', async () => {
		const sock = await connected();
		await disconnect(settings);
		expect(gw.unpaired).toEqual([deviceId]);
		await until(() => sock.closedWith !== null);
		await new Promise((r) => setTimeout(r, 200));
		expect((await settings.read()).settings).toMatchObject({
			enabled: false,
			started: false,
			device: null
		});
	});

	it('disconnects when the cloud is turned off here, and connects again when it is turned on', async () => {
		const sock = await connected();
		await settings.update((s) => (s.enabled = false));
		await until(() => sock.closedWith !== null);
		await until(async () => (await settings.view()).state === 'off');
		const again = gw.nextSocket();
		await settings.update((s) => (s.enabled = true));
		await again;
	});

	it('leaves the socket to another live connector of the same device', async () => {
		await settings.writeStatus({
			pid: process.ppid,
			state: 'online',
			reason: null,
			gateway: gw.origin,
			deviceId,
			since: null,
			lastSeen: null,
			updatedAt: new Date().toISOString(),
			sessions: []
		});
		service = new CloudService({
			settings,
			version: '9.9.9',
			appPort: () => appPort,
			previewPorts: async () => new Set(),
			log: (l) => logs.push(l),
			pollMs: 50
		});
		await service.start();
		await new Promise((r) => setTimeout(r, 150));
		expect(gw.connects).toHaveLength(0);
		expect(logs.join('\n')).toMatch(/already connected by process/);
	});

	it('takes the socket over from a status no live connector has written for minutes', async () => {
		await settings.writeStatus({
			pid: process.ppid,
			state: 'online',
			reason: null,
			gateway: gw.origin,
			deviceId,
			since: null,
			lastSeen: null,
			updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
			sessions: []
		});
		await connected();
		expect(gw.connects).toHaveLength(1);
	});
});

describe('relayed HTTP', () => {
	it('sets Host to Wheelhouse, drops an unchecked Origin and labels the request as remote', async () => {
		const sock = await connected();
		const r = await sock.request({
			path: '/api/fleet?x=1',
			headers: [
				['accept', 'application/json'],
				['origin', 'https://evil.example'],
				['x-wheelhouse-remote-user', 'spoofed'],
				['cookie', 'a=1'],
				['cookie', 'b=2']
			]
		});
		expect(r.status).toBe(200);
		const seen = JSON.parse(r.body.toString()) as { url: string; headers: Record<string, string> };
		expect(seen.url).toBe('/api/fleet?x=1');
		expect(seen.headers.host).toBe(`127.0.0.1:${appPort}`);
		expect(seen.headers.origin).toBeUndefined();
		expect(seen.headers.cookie).toBe('a=1; b=2');
		expect(seen.headers['x-wheelhouse-remote']).toBe('1');
		expect(seen.headers['x-wheelhouse-remote-user']).toBe(RELAY.user.id);
		expect(seen.headers['x-wheelhouse-remote-session']).toBe(RELAY.sessionId);
		expect(seen.headers['x-wheelhouse-remote-origin']).toBe(RELAY.origin);
		expect(seen.headers['x-wheelhouse-remote-preview']).toBe(RELAY.previewOrigin);
		expect(r.headers).toContainEqual(['set-cookie', 'a=1; Path=/']);
		expect(r.headers.map(([n]) => n)).not.toContain('transfer-encoding');
	});

	it('rewrites a checked Origin to the local one and streams the body in under the window', async () => {
		const sock = await connected();
		const body = Buffer.alloc(300 * 1024, 3);
		const r = await sock.request({
			method: 'POST',
			path: '/api/firstmate/uploads?name=a.bin',
			headers: [
				['content-type', 'application/octet-stream'],
				['content-length', String(body.length)],
				['origin', RELAY.origin]
			],
			originChecked: true,
			body
		});
		const seen = JSON.parse(r.body.toString()) as {
			headers: Record<string, string>;
			bytes: number;
			sha: string;
		};
		expect(seen.headers.origin).toBe(`http://127.0.0.1:${appPort}`);
		expect(seen.bytes).toBe(body.length);
		expect(seen.sha).toBe(createHash('sha256').update(body).digest('hex'));
		expect(sock.controls.some((m) => m.t === 'credit' && m.id === 1)).toBe(true);
	});

	it('sends a large answer in frames, never past the window while credit is held', async () => {
		const sock = await connected();
		sock.holdCredit = true;
		const done = sock.request({ path: '/big' });
		await new Promise((r) => setTimeout(r, 200));
		sock.release();
		const r = await done;
		expect(r.body.length).toBe(1024 * 1024);
		expect(r.maxOutstanding).toBeGreaterThan(0);
		expect(r.maxOutstanding).toBeLessThanOrEqual(LIMITS.window + LIMITS.maxFrame);
	});

	it('passes server-sent events on as they come', async () => {
		const sock = await connected();
		const done = sock.request({ path: '/sse' });
		await until(() => sock.controls.some((m) => m.t === 'res'));
		// The first event is through before the answer ends.
		await new Promise((r) => setTimeout(r, 50));
		local.sse();
		const r = await done;
		expect(r.body.toString()).toBe('data: one\n\ndata: two\n\n');
	});

	it('keeps a redirect to Wheelhouse itself on the relay host', async () => {
		const sock = await connected();
		const r = await sock.request({ path: '/moved' });
		expect(r.status).toBe(302);
		expect(r.headers).toContainEqual(['location', '/there?x=1']);
	});

	it('ends a 204 and a HEAD with no body', async () => {
		const sock = await connected();
		expect((await sock.request({ path: '/nothing' })).status).toBe(204);
		const head = await sock.request({ method: 'HEAD', path: '/x' });
		expect(head.status).toBe(200);
		expect(head.body.length).toBe(0);
	});

	it('reaches a preview port with Host localhost:<port>', async () => {
		const sock = await connected();
		const r = await sock.request({ path: '/app', target: { kind: 'port', port: previewPort } });
		expect(r.body.toString()).toBe(`preview localhost:${previewPort} /app`);
	});

	it('refuses ports that are not previews, Wheelhouse’s own port and the restart', async () => {
		const sock = await connected();
		const refused = async (o: Parameters<DeviceSocket['request']>[0]) =>
			(await sock.request(o)).reset?.code;
		expect(await refused({ path: '/', target: { kind: 'port', port: 22 } })).toBe('refused');
		expect(await refused({ path: '/', target: { kind: 'port', port: appPort } })).toBe('refused');
		expect(await refused({ method: 'POST', path: '/api/wheelhouse/restart' })).toBe('refused');
		expect(await refused({ method: 'POST', path: '/api/wheelhouse%2Frestart' })).toBe('refused');
	});

	it('says a preview port with nothing listening is unreachable', async () => {
		const sock = await connected();
		expect((await sock.request({ path: '/', target: { kind: 'port', port: 1 } })).reset?.code).toBe(
			'unreachable'
		);
	});

	it('refuses everything once the cloud is turned off here, even before the socket closes', async () => {
		const sent: Record<string, unknown>[] = [];
		const relay = new Relay({
			send: (m) => sent.push(m),
			sendFrame: () => {},
			limits: DEFAULT_LIMITS,
			targets: { appPort: () => appPort, previewPorts: async () => new Set(), enabled: () => false }
		});
		relay.control({
			t: 'req',
			id: 1,
			target: { kind: 'app' },
			method: 'GET',
			path: '/',
			headers: [],
			body: false,
			relay: RELAY
		});
		await until(() => sent.length > 0);
		expect(sent[0]).toMatchObject({ t: 'reset', id: 1, code: 'refused' });
		expect(local.upgrades).toHaveLength(0);
	});

	it('records the relay session locally, without paths or headers', async () => {
		const sock = await connected();
		await sock.request({ path: '/secret/path?token=abc' });
		await sock.request({ path: '/again' });
		await service!.stop();
		service = null;
		const v = await settings.view();
		expect(v.sessions).toHaveLength(1);
		expect(v.sessions[0]).toMatchObject({ id: RELAY.sessionId, user: 'Captain', requests: 2 });
		const file = await readFile(settings.statusFile, 'utf8');
		expect(file).not.toContain('secret');
		expect(file).not.toContain('token');
	});
});

describe('relayed WebSockets', () => {
	it('opens the terminal with its subprotocols and carries messages both ways', async () => {
		const sock = await connected();
		const ws = sock.socket({
			path: '/api/firstmate/terminal?cols=80',
			protocols: ['wheelhouse.terminal.v1', 'wheelhouse.token.abc'],
			headers: [['origin', RELAY.origin]],
			originChecked: true
		});
		await ws.ready;
		expect(ws.accepted).toEqual({ protocol: 'wheelhouse.terminal.v1' });
		const up = local.upgrades[0] as Record<string, string>;
		expect(up.host).toBe(`127.0.0.1:${appPort}`);
		expect(up.origin).toBe(`http://127.0.0.1:${appPort}`);
		expect(up['sec-websocket-protocol']).toBe('wheelhouse.terminal.v1,wheelhouse.token.abc');
		expect(up['x-wheelhouse-remote']).toBe('1');
		expect(up['sec-websocket-extensions']).toBeUndefined();
		ws.send('hello');
		ws.send(Buffer.from([1, 2, 3]));
		await ws.next(2);
		expect(ws.messages[0]).toEqual({ binary: false, data: Buffer.from('hello') });
		expect(ws.messages[1]).toEqual({ binary: true, data: Buffer.from([1, 2, 3]) });
	});

	it('passes the local side’s close on with its code', async () => {
		const sock = await connected();
		const ws = sock.socket({ path: '/t', protocols: ['wheelhouse.terminal.v1'] });
		await ws.ready;
		ws.send('bye');
		await until(() => ws.closed !== null);
		expect(ws.closed).toEqual({ code: 4001, reason: 'done' });
	});

	it('closes the local side when the browser goes', async () => {
		const sock = await connected();
		const ws = sock.socket({ path: '/t' });
		await ws.ready;
		expect(ws.accepted).toEqual({ protocol: null });
		ws.close(1000);
		await new Promise((r) => setTimeout(r, 100));
		ws.send('after');
		await new Promise((r) => setTimeout(r, 100));
		expect(ws.messages).toHaveLength(0);
	});

	it('reports a refused upgrade with its status', async () => {
		const sock = await connected();
		const ws = sock.socket({ path: '/forbidden' });
		await ws.ready;
		expect(ws.reset).toMatchObject({ code: 'refused', status: 403 });
	});
});

describe('the key file', () => {
	it('is readable by the captain only', async () => {
		expect((await stat(settings.keyFile)).mode & 0o777).toBe(0o600);
		expect((await stat(settings.dir)).mode & 0o777).toBe(0o700);
	});
});
