/* eslint-disable @typescript-eslint/no-explicit-any -- the review server is plain JavaScript, loaded by path */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pluginBatchText } from '../../previewhelper';
import { readFeedback } from './feedback';

/**
 * Shared review's server side (plugins/shared-review/review/): the review
 * server reviewers sign in to, the tunnel live apps come through, the bundle
 * a closed review goes back as, and the desk that runs on the captain's
 * computer. Each runs in this process on loopback, with its data in a
 * temporary folder; nothing reaches the network.
 */

const REVIEW = path.resolve('plugins/shared-review/review');
const load = (f: string) => import(pathToFileURL(path.join(REVIEW, f)).href) as Promise<any>;
const OWNER = 'owner-token-for-tests-0123456789abcdef';

let S: any;
let C: any;
let T: any;
let D: any;
let M: any;
let Client: any;
let root: string;
const stops: (() => Promise<void>)[] = [];

beforeAll(async () => {
	[S, C, T, D, M] = await Promise.all([
		load('server.mjs'),
		load('comments.mjs'),
		load('tunnel.mjs'),
		load('desk.mjs'),
		load('mail.mjs')
	]);
	Client = (await load('client.mjs')).OwnerClient;
	root = mkdtempSync(path.join(tmpdir(), 'wh-shared-review-'));
});

afterAll(async () => {
	for (const stop of stops.reverse()) await stop();
	rmSync(root, { recursive: true, force: true });
});

