import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import http2 from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
	FakeGateway,
	SoftPasskey,
	TLS_WINDOW,
	type DeviceSocket
} from '../../../../tests/helpers/fake-cloud-gateway';
import { localCa, type LocalCa } from '../../../../tests/helpers/origin-ca';
import { previewTemplate, remoteAddress } from '../../cloud';
import { newDeviceKey } from './protocol';
import { CloudService } from './service';
import { CloudSettings, originDir } from './settings';

/**
 * A machine with its sealed origin on (§12 of the protocol), end to end: the
 * gateway (tests/helpers/fake-cloud-gateway.ts) carries a browser's TLS to one
 * of the machine's names as a `tls` stream, the connector terminates it with
 * a certificate a test CA issued for the key it made, signs the captain in
 * with a passkey it pinned, and serves the local Wheelhouse and a preview
 * over HTTP/2, with WebSockets over HTTP/1.1. The gateway reads none of it.
 */

const LABEL = 'abcdefghijklmnopqrs2';
const DOMAIN = 'm.localhost';
const APP_HOST = `${LABEL}.${DOMAIN}`;
const APP = `https://${APP_HOST}`;

const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
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

/** A stand-in for the local Wheelhouse: it echoes what it was sent, streams events, and runs a terminal socket. */
function wheelhouse() {
	const seen: { url: string; method: string; headers: Record<string, unknown> }[] = [];
	let sseNext: () => void = () => {};
	const server = createServer((req, res) => {
		seen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers });
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
		const hash = createHash('sha256');
		let bytes = 0;
		req.on('data', (c: Buffer) => {
			bytes += c.length;
			hash.update(c);
		});
		req.on('end', () => {
			res.writeHead(200, {
				'content-type': 'application/json',
				'set-cookie': ['a=1; Path=/; Domain=127.0.0.1', '__Host-whm_session=forged; Path=/']
			});
			const sha = hash.digest('hex');
			res.end(
				JSON.stringify({ method: req.method, url: req.url, headers: req.headers, bytes, sha })
			);
		});
	});
	const wss = new WebSocketServer({
		server,
		handleProtocols: (ps) => (ps.has('wheelhouse.terminal.v1') ? 'wheelhouse.terminal.v1' : false)
	});
	const upgrades: Record<string, unknown>[] = [];
	wss.on('connection', (ws, req) => {
		upgrades.push({ ...req.headers, url: req.url });
		ws.on('message', (data, binary) => ws.send(data, { binary }));
	});
	return {
		seen,
		upgrades,
		sse: () => sseNext(),
		start: () => listen(server),
		stop: () => {
			wss.close();
			server.closeAllConnections();
			server.close();
		}
	};
}

interface Res {
	status: number;
	headers: http2.IncomingHttpHeaders;
	text: string;
}

/**
 * A browser on the machine's names, through the gateway: TLS over a `tls`
 * stream, trusting only the test CA, one HTTP/2 connection per host, and a
 * host-only cookie jar.
 */
class Browser {
	readonly jar = new Map<string, Map<string, string>>();
	private conns = new Map<string, http2.ClientHttp2Session>();
	constructor(private sock: DeviceSocket) {}

	/** A TLS connection to `host` over a new `tls` stream. */
	tls(host: string, alpn = ['h2', 'http/1.1']): tls.TLSSocket {
		const t = this.sock.openTls(host);
		return tls.connect({ socket: t.socket, servername: host, ca: ca.root, ALPNProtocols: alpn });
	}

	session(host: string): http2.ClientHttp2Session {
		let s = this.conns.get(host);
		if (!s || s.closed || s.destroyed) {
			s = http2.connect(`https://${host}`, { createConnection: () => this.tls(host) });
			s.on('error', () => {});
			this.conns.set(host, s);
		}
		return s;
	}

