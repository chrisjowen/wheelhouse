import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
	FakeGateway,
	LIMITS,
	RELAY,
	SoftPasskey,
	type DeviceSocket
} from '../../../../tests/helpers/fake-cloud-gateway';
import { cspHeader } from '../../apps/csp';
import { SandboxServer } from '../apps/sandbox';
import { Connector } from './connector';
import { PENDING_PINS_MS, VERIFIED_SESSION_MS } from './guard';
import { disconnect } from './pairing';
import type { PinnedPasskey } from './passkeys';
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

/**
 * Paired and on, as `wheelhouse remote connect` leaves it; `started` as Start on
 * the Remotes page does; `pins` as a pairing through a gateway that speaks
 * protocol 2 leaves it (none: paired before, or through a version 1 gateway).
 */
async function paired(started = true, pins: PinnedPasskey[] | null = null) {
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
			pairedAt: new Date().toISOString(),
			pins,
			pinnedAt: pins ? new Date().toISOString() : null,
			pending: null,
			decided: null
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

/** The id this machine gave the change waiting for the captain's decision. */
const pendingId = async () => (await settings.read()).settings.device!.pending!.id;

async function connected(
	over: Partial<ConstructorParameters<typeof CloudService>[0]> = {}
): Promise<DeviceSocket> {
	const next = gw.nextSocket();
	service = newService(over);
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
		expect(gw.connects).toEqual([
			{ deviceId, ok: true, protocolHeader: '2', protocol: 2, pins: [] }
		]);
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

	it('relays an MCP app’s sandbox, framed only by the page that came through the relay', async () => {
		const sandbox = new SandboxServer();
		await sandbox.start();
		try {
			const at = sandbox.url({ connectDomains: ['https://api.example.com'] });
			if (!('url' in at)) throw new Error(at.reason);
			const u = new URL(at.url);
			u.searchParams.set('host', RELAY.origin);
			const next = gw.nextSocket();
			service = newService({ previewPorts: async () => new Set([sandbox.port()!]) });
			await service.start();
			const sock = await next;
			const r = await sock.request({
				path: u.pathname + u.search,
				target: { kind: 'port', port: sandbox.port()! },
				// What the browser says about where it came from is not taken.
				headers: [
					['x-wheelhouse-remote', '1'],
					['x-wheelhouse-remote-origin', 'https://evil.example.com']
				]
			});
			expect(r.status).toBe(200);
			const policy = r.headers.find(([k]) => k === 'content-security-policy')?.[1];
			expect(policy).toBe(
				`${cspHeader({ connectDomains: ['https://api.example.com'] })}; frame-ancestors ${RELAY.origin}`
			);
			// Another page named in the address is not let in.
			u.searchParams.set('host', 'https://evil.example.com');
			const other = await sock.request({
				path: u.pathname + u.search,
				target: { kind: 'port', port: sandbox.port()! }
			});
			expect(other.status).toBe(400);
		} finally {
			sandbox.close();
		}
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

describe('sessions this machine checks itself (protocol 2)', () => {
	let mac: SoftPasskey;

	beforeEach(async () => {
		mac = gw.passkeys[0];
		await paired(true, [mac.pin]);
	});

	it('names the passkeys it trusts when it connects', async () => {
		await connected();
		expect(gw.connects).toEqual([
			{ deviceId, ok: true, protocolHeader: '2', protocol: 2, pins: [mac.id] }
		]);
	});

	it('refuses a session the gateway opens on its own: no request or terminal reaches Wheelhouse', async () => {
		const sock = await connected();
		const r = await sock.request({ path: '/api/fleet', relay: sock.relayFor('opened-alone') });
		expect(r.reset).toMatchObject({
			code: 'refused',
			message: expect.stringMatching(/No trusted passkey signed/)
		});
		const ws = sock.socket({
			path: '/api/firstmate/terminal',
			protocols: ['wheelhouse.terminal.v1'],
			relay: sock.relayFor('opened-alone')
		});
		await ws.ready;
		expect(ws.reset).toMatchObject({ code: 'refused' });
		expect(local.upgrades).toHaveLength(0);
		expect((await settings.view()).sessions).toEqual([]);
		// Logged once, however many of its streams were refused.
		expect(logs.filter((l) => /refused the streams of session opened-a/.test(l))).toHaveLength(1);
	});

	it('refuses a session whose signature the gateway forged, or that a passkey it does not trust signed', async () => {
		const sock = await connected();
		const mallory = new SoftPasskey('Mallory');
		const forged = await sock.openSession(mallory);
		expect(forged).toMatchObject({ ok: false, reason: expect.stringMatching(/does not trust/) });
		const unsigned = await sock.openSession(() => undefined);
		expect(unsigned).toMatchObject({ ok: false, reason: 'no passkey signature' });
		for (const s of [forged, unsigned]) {
			const r = await sock.request({ path: '/', relay: sock.relayFor(s.sessionId) });
			expect(r.reset?.code).toBe('refused');
		}
		expect(logs.join('\n')).toMatch(/refused to open session/);
	});

	it('serves a session a pinned passkey signed: pages, previews and the terminal', async () => {
		const sock = await connected();
		const opened = await sock.openSession(mac);
		expect(opened).toMatchObject({ ok: true, credentials: [mac.id] });
		expect(Buffer.from(opened.challenge!, 'base64url').toString('latin1')).toMatch(
			/^whc-session-v2\n[\s\S]{32}$/
		);
		const relay = sock.relayFor(opened.sessionId);
		const r = await sock.request({ path: '/api/fleet', relay });
		expect(r.status).toBe(200);
		const p = await sock.request({
			path: '/a',
			target: { kind: 'port', port: previewPort },
			relay
		});
		expect(p.body.toString()).toBe(`preview localhost:${previewPort} /a`);
		const ws = sock.socket({ path: '/t', protocols: ['wheelhouse.terminal.v1'], relay });
		await ws.ready;
		expect(ws.accepted).toEqual({ protocol: 'wheelhouse.terminal.v1' });
	});

	it('refuses a replayed challenge, for the same session and for a new one', async () => {
		const sock = await connected();
		const first = await sock.openSession(mac);
		expect(first.ok).toBe(true);
		// The gateway hands the same signature over again.
		expect(await sock.verifySession(first.sessionId, first.assertion)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/already used/)
		});
		const again = await sock.openSession(() => first.assertion);
		expect(again).toMatchObject({ ok: false, reason: 'signed another challenge' });
		const r = await sock.request({ path: '/', relay: sock.relayFor(again.sessionId) });
		expect(r.reset?.code).toBe('refused');
	});

	it('ends a session’s streams when the session ends, even ones the gateway leaves open', async () => {
		const sock = await connected();
		const { sessionId } = await sock.openSession(mac);
		const relay = sock.relayFor(sessionId);
		const ws = sock.socket({ path: '/t', relay });
		await ws.ready;
		sock.endSession(sessionId);
		await until(() => ws.reset !== null);
		expect(ws.reset).toMatchObject({ code: 'refused' });
		expect((await sock.request({ path: '/', relay })).reset?.code).toBe('refused');
	});

	it('keeps verified sessions across a reconnect', async () => {
		const sock = await connected();
		const { sessionId } = await sock.openSession(mac);
		const again = gw.nextSocket();
		sock.close(1012);
		const second = await again;
		expect((await second.request({ path: '/', relay: second.relayFor(sessionId) })).status).toBe(
			200
		);
	});

	it('serves nothing through a reconnect that negotiates protocol 1, not even a session verified before', async () => {
		const sock = await connected();
		const { sessionId } = await sock.openSession(mac);
		expect((await sock.request({ path: '/', relay: sock.relayFor(sessionId) })).status).toBe(200);
		gw.protocol = 1;
		const older = gw.nextSocket();
		sock.close(1012);
		const downgraded = await older;
		expect(
			(await downgraded.request({ path: '/', relay: downgraded.relayFor(sessionId) })).reset?.code
		).toBe('refused');
		// It issues, checks and keeps nothing there.
		expect(await downgraded.openSession(mac)).toMatchObject({ challenge: null, ok: false });
		const repin = await downgraded.updatePins([new SoftPasskey('iPhone').pin], mac);
		expect(repin).toMatchObject({ challenge: null, ok: false });
		expect((await settings.read()).settings.device?.pending).toBeNull();
		// Back on protocol 2, the session it verified is served again, within its 8 hours.
		gw.protocol = 2;
		const newer = gw.nextSocket();
		downgraded.close(1012);
		const back = await newer;
		expect((await back.request({ path: '/', relay: back.relayFor(sessionId) })).status).toBe(200);
	});

	it('refuses every session from a gateway that speaks only protocol 1, and says why', async () => {
		gw.protocol = 1;
		const sock = await connected();
		await until(async () => (await settings.view()).state === 'online');
		expect((await settings.view()).reason).toMatch(/protocol 1.*refuses every session/);
		expect((await sock.request({ path: '/' })).reset?.code).toBe('refused');
		expect(local.upgrades).toHaveLength(0);
	});

	it('keeps a signed change of passkeys pending: nothing changes until it is approved here', async () => {
		const sock = await connected();
		const phone = new SoftPasskey('iPhone');
		const r = await sock.updatePins([mac.pin, phone.pin], mac);
		expect(r).toMatchObject({ ok: true, pending: true });
		const device = (await settings.read()).settings.device!;
		expect(device.pins).toEqual([mac.pin]);
		expect(device.pending).toMatchObject({
			ref: r.ref,
			passkeys: [mac.pin, phone.pin],
			signedBy: 'MacBook Touch ID'
		});
		const pending = (await settings.view()).device!.pending!;
		expect(pending.passkeys.map((p) => [p.name, p.added])).toEqual([
			['MacBook Touch ID', false],
			['iPhone', true]
		]);
		expect(pending.removed).toEqual([]);
		// A passkey only the pending list has opens nothing.
		expect((await sock.openSession(phone)).ok).toBe(false);
		await new Promise((res) => setTimeout(res, 200));
		expect(sock.controls.some((m) => m.t === 'pins.decided')).toBe(false);
	});

	it('applies a change approved here, and tells the gateway, without reconnecting', async () => {
		const sock = await connected();
		const phone = new SoftPasskey('iPhone');
		const { ref } = await sock.updatePins([phone.pin], mac);
		expect((await settings.view()).device!.pending!.removed.map((p) => p.name)).toEqual([
			'MacBook Touch ID'
		]);
		expect(await settings.approvePins(await pendingId())).toEqual({ ok: true });
		expect(await sock.decided(ref)).toEqual({
			t: 'pins.decided',
			ref,
			approved: true,
			pins: [phone.id]
		});
		expect((await settings.read()).settings.device).toMatchObject({
			pins: [phone.pin],
			pending: null
		});
		expect((await sock.openSession(phone)).ok).toBe(true);
		expect((await sock.openSession(mac)).ok).toBe(false);
		expect(gw.connects).toHaveLength(1);
		// The next connection names the same pins.
		const again = gw.nextSocket();
		sock.close(1012);
		await again;
		expect(gw.connects.at(-1)?.pins).toEqual([phone.id]);
	});

	it('trusts a change approved here even when a newer one is rejected before it looks again', async () => {
		const sock = await connected({ pollMs: 60_000 });
		const phone = new SoftPasskey('iPhone');
		await sock.updatePins([phone.pin], mac);
		expect(await settings.approvePins(await pendingId())).toEqual({ ok: true });
		// Still checked against the passkeys in use: the approval is not taken up yet.
		const newer = await sock.updatePins([mac.pin, phone.pin], mac);
		expect(newer).toMatchObject({ ok: true, pending: true });
		expect(await settings.rejectPins(await pendingId())).toEqual({ ok: true });
		await service!['tick']();
		expect(await sock.decided(newer.ref)).toMatchObject({
			approved: false,
			reason: 'rejected',
			pins: [phone.id]
		});
		expect((await settings.read()).settings.device?.pins).toEqual([phone.pin]);
		expect((await sock.openSession(phone)).ok).toBe(true);
		expect((await sock.openSession(mac)).ok).toBe(false);
		expect(gw.connects).toHaveLength(1);
	});

	it('drops a change rejected here, keeping its passkeys, and tells the gateway', async () => {
		const sock = await connected();
		const phone = new SoftPasskey('iPhone');
		const { ref } = await sock.updatePins([phone.pin], mac);
		expect(await settings.rejectPins(await pendingId())).toEqual({ ok: true });
		expect(await sock.decided(ref)).toEqual({
			t: 'pins.decided',
			ref,
			approved: false,
			reason: 'rejected',
			pins: [mac.id]
		});
		expect((await settings.read()).settings.device).toMatchObject({
			pins: [mac.pin],
			pending: null
		});
		expect((await sock.openSession(phone)).ok).toBe(false);
		expect((await sock.openSession(mac)).ok).toBe(true);
	});

	it('lets a change nobody decides on lapse after an hour, as rejected', async () => {
		let clock = Date.now();
		const sock = await connected({ now: () => clock });
		const { ref } = await sock.updatePins([new SoftPasskey('iPhone').pin], mac);
		const id = await pendingId();
		clock += PENDING_PINS_MS + 1000;
		expect(await sock.decided(ref)).toMatchObject({
			approved: false,
			reason: 'expired',
			pins: [mac.id]
		});
		expect((await settings.read()).settings.device).toMatchObject({
			pins: [mac.pin],
			pending: null
		});
		expect(await settings.approvePins(id)).toMatchObject({ ok: false });
	});

	it('replaces a change still waiting with a newer one, telling the gateway', async () => {
		const sock = await connected();
		const phone = new SoftPasskey('iPhone');
		const first = await sock.updatePins([phone.pin], mac);
		const shown = await pendingId();
		const second = await sock.updatePins([mac.pin, phone.pin], mac);
		expect(await sock.decided(first.ref)).toMatchObject({
			approved: false,
			reason: 'replaced',
			pins: [mac.id]
		});
		expect((await settings.read()).settings.device?.pending?.ref).toBe(second.ref);
		// The one the captain may have been looking at is gone: approving it does nothing.
		expect(await settings.approvePins(shown)).toMatchObject({
			ok: false,
			error: expect.stringMatching(/No such change/)
		});
		expect((await settings.read()).settings.device?.pins).toEqual([mac.pin]);
	});

	it('never approves another list sent again under the same ref in place of the one shown', async () => {
		const sock = await connected();
		const phone = new SoftPasskey('iPhone');
		const evil = new SoftPasskey('Not yours');
		await sock.updatePins([mac.pin, phone.pin], mac, 'same-ref');
		const shown = await pendingId();
		// The gateway asks again under the same ref, with a passkey of its own, once more signed.
		await sock.updatePins([mac.pin, evil.pin], mac, 'same-ref');
		const now = (await settings.read()).settings.device!.pending!;
		expect(now.passkeys).toEqual([mac.pin, evil.pin]);
		expect(now.id).not.toBe(shown);
		expect(await settings.approvePins(shown)).toMatchObject({
			ok: false,
			error: expect.stringMatching(/No such change/)
		});
		expect((await settings.read()).settings.device?.pins).toEqual([mac.pin]);
		expect((await sock.openSession(evil)).ok).toBe(false);
	});

	it('refuses a new list signed by a passkey it does not trust, keeping nothing pending', async () => {
		const sock = await connected();
		const mallory = new SoftPasskey('Mallory');
		const r = await sock.updatePins([mallory.pin], mallory);
		expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/does not trust/) });
		expect((await settings.read()).settings.device).toMatchObject({
			pins: [mac.pin],
			pending: null
		});
		expect((await sock.openSession(mallory)).ok).toBe(false);
	});

	it('refuses every session when its trusted passkeys cannot be read', async () => {
		const raw = JSON.parse(await readFile(settings.file, 'utf8')) as { device: { pins: unknown } };
		raw.device.pins = 'garbled';
		await writeFile(settings.file, JSON.stringify(raw));
		expect((await settings.view()).device?.passkeys).toEqual([]);
		const sock = await connected();
		expect(await sock.openSession(mac)).toMatchObject({ challenge: null, ok: false });
		expect((await sock.request({ path: '/' })).reset?.code).toBe('refused');
	});

	it('stops serving a session 8 hours after it was signed, open streams too', async () => {
		let clock = Date.now();
		const found = await settings.findKey();
		const next = gw.nextSocket();
		const states: string[] = [];
		const connector = new Connector({
			gateway: gw.origin,
			deviceId,
			key: found!.key,
			version: '9.9.9',
			pins: [mac.pin],
			targets: { appPort: () => appPort, previewPorts: async () => new Set(), enabled: () => true },
			events: { state: (s) => states.push(s) },
			now: () => clock,
			sweepMs: 20
		});
		connector.start();
		try {
			const sock = await next;
			const { sessionId } = await sock.openSession(mac);
			const relay = sock.relayFor(sessionId);
			const ws = sock.socket({ path: '/t', relay });
			await ws.ready;
			expect(ws.accepted).not.toBeNull();
			clock += VERIFIED_SESSION_MS + 1000;
			await until(() => ws.reset !== null);
			expect(ws.reset).toMatchObject({ code: 'refused' });
			expect((await sock.request({ path: '/', relay })).reset?.code).toBe('refused');
		} finally {
			connector.stop();
		}
	});
});

describe('a machine paired without pins (before protocol 2, or through a version 1 gateway)', () => {
	it('serves every session as before, and answers a challenge with none', async () => {
		const sock = await connected();
		expect((await sock.openSession(gw.passkeys[0])).challenge).toBeNull();
		expect((await sock.request({ path: '/', relay: sock.relayFor('any') })).status).toBe(200);
	});

	it('connects to a gateway that speaks only protocol 1', async () => {
		gw.protocol = 1;
		const sock = await connected();
		expect(sock.protocol).toBe(1);
		await until(async () => (await settings.view()).state === 'online');
		expect((await settings.view()).reason).toBeNull();
		expect((await sock.request({ path: '/' })).status).toBe(200);
	});
});

describe('the key file', () => {
	it('is readable by the captain only', async () => {
		expect((await stat(settings.keyFile)).mode & 0o777).toBe(0o600);
		expect((await stat(settings.dir)).mode & 0o777).toBe(0o700);
	});
});