/** An HTTP server on loopback, port 0; `handler` can be set once its address is known. */
async function listen(): Promise<{ url: string; set(h: http.RequestListener): void }> {
	let handler: http.RequestListener = (_q, s) => s.end();
	const srv = http.createServer((q, s) => handler(q, s));
	await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
	stops.push(
		() =>
			new Promise((r) => {
				srv.closeAllConnections();
				srv.close(() => r());
			})
	);
	return {
		url: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`,
		set: (h) => (handler = h)
	};
}

/** A review server in this process, with its data in a folder of its own. */
async function reviewServer(o: Record<string, unknown> = {}) {
	const l = await listen();
	const dataDir = mkdtempSync(path.join(root, 'data-'));
	const logs: string[] = [];
	const rs = new S.ReviewServer({
		dataDir,
		publicUrl: l.url,
		ownerToken: OWNER,
		log: (s: string) => logs.push(s),
		...o
	});
	l.set(rs.handle);
	return { url: l.url, rs, dataDir, logs, owner: new Client(l.url, OWNER) };
}

/** A reviewer's browser: keeps its cookies, follows no redirects. */
class Browser {
	jar = new Map<string, string>();
	setCookies: string[] = [];
	constructor(
		public base: string,
		public origin = base
	) {}
	async go(p: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
		const r = await fetch(new URL(p, this.base), { ...init, headers, redirect: 'manual' });
		for (const c of r.headers.getSetCookie()) {
			this.setCookies.push(c);
			const kv = c.split(';')[0];
			const i = kv.indexOf('=');
			if (/Max-Age=0\b/i.test(c)) this.jar.delete(kv.slice(0, i));
			else this.jar.set(kv.slice(0, i), kv.slice(i + 1));
		}
		return r;
	}
	form(p: string, data: Record<string, string>) {
		return this.go(p, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', origin: this.origin },
			body: new URLSearchParams(data).toString()
		});
	}
	json(p: string, body: unknown) {
		return this.go(p, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: this.origin },
			body: JSON.stringify(body)
		});
	}
}

/** A static review with one page, opened. */
async function staticReview(
	s: Awaited<ReturnType<typeof reviewServer>>,
	body: Record<string, unknown> = {}
) {
	const made = await s.owner.create({
		title: 'Checkout',
		task: 'demo-1',
		source: { kind: 'static' },
		...body
	});
	const rid = made.review.rid;
	await s.owner.putFile(
		rid,
		'index.html',
		Buffer.from('<h1>Checkout</h1><button id="pay">Pay now</button>')
	);
	await s.owner.putFile(rid, 'assets/app.css', Buffer.from('h1{color:red}'));
	await s.owner.open(rid);
	return { rid, passcode: made.passcode as string, link: made.link as string };
}

async function signedIn(s: { url: string }, r: { rid: string; passcode: string }, name: string) {
	const b = new Browser(s.url);
	const res = await b.form(`/_review/${r.rid}/signin`, {
		method: 'passcode',
		name,
		passcode: r.passcode
	});
	expect(res.status).toBe(303);
	return b;
}

const anchor = (label: string, o: Record<string, unknown> = {}) => ({
	path: '/',
	selector: '#pay',
	at: { x: 0.25, y: 0.5 },
	doc: { x: 120, y: 340 },
	viewport: { w: 1280, h: 800 },
	label,
	text: 'Pay now',
	...o
});

describe('signing in to a review', () => {
	it('asks for sign-in, and lets in only a named reviewer with the right passcode', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		expect(r.link).toBe(`${s.url}/_review/${r.rid}`);
		expect(r.rid).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const b = new Browser(s.url);
		const page = await b.go(`/_review/${r.rid}`);
		expect(page.status).toBe(200);
		expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
		expect(await page.text()).toContain('name="passcode"');
		expect((await b.go('/')).status).toBe(404);

		const wrong = await b.form(`/_review/${r.rid}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: 'abcd-efgh-jkmn'
		});
		expect(wrong.status).toBe(401);
		expect(await wrong.text()).toContain('That passcode is not right');
		expect(b.jar.size).toBe(0);

		// Passcodes are read without case, spaces or dashes.
		const typed = ` ${r.passcode.replace(/-/g, ' ').toUpperCase()} `;
		const ok = await b.form(`/_review/${r.rid}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: typed
		});
		expect(ok.status).toBe(303);
		const session = b.setCookies.find((c) => c.startsWith(`wr_s_${r.rid}=`))!;
		expect(session).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
		expect(session).not.toContain('Secure');

		const shell = await b.go(`/_review/${r.rid}`);
		expect(await shell.text()).toContain('data-name="Ana"');
		const proto = await b.go('/');
		expect(proto.status).toBe(200);
		expect(await proto.text()).toContain('Pay now');
		expect(proto.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
		expect(proto.headers.get('cache-control')).toBe('no-store');
		expect((await b.go('/assets/app.css')).headers.get('content-type')).toBe(
			'text/css; charset=utf-8'
		);
		expect(s.logs.join('\n')).not.toContain(r.passcode);
	});

	it('marks sessions Secure over https, and lets no forged or borrowed session in', async () => {
		const s = await reviewServer({ publicUrl: 'https://review.example.com' });
		const a = await staticReview(s);
		const b2 = await staticReview(s);
		const b = new Browser(s.url, 'https://review.example.com');
		await b.form(`/_review/${a.rid}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: a.passcode
		});
		expect(b.setCookies.find((c) => c.startsWith('wr_s_'))).toContain('; Secure');
		expect(a.link).toBe(`https://review.example.com/_review/${a.rid}`);

		const [sid] = b.jar.get(`wr_s_${a.rid}`)!.split('.');
		const forged = new Browser(s.url);
		forged.jar.set(`wr_s_${a.rid}`, `${sid}.forged-signature`);
		forged.jar.set('wr_cur', a.rid);
		expect(await (await forged.go(`/_review/${a.rid}`)).text()).toContain('name="passcode"');
		expect((await forged.go('/')).status).toBe(404);

		// Review A's session, presented for review B.
		const borrowed = new Browser(s.url);
		borrowed.jar.set(`wr_s_${b2.rid}`, b.jar.get(`wr_s_${a.rid}`)!);
		borrowed.jar.set('wr_cur', b2.rid);
		expect(await (await borrowed.go(`/_review/${b2.rid}`)).text()).toContain('name="passcode"');
		expect((await borrowed.go('/')).status).toBe(404);
	});

	it('limits passcode guesses, so even the right one waits after five wrong', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const b = new Browser(s.url);
		for (let i = 0; i < 5; i++) {
			expect(
				(
					await b.form(`/_review/${r.rid}/signin`, {
						method: 'passcode',
						name: 'Eve',
						passcode: `wrong-guess-${i}`
					})
				).status
			).toBe(401);
		}
		const held = await b.form(`/_review/${r.rid}/signin`, {
			method: 'passcode',
			name: 'Eve',
			passcode: r.passcode
		});
		expect(held.status).toBe(429);
		expect(b.jar.size).toBe(0);
	});

	it('counts guesses sent all at once before checking any', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const tries = await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				new Browser(s.url).form(`/_review/${r.rid}/signin`, {
					method: 'passcode',
					name: 'Eve',
					passcode: `burst-guess-${i}`
				})
			)
		);
		const codes = tries.map((t) => t.status).sort();
		expect(codes.filter((c) => c === 401)).toHaveLength(5);
		expect(codes.filter((c) => c === 429)).toHaveLength(7);
	});

	it('opens a review only at a path of its own site', async () => {
		const s = await reviewServer();
		for (const start of ['//evil.example/x', '/\\evil.example', 'https://evil.example/']) {
			const made = await s.owner.create({ title: 'X', source: { kind: 'live', start } });
			expect(made.review.source.start).toBe('/');
		}
		const ok = await s.owner.create({
			title: 'X',
			source: { kind: 'live', start: '/checkout?step=2' }
		});
		expect(ok.review.source.start).toBe('/checkout?step=2');
	});

	it('keeps passcodes only as salted hashes', async () => {
		const s = await reviewServer();
		const r = await staticReview(s, { passcode: 'Harbour Lights 42' });
		expect(r.passcode).toBe('Harbour Lights 42');
		const state = readFileSync(path.join(s.dataDir, 'state.json'), 'utf8');
		expect(state).not.toContain('Harbour');
		expect(state).not.toContain('harbourlights42');
		await signedIn(s, { rid: r.rid, passcode: 'harbour-lights-42' }, 'Ben');
	});

	it('emails a single-use, short-lived link to invited people only, and never logs it', async () => {
		let now = Date.parse('2026-11-09T10:00:00Z');
		const outbox = mkdtempSync(path.join(root, 'outbox-'));
		const s = await reviewServer({
			mailer: M.outboxSender(outbox),
			emailFrom: 'Reviews <reviews@example.com>',
			now: () => now
		});
		const made = await s.owner.create({
			title: 'Pricing page',
			source: { kind: 'live' },
			signIn: ['email'],
			invitees: ['ana@example.com', '@example.org']
		});
		expect(made.passcode).toBeNull();
		const rid = made.review.rid;
		const b = new Browser(s.url);
		const page = await b.go(`/_review/${rid}`);
		const html = await page.text();
		expect(html).toContain('name="email"');
		expect(html).not.toContain('name="passcode"');

		const stranger = await b.form(`/_review/${rid}/signin`, {
			method: 'email',
			name: 'Mallory',
			email: 'mallory@example.net'
		});
		const asked = await b.form(`/_review/${rid}/signin`, {
			method: 'email',
			name: 'Ana',
			email: 'Ana@Example.com'
		});
		// The same answer either way: no one learns who is invited.
		const same = (t: string, name: string, email: string) =>
			t.replaceAll(email, 'X').replaceAll(name, 'N');
		expect(stranger.status).toBe(asked.status);
		expect(same(await stranger.text(), 'Mallory', 'mallory@example.net')).toBe(
			same(await asked.text(), 'Ana', 'ana@example.com')
		);
		const sent = readdirSync(outbox);
		expect(sent).toHaveLength(1);
		const raw = readFileSync(path.join(outbox, sent[0]), 'utf8');
		expect(statSync(path.join(outbox, sent[0])).mode & 0o077).toBe(0);
		expect(raw).toContain('X-Outbox-To: ana@example.com');
		expect(raw).toContain('From: Reviews <reviews@example.com>');
		const body = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString(
			'utf8'
		);
		const token = /\/_review\/[^/]+\/magic#t=([A-Za-z0-9_-]+)/.exec(body)![1];
		expect(s.logs.join('\n')).not.toContain(token);

		const landing = await b.go(`/_review/${rid}/magic`);
		expect(await landing.text()).toContain('/_review/assets/magic.js');
		const used = await b.form(`/_review/${rid}/magic`, { token });
		expect(used.status).toBe(303);
		expect(await (await b.go(`/_review/${rid}`)).text()).toContain('data-name="Ana"');
		const again = await new Browser(s.url).form(`/_review/${rid}/magic`, { token });
		expect(again.status).toBe(400);
		expect(await again.text()).toContain('expired or was used already');

		// A domain invite works, and a link older than 15 minutes does not.
		await b.form(`/_review/${rid}/signin`, {
			method: 'email',
			name: 'Cy',
			email: 'cy@example.org'
		});
		const late = readdirSync(outbox).find((f) => f !== sent[0])!;
		const lateBody = Buffer.from(
			readFileSync(path.join(outbox, late), 'utf8').split('\r\n\r\n')[1].replace(/\s+/g, ''),
			'base64'
		).toString('utf8');
		const lateToken = /#t=([A-Za-z0-9_-]+)/.exec(lateBody)![1];
		now += 16 * 60_000;
		expect(
			(await new Browser(s.url).form(`/_review/${rid}/magic`, { token: lateToken })).status
		).toBe(400);
	});

	it('refuses email sign-in on a server that cannot send email', async () => {
		const s = await reviewServer();
		await expect(
			s.owner.create({
				title: 'X',
				source: { kind: 'live' },
				signIn: ['email'],
				invitees: ['a@example.com']
			})
		).rejects.toThrow(/cannot send email/);
	});

	it('answers the owner API only with the owner token', async () => {
		const s = await reviewServer();
		await expect(new Client(s.url, 'not-the-token').list()).rejects.toThrow(/owner token/);
		const r = await fetch(`${s.url}/_review/api/reviews`);
		expect(r.status).toBe(401);
		expect((await s.owner.info()).signIn).toEqual(['passcode']);
	});
});