	cookies(host: string): string {
		return [...(this.jar.get(host) ?? new Map()).entries()].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	request(
		host: string,
		path: string,
		o: { method?: string; headers?: Record<string, string>; body?: string } = {}
	): Promise<Res> {
		return new Promise((resolve, reject) => {
			const cookie = this.cookies(host);
			const req = this.session(host).request({
				':method': o.method ?? 'GET',
				':path': path,
				...(cookie ? { cookie } : {}),
				...o.headers
			});
			let headers: http2.IncomingHttpHeaders = {};
			const chunks: Buffer[] = [];
			req.on('response', (h) => {
				headers = h;
				for (const c of [h['set-cookie'] ?? []].flat()) {
					const [pair] = c.split(';');
					const i = pair.indexOf('=');
					const jar = this.jar.get(host) ?? new Map<string, string>();
					if (/Max-Age=0/i.test(c)) jar.delete(pair.slice(0, i));
					else jar.set(pair.slice(0, i), pair.slice(i + 1));
					this.jar.set(host, jar);
				}
			});
			req.on('data', (c: Buffer) => chunks.push(c));
			req.on('end', () =>
				resolve({
					status: Number(headers[':status']),
					headers,
					text: Buffer.concat(chunks).toString('utf8')
				})
			);
			req.on('error', reject);
			req.end(o.body);
		});
	}

	close() {
		for (const s of this.conns.values()) s.destroy();
	}
}

let ca: LocalCa;
let gw: FakeGateway;
let dir: string;
let settings: CloudSettings;
let service: CloudService | null;
let local: ReturnType<typeof wheelhouse>;
let preview: Server;
let appPort: number;
let previewPort: number;
let browser: Browser | null;
const logs: string[] = [];
const deviceId = 'd-1';

/** Paired with the captain's passkey pinned and started, the sealed origin turned on here (or not). */
async function paired(sealed = true) {
	const key = newDeviceKey();
	gw.devices.set(deviceId, { publicKey: key.publicKey, name: 'Mac', revoked: false });
	await settings.setKey(key);
	await settings.update((s) => {
		s.enabled = true;
		s.started = true;
		s.gateway = gw.origin;
		s.device = {
			id: deviceId,
			name: 'Mac',
			gateway: gw.origin,
			publicKey: key.publicKey,
			user: 'Captain',
			pairedAt: new Date().toISOString(),
			pins: gw.passkeys.map((p) => p.pin),
			pinnedAt: new Date().toISOString(),
			pending: null,
			undelivered: [],
			...(sealed ? { sealedOrigin: { since: new Date().toISOString() } } : {})
		};
	});
}

async function connected(): Promise<DeviceSocket> {
	const next = gw.nextSocket();
	service = new CloudService({
		settings,
		version: '9.9.9',
		appPort: () => appPort,
		previewPorts: async () => new Set([previewPort]),
		log: (l) => logs.push(l),
		pollMs: 50,
		origin: { trust: [ca.root] }
	});
	await service.start();
	return next;
}

/** Connected, with its origin certificate issued. */
async function serving(): Promise<{ sock: DeviceSocket; b: Browser }> {
	const sock = await connected();
	await until(() => logs.some((l) => l.includes('origin certificate is valid until')));
	browser = new Browser(sock);
	return { sock, b: browser };
}

/** Sign in on the machine's own origin, as its sign-in page does, with `sign` making the assertion. */
async function signIn(
	b: Browser,
	sign: (challenge: string, rpId: string) => unknown = (c, rpId) =>
		gw.passkeys[0].sign(c, APP, { rpId })
): Promise<Res> {
	const json = { origin: APP, 'content-type': 'application/json' };
	const c = await b.request(APP_HOST, '/__whm/challenge', {
		method: 'POST',
		headers: json,
		body: '{}'
	});
	expect(c.status).toBe(200);
	const { challenge, rpId, credentials } = JSON.parse(c.text);
	expect(rpId).toBe('localhost');
	expect(credentials).toEqual([gw.passkeys[0].id]);
	return b.request(APP_HOST, '/__whm/signin', {
		method: 'POST',
		headers: json,
		body: JSON.stringify({ assertion: sign(challenge, rpId) })
	});
}

beforeAll(async () => {
	ca = await localCa();
});

afterAll(async () => {
	await ca?.close();
});

beforeEach(async () => {
	gw = await FakeGateway.start('localhost');
	gw.protocol = 3;
	gw.sealedOrigin = { label: LABEL };
	gw.issue = (csr) => ca.sign(csr, [APP_HOST, `*.${APP_HOST}`]);
	dir = await mkdtemp(path.join(tmpdir(), 'wh-origin-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	local = wheelhouse();
	appPort = await local.start();
	preview = createServer((req, res) => res.end(`preview ${req.headers.host} ${req.url}`));
	previewPort = await listen(preview);
	logs.length = 0;
	service = null;
	browser = null;
	await paired();
});

afterEach(async () => {
	browser?.close();
	await service?.stop();
	await gw.stop();
	local.stop();
	preview.closeAllConnections();
	preview.close();
	await rm(dir, { recursive: true, force: true });
});

describe('turning the sealed origin on', () => {
	it('speaks protocol 3, signs it, asks for sealed-origin, and gets a certificate for a key only it holds', async () => {
		await serving();
		const c = gw.connects[0];
		expect(c.protocolHeader).toBe('3');
		expect(c.protocol).toBe(3);
		expect(c.protocolSigned).toBe(true);
		expect(c.e2eKeySigned).toBe(true);
		expect(c.features).toContain('sealed-origin');
		expect(gw.certRequests).toHaveLength(1);
		expect(gw.certRequests[0].signed).toBe(true);
		expect(gw.certRequests[0].csr).not.toContain('PRIVATE KEY');
		const kept = originDir(settings.dir, deviceId);
		expect((await stat(path.join(kept, 'key.pem'))).mode & 0o777).toBe(0o600);
		expect(logs.some((l) => l.includes(`serves its own origin, ${APP}`))).toBe(true);
	});

	it('leaves a machine without it on protocol 2, with no sealed-origin and no protocol signature', async () => {
		await paired(false);
		await connected();
		expect(gw.connects[0].protocol).toBe(2);
		expect(gw.connects[0].protocolHeader).toBe('2');
		expect(gw.connects[0].features).not.toContain('sealed-origin');
		expect(gw.connects[0].protocolSigned).toBeUndefined();
	});

	it('refuses the relay the gateway can read: requests, sockets and sessions', async () => {
		const { sock } = await serving();
		const r = await sock.request({ path: '/echo' });
		expect(r.reset).toMatchObject({ code: 'refused' });
		const ws = sock.socket({
			path: '/api/firstmate/terminal',
			protocols: ['wheelhouse.terminal.v1']
		});
		await ws.ready;
		expect(ws.reset).toMatchObject({ code: 'refused' });
		const s = await sock.openSession(gw.passkeys[0]);
		expect(s.challenge).toBeNull();
		expect(s.error).toContain(APP);
		expect(s.ok).toBe(false);
		expect(local.seen).toEqual([]);
		expect(local.upgrades).toEqual([]);
	});

	it('serves nothing through a gateway that does not take sealed-origin, and says why', async () => {
		gw.sealedOrigin = null;
		const sock = await connected();
		await until(async () => (await settings.readStatus())?.state === 'online');
		expect((await settings.readStatus())?.reason).toMatch(/does not support sealed origins/);
		const t = sock.openTls(APP_HOST);
		expect(await t.accepted).toBe(false);
		expect(t.reset).toMatchObject({ code: 'refused' });
		expect((await sock.request({ path: '/echo' })).reset).toMatchObject({ code: 'refused' });
		expect(gw.certRequests).toEqual([]);
	});

	it('takes a TLS connection only for its own names', async () => {
		const { sock } = await serving();
		for (const host of [
			`bbbbbbbbbbbbbbbbbbbb.${DOMAIN}`,
			`${LABEL}.m.example.net`,
			'example.net'
		]) {
			const t = sock.openTls(host);
			expect(await t.accepted).toBe(false);
			expect(t.reset).toMatchObject({ code: 'refused' });
		}
		expect(await sock.openTls(`p${previewPort}.${APP_HOST}`).accepted).toBe(true);
	});
});

describe('its own origin', () => {
	it('serves nothing of Wheelhouse before sign-in, over HTTP/2', async () => {
		const { b } = await serving();
		const page = await b.request(APP_HOST, '/', { headers: { 'sec-fetch-mode': 'navigate' } });
		expect(page.status).toBe(401);
		expect(page.headers['content-type']).toMatch(/^text\/plain/);
		const api = await b.request(APP_HOST, '/api/firstmate/state');
		expect(api.status).toBe(401);
		expect(JSON.parse(api.text).error).toMatch(/sign in/);
		expect(b.session(APP_HOST).alpnProtocol).toBe('h2');
		expect(local.seen).toEqual([]);
	});

	it('signs the captain in with a pinned passkey signed on its own origin, then proxies to Wheelhouse', async () => {
		const { b } = await serving();
		const s = await signIn(b);
		expect(s.status).toBe(200);
		const set = [s.headers['set-cookie'] ?? []]
			.flat()
			.find((c) => c.startsWith('__Host-whm_session='));
		expect(set).toMatch(/; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\d+/);
		b.jar.get(APP_HOST)!.set('theirs', '1');
		const r = await b.request(APP_HOST, '/echo?x=1', {
			headers: { 'x-forwarded-for': '1.2.3.4', 'x-wheelhouse-remote-user': 'forged' }
		});
		expect(r.status).toBe(200);
		const seen = JSON.parse(r.text);
		expect(seen.url).toBe('/echo?x=1');
		expect(seen.headers.host).toBe(`127.0.0.1:${appPort}`);
		expect(seen.headers.origin).toBeUndefined();
		expect(seen.headers.cookie).toBe('theirs=1');
		expect(seen.headers['x-forwarded-for']).toBeUndefined();
		expect(seen.headers['x-wheelhouse-remote']).toBe('1');
		expect(seen.headers['x-wheelhouse-remote-user']).toBe(gw.passkeys[0].id);
		expect(seen.headers['x-wheelhouse-remote-origin']).toBe(APP);
		const template = seen.headers['x-wheelhouse-remote-preview'];
		expect(template).toBe(`https://p{port}.${APP_HOST}`);
		expect(previewTemplate(template)).toBe(template);
		expect(remoteAddress('http://localhost:5173/a', { preview: template, appPort }, APP)).toBe(
			`https://p5173.${APP_HOST}/a`
		);
		// Its own cookies never come from Wheelhouse, and Wheelhouse's are host-only.
		const cookies = [r.headers['set-cookie'] ?? []].flat();
		expect(cookies).toEqual(['a=1; Path=/']);
		expect(r.headers['content-security-policy']).toBe(`frame-ancestors 'self' ${gw.origin}`);
	});

	it('refuses a signature made on the gateway’s origin, for another purpose, or by a passkey it does not trust', async () => {
		const { b } = await serving();
		const onGateway = await signIn(b, (c) => gw.passkeys[0].sign(c, gw.origin));
		expect(onGateway.status).toBe(403);
		expect(JSON.parse(onGateway.text).error).toBe('signed for another site');
		const stranger = new SoftPasskey('Not pinned');
		const untrusted = await signIn(b, (c, rpId) => stranger.sign(c, APP, { rpId }));
		expect(JSON.parse(untrusted.text).error).toMatch(/does not trust/);
		const session = Buffer.concat([Buffer.from('whc-session-v2\n'), Buffer.alloc(32)]);
		const other = await signIn(b, (_c, rpId) =>
			gw.passkeys[0].sign(session.toString('base64url'), APP, { rpId })
		);
		expect(JSON.parse(other.text).error).toBe('signed a challenge for another purpose');
		expect((await b.request(APP_HOST, '/echo')).status).toBe(401);
	});

	it('takes each sign-in challenge once', async () => {
		const { b } = await serving();
		let used = '';
		await signIn(b, (c, rpId) => {
			used = c;
			return gw.passkeys[0].sign(c, APP, { rpId });
		});
		b.jar.get(APP_HOST)!.set('__Host-whm_pre', 'stale');
		const again = await b.request(APP_HOST, '/__whm/signin', {
			method: 'POST',
			headers: { origin: APP, 'content-type': 'application/json' },
			body: JSON.stringify({ assertion: gw.passkeys[0].sign(used, APP, { rpId: 'localhost' }) })
		});
		expect(again.status).toBe(403);
		expect(JSON.parse(again.text).error).toMatch(/no live sign-in challenge/);
	});

	it('refuses a cross-origin write, and passes its own with the Origin made local', async () => {
		const { b } = await serving();
		await signIn(b);
		const post = (headers: Record<string, string>) =>
			b.request(APP_HOST, '/echo', { method: 'POST', headers, body: '{}' });
		expect((await post({ origin: gw.origin })).status).toBe(403);
		expect((await post({ origin: `https://p${previewPort}.${APP_HOST}` })).status).toBe(403);
		expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403);
		const ok = await post({ origin: APP });
		expect(ok.status).toBe(200);
		expect(JSON.parse(ok.text).headers.origin).toBe(`http://127.0.0.1:${appPort}`);
		expect(local.seen.filter((s) => s.method === 'POST')).toHaveLength(1);
	});

	it('never passes on Wheelhouse’s restart or its own paths', async () => {
		const { b } = await serving();
		await signIn(b);
		const restart = await b.request(APP_HOST, '/api/wheelhouse/%72estart', {
			method: 'POST',
			headers: { origin: APP }
		});
		expect(restart.status).toBe(403);
		expect((await b.request(APP_HOST, '/__whm/anything')).status).toBe(404);
		expect(local.seen).toEqual([]);
	});

	it('streams server-sent events as they come', async () => {
		const { b } = await serving();
		await signIn(b);
		const req = b.session(APP_HOST).request({ ':path': '/sse', cookie: b.cookies(APP_HOST) });
		const chunks: string[] = [];
		req.on('data', (c: Buffer) => chunks.push(c.toString()));
		await until(() => chunks.join('').includes('data: one'));
		expect(chunks.join('')).not.toContain('two');
		local.sse();
		await until(() => chunks.join('').includes('data: two'));
	});

	it('carries the terminal WebSocket end to end, only from its own origin', async () => {
		const { b } = await serving();
		await signIn(b);
		const open = (origin: string) =>
			new WebSocket(
				`wss://${APP_HOST}/api/firstmate/terminal?cols=80`,
				['wheelhouse.terminal.v1'],
				{
					createConnection: () => b.tls(APP_HOST, ['http/1.1']),
					headers: { origin, cookie: b.cookies(APP_HOST) }
				}
			);
		const ws = open(APP);
		await new Promise<void>((resolve, reject) => {
			ws.on('open', () => resolve());
			ws.on('error', reject);
		});
		expect(ws.protocol).toBe('wheelhouse.terminal.v1');
		const got: string[] = [];
		ws.on('message', (d) => got.push(d.toString()));
		ws.send('ls\r');
		await until(() => got.includes('ls\r'));
		const up = local.upgrades[0] as Record<string, string>;
		expect(up.host).toBe(`127.0.0.1:${appPort}`);
		expect(up.origin).toBe(`http://127.0.0.1:${appPort}`);
		expect(up.cookie).toBeUndefined();
		expect(up['x-wheelhouse-remote']).toBe('1');
		ws.close();
		const foreign = open(gw.origin);
		const status = await new Promise<number>((resolve) =>
			foreign.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
		);
		expect(status).toBe(403);
		expect(local.upgrades).toHaveLength(1);
	});

	it('opens a preview through a one-use grant the app host mints', async () => {
		const { b } = await serving();
		const host = `p${previewPort}.${APP_HOST}`;
		const nav = { 'sec-fetch-mode': 'navigate' };
		const first = await b.request(host, '/page?q=1', { headers: nav });
		expect(first.status).toBe(302);
		const toApp = new URL(String(first.headers.location));
		expect(toApp.origin).toBe(APP);
		expect(toApp.pathname).toBe('/__whm/preview');
		// Signed out, the app host mints nothing.
		expect((await b.request(APP_HOST, toApp.pathname + toApp.search)).status).toBe(403);
		await signIn(b);
		const minted = await b.request(APP_HOST, toApp.pathname + toApp.search);
		expect(minted.status).toBe(302);
		const enter = new URL(String(minted.headers.location));
		expect(enter.host).toBe(host);
		const entered = await b.request(host, enter.pathname + enter.search);
		expect(entered.status).toBe(302);
		expect(entered.headers.location).toBe('/page?q=1');
		const page = await b.request(host, '/page?q=1');
		expect(page.text).toBe(`preview localhost:${previewPort} /page?q=1`);
		expect(page.headers['content-security-policy']).toBe(`frame-ancestors 'self' ${APP}`);
		// The grant works once, and only for the host it names.
		expect((await b.request(host, enter.pathname + enter.search)).status).toBe(403);
		const other = await b.request(APP_HOST, `/__whm/preview?port=${appPort}&next=%2F`);
		expect(other.status).toBe(403);
	});

	it('carries a large upload in and a large answer out, never past the tls window', async () => {
		const { sock, b } = await serving();
		await signIn(b);
		const body = randomBytes(8 * 1024 * 1024);
		const up = await new Promise<Record<string, unknown>>((resolve, reject) => {
			const req = b.session(APP_HOST).request({
				':method': 'POST',
				':path': '/upload',
				origin: APP,
				cookie: b.cookies(APP_HOST)
			});
			const chunks: Buffer[] = [];
			req.on('data', (c: Buffer) => chunks.push(c));
			req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
			req.on('error', reject);
			req.end(body);
		});
		expect(up.bytes).toBe(body.length);
		expect(up.sha).toBe(createHash('sha256').update(body).digest('hex'));
		sock.holdCredit = true;
		const big = b.request(APP_HOST, '/big');
		await new Promise((r) => setTimeout(r, 300));
		sock.release();
		expect((await big).text.length).toBe(1024 * 1024);
		const t = sock.openTls(APP_HOST);
		await t.accepted;
		expect(t.maxOutstanding).toBeLessThanOrEqual(TLS_WINDOW);
	});

	it('ends its machine sessions when the cloud is turned off here', async () => {
		const { b } = await serving();
		await signIn(b);
		expect((await b.request(APP_HOST, '/echo')).status).toBe(200);
		await settings.update((s) => (s.enabled = false));
		await until(() => service!.state === 'idle');
		await settings.update((s) => (s.enabled = true));
		const sock = await gw.nextSocket();
		await until(() => sock.closedWith === null && service!.state === 'online');
		const again = new Browser(sock);
		again.jar.set(APP_HOST, new Map(b.jar.get(APP_HOST)));
		expect((await again.request(APP_HOST, '/echo')).status).toBe(401);
		again.close();
	});
});