describe('comments', () => {
	it('are anchored where the reviewer clicked, carry their name, and stay text', async () => {
		const s = await reviewServer();
		const r = await staticReview(s, { title: '<img src=x onerror=alert(1)>' });
		const ana = await signedIn(s, r, 'Ana <b>');
		const shell = await (await ana.go(`/_review/${r.rid}`)).text();
		expect(shell).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(shell).toContain('data-name="Ana &lt;b&gt;"');
		expect(shell).not.toContain('<img src=x');

		const posted = await ana.json(`/_review/${r.rid}/api/comments`, {
			body: 'Make <script>this</script> bigger',
			anchor: anchor('the “Pay now” button', {
				selector: 'x'.repeat(900),
				at: { x: 2, y: 0.5 },
				extra: 'dropped'
			})
		});
		expect(posted.status).toBe(201);
		const c = (await posted.json()).comment;
		expect(c).toMatchObject({
			author: 'Ana <b>',
			body: 'Make <script>this</script> bigger',
			parent: null
		});
		expect(c.anchor).toEqual({
			path: '/',
			selector: `${'x'.repeat(599)}…`,
			at: null,
			doc: { x: 120, y: 340 },
			viewport: { w: 1280, h: 800 },
			label: 'the “Pay now” button',
			text: 'Pay now'
		});

		const ben = await signedIn(s, r, 'Ben');
		const reply = await (
			await ben.json(`/_review/${r.rid}/api/comments`, {
				body: 'Agreed',
				parent: c.id,
				anchor: anchor('elsewhere', { path: '/other' })
			})
		).json();
		expect(reply.comment).toMatchObject({ author: 'Ben', parent: c.id, anchor: c.anchor });

		const list = await (await ben.go(`/_review/${r.rid}/api/comments`)).json();
		expect(list.comments.map((x: any) => x.author)).toEqual(['Ana <b>', 'Ben']);
		expect(JSON.stringify(list)).not.toContain('email');

		expect((await ben.json(`/_review/${r.rid}/api/comments`, { body: '   ' })).status).toBe(400);
		expect(
			(await ben.json(`/_review/${r.rid}/api/comments`, { body: 'x'.repeat(2001) })).status
		).toBe(400);
		const other = new Browser(s.url, 'https://elsewhere.example');
		other.jar = ben.jar;
		expect(
			(await other.json(`/_review/${r.rid}/api/comments`, { body: 'from another site' })).status
		).toBe(403);
		expect(
			(await new Browser(s.url).json(`/_review/${r.rid}/api/comments`, { body: 'no session' }))
				.status
		).toBe(401);
	});
});

describe('closing a review', () => {
	it('takes the link and prototype down, ends every session, and keeps the comments as the bundle', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s, r, 'Ana');
		const ben = await signedIn(s, r, 'Ben');
		const first = (
			await (
				await ana.json(`/_review/${r.rid}/api/comments`, {
					body: 'Bigger button',
					anchor: anchor('the “Pay now” button')
				})
			).json()
		).comment;
		await ben.json(`/_review/${r.rid}/api/comments`, { body: 'And green', parent: first.id });
		await ben.json(`/_review/${r.rid}/api/comments`, {
			body: 'Typo in the title',
			anchor: anchor('the “Checkout” heading', { path: '/cart?step=2', selector: 'h1' })
		});
		expect(existsSync(path.join(s.dataDir, 'sites', r.rid, 'index.html'))).toBe(true);

		const closed = await s.owner.close(r.rid);
		expect(closed.review.state).toBe('closed');
		expect(closed.bundle).toMatchObject({
			schema: 'shared-review-bundle.v1',
			review: {
				id: r.rid,
				title: 'Checkout',
				task: 'demo-1',
				link: r.link,
				closedAt: expect.any(String)
			},
			people: [
				{ name: 'Ana', email: null, comments: 1 },
				{ name: 'Ben', email: null, comments: 2 }
			]
		});
		expect(closed.bundle.comments).toEqual([
			expect.objectContaining({
				n: 1,
				author: 'Ana',
				body: 'Bigger button',
				page: '/',
				anchor: expect.objectContaining({
					selector: '#pay',
					label: 'the “Pay now” button',
					at: { x: 0.25, y: 0.5 }
				}),
				replies: [expect.objectContaining({ author: 'Ben', body: 'And green' })]
			}),
			expect.objectContaining({ n: 2, author: 'Ben', page: '/cart?step=2', replies: [] })
		]);

		const page = await ana.go(`/_review/${r.rid}`);
		expect(page.status).toBe(404);
		expect(await page.text()).toContain('This review is closed');
		expect((await ana.go('/')).status).toBe(404);
		expect((await ben.go(`/_review/${r.rid}/api/comments`)).status).toBe(401);
		expect(existsSync(path.join(s.dataDir, 'sites', r.rid))).toBe(false);
		const state = JSON.parse(readFileSync(path.join(s.dataDir, 'state.json'), 'utf8'));
		expect(Object.values(state.sessions).filter((x: any) => x.rid === r.rid)).toEqual([]);
		expect((await s.owner.get(r.rid)).comments).toHaveLength(3);

		await s.owner.purge(r.rid);
		await expect(s.owner.get(r.rid)).rejects.toThrow(/No such review/);
	});
});

describe('live apps', () => {
	it('reach signed-in reviewers through the tunnel, without the review’s own cookies', async () => {
		const seen: { url?: string; cookie?: string; origin?: string }[] = [];
		const up = await listen();
		up.set((q, res) => {
			seen.push({
				url: q.url,
				cookie: q.headers.cookie,
				origin: q.headers.origin as string | undefined
			});
			if (q.url === '/go') {
				res.writeHead(302, { location: `${up.url}/there` });
				return res.end();
			}
			res.writeHead(200, {
				'content-type': 'text/html',
				'x-frame-options': 'DENY',
				'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
				'set-cookie': ['app=1; Path=/; Domain=localhost', 'wr_cur=stolen; Path=/']
			});
			res.end(`<h1>Live ${q.url}</h1>`);
		});
		const s = await reviewServer();
		const made = await s.owner.create({ title: 'Live', source: { kind: 'live' } });
		const rid = made.review.rid;
		const b = await signedIn(s, { rid, passcode: made.passcode }, 'Ana');
		await b.go(`/_review/${rid}`);

		expect((await b.go('/before')).status).toBe(502);
		const states: string[] = [];
		const c = new T.Connector({
			server: s.url,
			token: OWNER,
			rid,
			upstream: up.url,
			lanes: 2,
			onState: (x: string) => states.push(x)
		}).start();
		stops.push(async () => c.stop());

		b.jar.set('theirs', 'kept');
		const res = await b.go('/page?x=1', { headers: { origin: s.url } });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('<h1>Live /page?x=1</h1>');
		expect(res.headers.get('x-frame-options')).toBeNull();
		expect(res.headers.get('content-security-policy')).toBe(
			"default-src 'self'; frame-ancestors 'self'"
		);
		expect(res.headers.getSetCookie()).toEqual(['app=1; Path=/']);
		const last = seen[seen.length - 1];
		expect(last.url).toBe('/page?x=1');
		expect(last.cookie).toBe('theirs=kept');
		expect(last.origin).toBe(up.url);
		const moved = await b.go('/go');
		expect(moved.headers.get('location')).toBe('/there');

		const before = seen.length;
		expect((await new Browser(s.url).go('/page')).status).toBe(404);
		expect(seen.length).toBe(before);

		await s.owner.close(rid);
		expect((await b.go('/page')).status).toBe(404);
		await new Promise((r) => setTimeout(r, 300));
		expect(states).toContain('gone');
		expect(c.stopped).toBe(true);
	});
});

describe('the bundle as Wheelhouse’s feedback list', () => {
	const thread = (i: number, body: string) => ({
		n: i + 1,
		id: `c${i}`,
		author: i % 2 ? 'Ben' : 'Ana',
		email: null,
		at: '2026-11-09T10:00:00Z',
		body,
		page: '/checkout',
		anchor: {
			path: '/checkout',
			selector: '#pay',
			at: { x: 0.62, y: 0.4 },
			doc: null,
			viewport: null,
			label: 'the “Pay now” button',
			text: null
		},
		replies:
			i === 0
				? [{ id: 'r0', author: 'Cy', email: null, at: '2026-11-09T10:01:00Z', body: 'Agreed' }]
				: []
	});
	const b = (threads: any[]) => ({
		schema: 'shared-review-bundle.v1',
		review: { id: 'sr-1', title: 'Checkout', task: 'demo-1' },
		people: [{ name: 'Ana' }, { name: 'Ben' }, { name: 'Cy' }],
		comments: threads
	});

	it('gives one line per thread, replies folded in, with where it points', () => {
		const list = C.feedbackList(b([thread(0, 'Make the button bigger'), thread(1, 'Wrong total')]));
		expect(list.subject).toBe('the shared review “Checkout” (3 comments from Ana, Ben and Cy)');
		expect(list.items).toEqual([
			{
				text: 'Ana: Make the button bigger — Cy replied: Agreed',
				points: 'the “Pay now” button on /checkout (62% across, 40% down it)'
			},
			{
				text: 'Ben: Wrong total',
				points: 'the “Pay now” button on /checkout (62% across, 40% down it)'
			}
		]);
		expect(list.ids).toEqual(['c0', 'r0', 'c1']);
		expect(list.threads).toEqual(['c0', 'c1']);
	});

	it('stays within the list’s limits, and names the full bundle for what does not fit', () => {
		const long = 'Le bouton « Payer » doit être plus grand — 結帳按鈕太小了。'.repeat(20);
		const list = C.feedbackList(b(Array.from({ length: 45 }, (_, i) => thread(i, long))), {
			file: '/state/bundles/sr-1.json'
		});
		expect(list.items).toHaveLength(30);
		expect(list.items[29].text).toMatch(
			/^16 more threads did not fit in this list\. The full bundle .*: \/state\/bundles\/sr-1\.json$/
		);
		expect(list.ids).toHaveLength(46);
		// Exactly what Wheelhouse's feedback route checks, and the note it writes, within Firstmate's 16 KiB.
		expect(
			readFeedback({ taskId: 'demo-1', subject: list.subject, items: list.items })
		).toMatchObject({ ok: true });
		const note = pluginBatchText(
			{ id: 'demo-1', title: 'Checkout' },
			{ id: 'shared-review', name: 'Shared review' },
			list.subject,
			list.items
		);
		expect(Buffer.byteLength(note)).toBeLessThanOrEqual(16 * 1024);
	});
});

describe('the review desk', () => {
	it('starts local previews, moves them live with their comments, and closes them for Firstmate', async () => {
		const remote = await reviewServer();
		const dir = mkdtempSync(path.join(root, 'desk-'));
		const desk = await new D.Desk({
			dir,
			port: 0,
			remote: { url: remote.url, token: OWNER, tokenName: 'SHARED_REVIEW_OWNER_TOKEN' },
			log: () => {}
		}).start();
		stops.push(() => desk.stop());
		const record = JSON.parse(readFileSync(path.join(dir, 'desk.json'), 'utf8'));
		expect(record).toMatchObject({ url: desk.url, key: expect.any(String), pid: process.pid });
		expect(statSync(path.join(dir, 'desk.json')).mode & 0o077).toBe(0);
		const call = async (method: string, p: string, body?: unknown, key = record.key) => {
			const r = await fetch(`${desk.url}/_review/desk/${p}`, {
				method,
				headers: {
					'x-review-desk-key': key,
					...(body ? { 'content-type': 'application/json' } : {})
				},
				body: body ? JSON.stringify(body) : undefined
			});
			return { status: r.status, body: await r.json() };
		};
		expect((await call('GET', 'state', undefined, 'wrong')).status).toBe(401);
		const health = await (await fetch(`${desk.url}/_review/health`)).json();
		expect(health.service).toBe('wheelhouse-shared-review-desk');

		const site = path.join(root, 'site');
		mkdirSync(path.join(site, 'node_modules', 'x'), { recursive: true });
		mkdirSync(path.join(site, '.git'), { recursive: true });
		writeFileSync(path.join(site, 'index.html'), '<button id="pay">Pay now</button>');
		writeFileSync(path.join(site, '.env'), 'SECRET=1');
		writeFileSync(path.join(site, '.git', 'config'), '[core]');
		writeFileSync(path.join(site, 'node_modules', 'x', 'index.js'), '');
		expect(D.siteFiles(site)).toEqual(['index.html']);

		expect(
			(
				await call('POST', 'reviews', {
					task: 'demo-1',
					source: { kind: 'live', url: 'http://10.0.0.5:5173' }
				})
			).status
		).toBe(400);
		expect(
			(
				await call('POST', 'reviews', {
					task: 'demo-1',
					source: { kind: 'static', root: site, dir: '../elsewhere' }
				})
			).status
		).toBe(400);

		const started = await call('POST', 'reviews', {
			task: 'demo-1',
			title: 'Checkout',
			source: { kind: 'static', root: site, dir: '.' },
			signIn: ['passcode']
		});
		expect(started.status).toBe(201);
		const local = started.body.review;
		expect(local).toMatchObject({
			where: 'local',
			state: 'open',
			task: 'demo-1',
			passcode: expect.any(String)
		});
		expect(local.link.startsWith(`${desk.url}/_review/`)).toBe(true);

		const ana = new Browser(desk.url);
		await ana.form(`${new URL(local.link).pathname}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: local.passcode
		});
		const rid = new URL(local.link).pathname.split('/')[2];
		const c1 = (
			await (
				await ana.json(`/_review/${rid}/api/comments`, {
					body: 'Bigger',
					anchor: anchor('the “Pay now” button')
				})
			).json()
		).comment;

		const state = (await call('GET', 'state?task=demo-1')).body;
		expect(state.remote).toMatchObject({ url: remote.url, state: 'ready', signIn: ['passcode'] });
		expect(state.reviews[0].feedback.items).toEqual([
			{ text: 'Ana: Bigger', points: 'the “Pay now” button on / (25% across, 50% down it)' }
		]);

		const live = (await call('POST', `reviews/${local.id}/live`, {})).body.review;
		expect(live).toMatchObject({ where: 'remote', server: remote.url, state: 'open' });
		expect(live.link.startsWith(`${remote.url}/_review/`)).toBe(true);
		expect(live.passcode).not.toBe(local.passcode);
		expect((await ana.go(`/_review/${rid}`)).status).toBe(404);
		const remoteRid = new URL(live.link).pathname.split('/')[2];
		expect((await remote.owner.get(remoteRid)).comments).toEqual([
			expect.objectContaining({ id: c1.id, author: 'Ana', body: 'Bigger' })
		]);
		expect(readdirSync(path.join(remote.dataDir, 'sites', remoteRid))).toEqual(['index.html']);

		const ben = await signedIn(remote, { rid: remoteRid, passcode: live.passcode }, 'Ben');
		const c2 = (
			await (
				await ben.json(`/_review/${remoteRid}/api/comments`, {
					body: 'Late thought',
					anchor: anchor('a spot')
				})
			).json()
		).comment;

		const closed = await call('POST', `reviews/${local.id}/close`, { sent: [c1.id] });
		expect(closed.status).toBe(200);
		expect(closed.body.review.state).toBe('closed');
		expect(closed.body.review.link).toBeNull();
		expect(closed.body.late.items).toEqual([
			expect.objectContaining({ text: 'Ben: Late thought' })
		]);
		expect(closed.body.late.ids).toEqual([c2.id]);
		const file = path.join(dir, 'bundles', `${local.id}.json`);
		expect(statSync(file).mode & 0o077).toBe(0);
		expect(JSON.parse(readFileSync(file, 'utf8')).comments).toHaveLength(2);
		expect((await ben.go(`/_review/${remoteRid}`)).status).toBe(404);

		// Seen again later (the page re-mounted), the closed review offers only the comment Firstmate lacks.
		const reread = (await call('GET', 'state?task=demo-1')).body.reviews[0];
		expect(reread).toMatchObject({ state: 'closed', sent: true });
		expect(reread.feedback.ids).toEqual([c2.id]);
		expect(reread.feedback.items).toEqual([expect.objectContaining({ text: 'Ben: Late thought' })]);

		const delivered = await call('POST', `reviews/${local.id}/delivered`, { sent: [c2.id] });
		expect(delivered.body.review).toMatchObject({ state: 'delivered', sent: true, feedback: null });
		await expect(remote.owner.get(remoteRid)).rejects.toThrow(/No such review/);
		expect((await call('GET', `reviews/${local.id}/bundle`)).body.comments).toHaveLength(2);
	});

	it('keeps what reached Firstmate when the link cannot be taken down, so a retry sends only the rest', async () => {
		const remote = await reviewServer();
		let down = false;
		const desk = await new D.Desk({
			dir: mkdtempSync(path.join(root, 'desk-')),
			port: 0,
			remote: { url: remote.url, token: OWNER, tokenName: 'SHARED_REVIEW_OWNER_TOKEN' },
			fetchImpl: (url: string, init?: RequestInit) =>
				down && url.startsWith(remote.url) && url.endsWith('/close')
					? Promise.reject(new TypeError('fetch failed'))
					: fetch(url, init),
			log: () => {}
		}).start();
		stops.push(() => desk.stop());
		const call = async (method: string, p: string, body?: unknown) => {
			const r = await fetch(`${desk.url}/_review/desk/${p}`, {
				method,
				headers: {
					'x-review-desk-key': desk.key,
					...(body ? { 'content-type': 'application/json' } : {})
				},
				body: body ? JSON.stringify(body) : undefined
			});
			return { status: r.status, body: await r.json() };
		};
		const site = path.join(root, 'retry-site');
		mkdirSync(site, { recursive: true });
		writeFileSync(path.join(site, 'index.html'), '<button id="pay">Pay now</button>');
		const started = (
			await call('POST', 'reviews', {
				task: 'demo-1',
				title: 'Checkout',
				source: { kind: 'static', root: site, dir: '.' }
			})
		).body.review;
		const live = (await call('POST', `reviews/${started.id}/live`, {})).body.review;
		const rid = new URL(live.link).pathname.split('/')[2];
		const say = async (who: string, body: string) => {
			const b = await signedIn(remote, { rid, passcode: live.passcode }, who);
			return (
				await (
					await b.json(`/_review/${rid}/api/comments`, { body, anchor: anchor('a spot') })
				).json()
			).comment;
		};
		const c1 = await say('Ana', 'Bigger');

		down = true;
		const failed = await call('POST', `reviews/${started.id}/close`, { sent: [c1.id] });
		expect(failed.status).toBeGreaterThanOrEqual(500);
		const c2 = await say('Ben', 'Later');
		const open = (await call('GET', 'state')).body.reviews[0];
		expect(open).toMatchObject({ state: 'open', sent: true });
		expect(open.feedback.ids).toEqual([c2.id]);

		down = false;
		const closed = (await call('POST', `reviews/${started.id}/close`, { sent: [c2.id] })).body;
		expect(closed.review.state).toBe('closed');
		expect(closed.late).toBeNull();
		expect(closed.bundle.comments.map((c: { id: string }) => c.id)).toEqual([c1.id, c2.id]);
		const done = (await call('POST', `reviews/${started.id}/delivered`, {})).body.review;
		expect(done).toMatchObject({ state: 'delivered', sent: true });
		await expect(remote.owner.get(rid)).rejects.toThrow(/No such review/);
	});

	describe('sending only the threads the captain ticks', () => {
		/** A local preview with three threads: Ana's (with Ben's reply), Ben's and Cy's. */
		async function threeThreads() {
			const desk = await new D.Desk({
				dir: mkdtempSync(path.join(root, 'desk-')),
				port: 0,
				log: () => {}
			}).start();
			stops.push(() => desk.stop());
			const call = async (method: string, p: string, body?: unknown) => {
				const r = await fetch(`${desk.url}/_review/desk/${p}`, {
					method,
					headers: {
						'x-review-desk-key': desk.key,
						...(body ? { 'content-type': 'application/json' } : {})
					},
					body: body ? JSON.stringify(body) : undefined
				});
				return { status: r.status, body: await r.json() };
			};
			const site = mkdtempSync(path.join(root, 'pick-site-'));
			writeFileSync(path.join(site, 'index.html'), '<button id="pay">Pay now</button>');
			const rv = (
				await call('POST', 'reviews', {
					task: 'demo-1',
					title: 'Checkout',
					source: { kind: 'static', root: site, dir: '.' }
				})
			).body.review;
			const rid = new URL(rv.link).pathname.split('/')[2];
			const say = async (who: string, body: string, parent?: string) => {
				const b = await signedIn({ url: desk.url }, { rid, passcode: rv.passcode }, who);
				return (
					await (
						await b.json(`/_review/${rid}/api/comments`, {
							body,
							parent,
							anchor: anchor(`${who}’s spot`)
						})
					).json()
				).comment.id as string;
			};
			const t1 = await say('Ana', 'Bigger button\nand bolder');
			const r1 = await say('Ben', 'Agreed', t1);
			const t2 = await say('Ben', 'Hide the promo box');
			const t3 = await say('Cy', 'Wrong total');
			return { desk, call, id: rv.id as string, t1, r1, t2, t3 };
		}
		const marks = (b: { comments: any[] }) =>
			b.comments.map((t) => [t.id, t.sent, ...t.replies.map((r: any) => [r.id, r.sent])]);

		it('offers every thread to choose from, with who wrote it, where and its first line', async () => {
			const { call, t1, t2, t3 } = await threeThreads();
			const rv = (await call('GET', 'state')).body.reviews[0];
			expect(rv.threads.map((t: any) => [t.id, t.author, t.first, t.replies, t.unsent])).toEqual([
				[t1, 'Ana', 'Bigger button', 1, 2],
				[t2, 'Ben', 'Hide the promo box', 0, 1],
				[t3, 'Cy', 'Wrong total', 0, 1]
			]);
			expect(rv.threads[0].anchor).toEqual({ path: '/', label: 'Ana’s spot' });
		});

		it('sends some: the note has only the ticked threads, the bundle keeps the rest marked unsent', async () => {
			const { call, id, t1, r1, t2, t3 } = await threeThreads();
			const picked = (await call('POST', `reviews/${id}/feedback`, { threads: [t1, t3] })).body
				.feedback;
			expect(picked.subject).toBe('the shared review “Checkout” (3 comments from Ana, Ben and Cy)');
			expect(picked.items.map((i: { text: string }) => i.text)).toEqual([
				'Ana: Bigger button and bolder — Ben replied: Agreed',
				'Cy: Wrong total'
			]);
			expect(picked.ids).toEqual([t1, r1, t3]);

			const closed = (await call('POST', `reviews/${id}/close`, { sent: picked.ids, held: [t2] }))
				.body;
			// The held thread is not offered again as having come in late.
			expect(closed.late).toBeNull();
			expect(marks(closed.bundle)).toEqual([
				[t1, true, [r1, true]],
				[t2, false],
				[t3, true]
			]);
			const after = (await call('GET', 'state')).body.reviews[0];
			expect(after).toMatchObject({ state: 'closed', sent: true, feedback: null, held: [t2] });
			const done = (await call('POST', `reviews/${id}/delivered`, {})).body.review;
			expect(done.state).toBe('delivered');
			expect(marks((await call('GET', `reviews/${id}/bundle`)).body)).toEqual([
				[t1, true, [r1, true]],
				[t2, false],
				[t3, true]
			]);
		});

		it('sends the helper’s points: the bundle keeps them beside every comment as it was', async () => {
			const { call, id, t1, r1, t2, t3 } = await threeThreads();
			const all = (await call('GET', 'state')).body.reviews[0].feedback;
			expect(all.threads).toEqual([t1, t2, t3]);
			const points = [
				{ text: 'Make the button bigger and bolder', points: 'Ana’s spot', threads: [t1] },
				{ text: 'Fix the total', points: null, threads: [t3] },
				{ text: ' ', points: null, threads: [] },
				'not a point'
			];
			const closed = (
				await call('POST', `reviews/${id}/close`, { sent: [t1, r1, t3], held: [t2], points })
			).body;
			expect(closed.late).toBeNull();
			expect(marks(closed.bundle)).toEqual([
				[t1, true, [r1, true]],
				[t2, false],
				[t3, true]
			]);
			expect(closed.bundle.comments.map((t: any) => t.body)).toEqual([
				'Bigger button\nand bolder',
				'Hide the promo box',
				'Wrong total'
			]);
			expect(closed.bundle.summary.points).toEqual(points.slice(0, 2));
			await call('POST', `reviews/${id}/delivered`, {});
			const kept = (await call('GET', `reviews/${id}/bundle`)).body;
			expect(kept.summary.points).toEqual(points.slice(0, 2));
			expect(kept.comments).toHaveLength(3);
		});

		it('sends none: closing without sending keeps every thread in the bundle, marked unsent', async () => {
			const { call, id, t1, r1, t2, t3 } = await threeThreads();
			expect(
				(await call('POST', `reviews/${id}/feedback`, { threads: [] })).body.feedback
			).toBeNull();
			const closed = (await call('POST', `reviews/${id}/close`, {})).body;
			expect(closed.late).toBeNull();
			expect(marks(closed.bundle)).toEqual([
				[t1, false, [r1, false]],
				[t2, false],
				[t3, false]
			]);
			expect((await call('GET', 'state')).body.reviews[0].sent).toBe(false);
		});

		it('sends all: every thread marked sent, and a comment after the send still offered once', async () => {
			const { call, id, t1, r1, t2, t3 } = await threeThreads();
			const all = (await call('GET', 'state')).body.reviews[0].feedback;
			expect(all.ids).toEqual([t1, r1, t2, t3]);
			const closed = (await call('POST', `reviews/${id}/close`, { sent: all.ids.slice(0, 3) }))
				.body;
			expect(closed.late.ids).toEqual([t3]);
			expect(marks(closed.bundle)).toEqual([
				[t1, true, [r1, true]],
				[t2, true],
				[t3, false]
			]);
			await call('POST', `reviews/${id}/delivered`, { sent: [t3] });
			const b = (await call('GET', `reviews/${id}/bundle`)).body;
			expect(marks(b)).toEqual([
				[t1, true, [r1, true]],
				[t2, true],
				[t3, true]
			]);
			expect((await call('GET', 'state')).body.reviews[0].feedback).toBeNull();
		});

		it('makes no note for a closed review', async () => {
			const { call, id, t1 } = await threeThreads();
			await call('POST', `reviews/${id}/close`, {});
			expect((await call('POST', `reviews/${id}/feedback`, { threads: [t1] })).status).toBe(409);
		});
	});

	it('refuses requests that do not name it on this computer, and answers CORS for the plugin’s pages', async () => {
		const desk = await new D.Desk({
			dir: mkdtempSync(path.join(root, 'desk-')),
			port: 0,
			log: () => {}
		}).start();
		stops.push(() => desk.stop());
		const status = await new Promise<number>((resolve) => {
			const q = http.request(
				`${desk.url}/_review/desk/state`,
				{ headers: { host: 'rebound.example.com', 'x-review-desk-key': desk.key } },
				(r) => {
					r.resume();
					resolve(r.statusCode ?? 0);
				}
			);
			q.end();
		});
		expect(status).toBe(421);
		const pre = await fetch(`${desk.url}/_review/desk/state`, {
			method: 'OPTIONS',
			headers: { origin: 'http://127.0.0.1:4310' }
		});
		expect(pre.status).toBe(204);
		expect(pre.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4310');
		expect(pre.headers.get('access-control-allow-headers')).toContain('x-review-desk-key');
		const st = await (
			await fetch(`${desk.url}/_review/desk/state`, { headers: { 'x-review-desk-key': desk.key } })
		).json();
		expect(st.remote).toMatchObject({ state: 'off', url: null });
		await expect(new D.Desk({ dir: desk.dir, port: 0, log: () => {} }).start()).rejects.toThrow(
			/already runs/
		);
	});
});

describe('the share link with its passcode', () => {
	it('carries the passcode in the fragment, which signs in as a typed one does, or not at all', async () => {
		expect(D.withPasscode('https://r.example/_review/abc', 'k7mq-3xrt-h9pd')).toBe(
			'https://r.example/_review/abc#p=k7mq-3xrt-h9pd'
		);
		expect(D.withPasscode('https://r.example/_review/abc', null)).toBe(
			'https://r.example/_review/abc'
		);
		const desk = await new D.Desk({
			dir: mkdtempSync(path.join(root, 'desk-')),
			port: 0,
			log: () => {}
		}).start();
		stops.push(() => desk.stop());
		const site = mkdtempSync(path.join(root, 'site-'));
		writeFileSync(path.join(site, 'index.html'), '<h1>Hello</h1>');
		const rv = await desk.startReview({ title: 'Hello', source: { kind: 'static', dir: site } });
		expect(rv.shareLink).toBe(`${rv.link}#p=${encodeURIComponent(rv.passcode)}`);

		// The sign-in page loads the script that reads the fragment before anything else.
		const b = new Browser(desk.url);
		const rid = new URL(rv.link).pathname.split('/')[2];
		const page = await (await b.go(`/_review/${rid}`)).text();
		expect(page.indexOf('/_review/assets/passcode.js')).toBeGreaterThan(-1);
		expect(page.indexOf('/_review/assets/passcode.js')).toBeLessThan(page.indexOf('review.css'));
		expect(page).toContain('id="passcode-form"');
		expect(page).toContain('id="passcode"');
		const script = await b.go('/_review/assets/passcode.js');
		expect(script.status).toBe(200);

		// What the script posts is the passcode from the fragment: the same form, checks and limits.
		const fromLink = new URLSearchParams(new URL(rv.shareLink).hash.slice(1)).get('p')!;
		const wrong = await b.form(`/_review/${rid}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: `${fromLink}x`
		});
		expect(wrong.status).toBe(401);
		const ok = await b.form(`/_review/${rid}/signin`, {
			method: 'passcode',
			name: 'Ana',
			passcode: fromLink
		});
		expect(ok.status).toBe(303);
		expect(await (await b.go(`/_review/${rid}`)).text()).toContain('data-name="Ana"');

		// A closed review offers no link with its passcode.
		await desk.closeReview(rv.id, null);
		const st = await desk.state();
		expect(st.reviews[0]).toMatchObject({ state: 'closed', link: null, shareLink: null });
	});
});

describe('live thumbnails (the desk’s peeks)', () => {
	async function peekDesk() {
		const dir = mkdtempSync(path.join(root, 'desk-'));
		const desk = await new D.Desk({ dir, port: 0, log: () => {} }).start();
		stops.push(() => desk.stop());
		const call = async (p: string, body: unknown) => {
			const r = await fetch(`${desk.url}/_review/desk/${p}`, {
				method: 'POST',
				headers: { 'x-review-desk-key': desk.key, 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			return { status: r.status, body: await r.json() };
		};
		return { desk, call };
	}

	it('opens a static review once per ticket, for the asking page on this computer only', async () => {
		const { desk, call } = await peekDesk();
		const site = mkdtempSync(path.join(root, 'site-'));
		mkdirSync(path.join(site, 'node_modules', 'x'), { recursive: true });
		writeFileSync(path.join(site, 'index.html'), '<h1>Peek</h1>');
		writeFileSync(path.join(site, '.env'), 'SECRET=1');
		writeFileSync(path.join(site, 'node_modules', 'x', 'a.js'), 'x');
		const rv = await desk.startReview({
			title: 'Peek',
			source: { kind: 'static', dir: site, start: '/' }
		});
		const WH = 'http://127.0.0.1:4310';

		// The ticket is asked for with the desk key, by a page on this computer.
		const noKey = await fetch(`${desk.url}/_review/desk/reviews/${rv.id}/peek`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ origin: WH })
		});
		expect(noKey.status).toBe(401);
		expect((await call(`reviews/${rv.id}/peek`, { origin: 'https://wh.example.com' })).status).toBe(
			400
		);
		expect((await call('reviews/sr-nope/peek', { origin: WH })).status).toBe(404);
		const t = await call(`reviews/${rv.id}/peek`, { origin: WH });
		expect(t.status).toBe(200);
		const ticket = new URL(t.body.url);
		expect(ticket.hostname).toBe('127.0.0.1');
		expect(ticket.port).not.toBe(String(new URL(desk.url).port));
		expect(ticket.pathname).toMatch(/^\/_review\/peek\/[A-Za-z0-9_-]{32}$/);
		const base = ticket.origin;

		// Nothing answers without a session.
		const b = new Browser(base);
		expect((await b.go('/')).status).toBe(403);
		expect((await b.go('/index.html')).status).toBe(403);

		// The ticket works once, and swaps itself for a session cookie.
		const first = await b.go(ticket.pathname);
		expect(first.status).toBe(302);
		expect(first.headers.get('location')).toBe('/');
		const set = b.setCookies.find((c) => c.startsWith(`wr_peek_${ticket.port}=`))!;
		expect(set).toMatch(/; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
		expect((await new Browser(base).go(ticket.pathname)).status).toBe(403);

		const page = await b.go('/');
		expect(page.status).toBe(200);
		expect(await page.text()).toContain('<h1>Peek</h1>');
		expect(page.headers.get('content-security-policy')).toBe(`frame-ancestors ${WH}`);
		expect(page.headers.get('cache-control')).toBe('no-store');
		expect((await b.go('/.env')).status).toBe(404);
		expect((await b.go('/node_modules/x/a.js')).status).toBe(404);

		// Asked for by another name, it does not answer (DNS rebinding).
		const rebound = await new Promise<number>((resolve) => {
			const q = http.request(
				`${base}/`,
				{
					headers: {
						host: 'rebound.example.com',
						cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ')
					}
				},
				(r) => {
					r.resume();
					resolve(r.statusCode ?? 0);
				}
			);
			q.end();
		});
		expect(rebound).toBe(421);

		// Closing the review closes its peek.
		await desk.closeReview(rv.id, null);
		await expect(fetch(`${base}/`)).rejects.toThrow();
		expect((await call(`reviews/${rv.id}/peek`, { origin: WH })).status).toBe(409);
	});

	it('gives peeks asked for at once one port, which closing the review closes', async () => {
		const { desk } = await peekDesk();
		const site = mkdtempSync(path.join(root, 'site-'));
		writeFileSync(path.join(site, 'index.html'), '<h1>Peek</h1>');
		const rv = await desk.startReview({
			title: 'Peek',
			source: { kind: 'static', dir: site, start: '/' }
		});
		const WH = 'http://127.0.0.1:4310';
		const [a, b] = await Promise.all([desk.peek(rv.id, WH), desk.peek(rv.id, WH)]);
		const port = new URL(a.url).port;
		expect(new URL(b.url).port).toBe(port);
		await desk.closeReview(rv.id, null);
		await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
	});

	it('shows a live app as it is, framed by the asking page only, without Wheelhouse’s or the review’s cookies', async () => {
		const { desk, call } = await peekDesk();
		const app = await listen();
		const seen: string[] = [];
		app.set((req, res) => {
			seen.push(String(req.headers.cookie ?? ''));
			res.writeHead(200, {
				'content-type': 'text/html',
				'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
				'x-frame-options': 'DENY'
			});
			res.end(`<p>live ${req.url}</p>`);
		});
		const rv = await desk.startReview({
			title: 'Live',
			source: { kind: 'live', url: `${app.url}/start` }
		});
		const WH = 'http://localhost:4310';
		const t = await call(`reviews/${rv.id}/peek`, { origin: WH });
		const ticket = new URL(t.body.url);
		// The frame is on Wheelhouse's own host name, so it is same-site and its cookie is sent.
		expect(ticket.hostname).toBe('localhost');
		const b = new Browser(`http://127.0.0.1:${ticket.port}`);
		const first = await b.go(ticket.pathname);
		expect(first.headers.get('location')).toBe('/start');
		b.jar.set('wr_s_other', 'x');
		b.jar.set('app', '1');
		const page = await b.go('/start');
		expect(await page.text()).toBe('<p>live /start</p>');
		expect(page.headers.get('content-security-policy')).toBe(
			`default-src 'self'; frame-ancestors ${WH}`
		);
		expect(page.headers.get('x-frame-options')).toBeNull();
		expect(seen.at(-1)).toBe('app=1');
	});
});

describe('sign-in email over SMTP', () => {
	it('sends through a relay on this computer, authenticating without echoing the password', async () => {
		const got: string[] = [];
		const smtp = net.createServer((sock) => {
			let data = false;
			let buf = '';
			sock.write('220 relay ready\r\n');
			sock.on('data', (d) => {
				buf += d.toString();
				let i;
				while ((i = buf.indexOf('\r\n')) >= 0) {
					const line = buf.slice(0, i);
					buf = buf.slice(i + 2);
					got.push(line);
					if (data) {
						if (line === '.') {
							data = false;
							sock.write('250 queued\r\n');
						}
						continue;
					}
					if (line.startsWith('EHLO')) sock.write('250-relay\r\n250 AUTH PLAIN\r\n');
					else if (line.startsWith('AUTH PLAIN')) sock.write('235 ok\r\n');
					else if (line.startsWith('MAIL') || line.startsWith('RCPT')) sock.write('250 ok\r\n');
					else if (line === 'DATA') {
						data = true;
						sock.write('354 go\r\n');
					} else if (line === 'QUIT') sock.end('221 bye\r\n');
				}
			});
		});
		await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
		stops.push(() => new Promise((r) => smtp.close(() => r())));
		const port = (smtp.address() as net.AddressInfo).port;
		const sender = M.smtpSender(`smtp://user%40example.com:p%40ss@127.0.0.1:${port}`);
		const raw = M.message({
			from: 'Reviews <reviews@example.com>',
			to: 'ana@example.com',
			subject: 'Sign in: Café',
			text: 'Hello\n.\nlink',
			domain: 'example.com'
		});
		await sender.send({ from: 'reviews@example.com', to: 'ana@example.com', raw });
		expect(got).toContain('MAIL FROM:<reviews@example.com>');
		expect(got).toContain('RCPT TO:<ana@example.com>');
		const auth = got.find((l) => l.startsWith('AUTH PLAIN '))!;
		expect(Buffer.from(auth.slice(11), 'base64').toString()).toBe(
			'\u0000user@example.com\u0000p@ss'
		);
		expect(got).toContain('Subject: =?UTF-8?B?U2lnbiBpbjogQ2Fmw6k=?=');
		expect(M.address('Reviews <reviews@example.com>')).toBe('reviews@example.com');
		expect(() => M.smtpSender('https://mail.example.com')).toThrow(/smtp:\/\//);
	});
});
