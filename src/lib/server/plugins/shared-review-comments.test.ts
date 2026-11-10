/* eslint-disable @typescript-eslint/no-explicit-any -- the review server is plain JavaScript, loaded by path */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFeedback } from './feedback';

/**
 * Shared review's comments beyond a pinned spot: comments on the review as
 * a whole, files and voice notes on comments, and editing and deleting
 * them. A review server (and a desk) run in this process on loopback, with
 * their data in a temporary folder; nothing reaches the network.
 */

const REVIEW = path.resolve('plugins/shared-review/review');
const load = (f: string) => import(pathToFileURL(path.join(REVIEW, f)).href) as Promise<any>;
const OWNER = 'owner-token-for-tests-0123456789abcdef';

let S: any;
let C: any;
let A: any;
let D: any;
let Client: any;
let root: string;
const stops: (() => Promise<void>)[] = [];

beforeAll(async () => {
	[S, C, A, D] = await Promise.all([
		load('server.mjs'),
		load('comments.mjs'),
		load('attachments.mjs'),
		load('desk.mjs')
	]);
	Client = (await load('client.mjs')).OwnerClient;
	root = mkdtempSync(path.join(tmpdir(), 'wh-shared-review-comments-'));
});

afterAll(async () => {
	for (const stop of stops.reverse()) await stop();
	rmSync(root, { recursive: true, force: true });
});

async function reviewServer() {
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
	const url = `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`;
	const dataDir = mkdtempSync(path.join(root, 'data-'));
	const rs = new S.ReviewServer({ dataDir, publicUrl: url, ownerToken: OWNER, log: () => {} });
	handler = rs.handle;
	return { url, rs, dataDir, owner: new Client(url, OWNER) };
}

/** A reviewer's browser: keeps its cookies, follows no redirects. */
class Browser {
	jar = new Map<string, string>();
	constructor(public base: string) {}
	async go(p: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
		if (init.method && init.method !== 'GET') headers.set('origin', this.base);
		const r = await fetch(new URL(p, this.base), { ...init, headers, redirect: 'manual' });
		for (const c of r.headers.getSetCookie()) {
			const kv = c.split(';')[0];
			const i = kv.indexOf('=');
			this.jar.set(kv.slice(0, i), kv.slice(i + 1));
		}
		return r;
	}
	send(method: string, p: string, body?: unknown) {
		return this.go(p, {
			method,
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	}
	upload(p: string, bytes: Buffer, type: string, name: string, extra: Record<string, string> = {}) {
		return this.go(p, {
			method: 'POST',
			headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name), ...extra },
			body: new Uint8Array(bytes)
		});
	}
}

async function staticReview(s: Awaited<ReturnType<typeof reviewServer>>) {
	const made = await s.owner.create({
		title: 'Checkout',
		task: 'demo-1',
		source: { kind: 'static' }
	});
	const rid = made.review.rid;
	await s.owner.putFile(rid, 'index.html', Buffer.from('<button id="pay">Pay now</button>'));
	await s.owner.open(rid);
	return { rid, passcode: made.passcode as string };
}

async function signedIn(base: string, r: { rid: string; passcode: string }, name: string) {
	const b = new Browser(base);
	const res = await b.go(`/_review/${r.rid}/signin`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ method: 'passcode', name, passcode: r.passcode }).toString()
	});
	expect(res.status).toBe(303);
	return b;
}

const anchor = {
	path: '/',
	selector: '#pay',
	at: { x: 0.5, y: 0.5 },
	label: 'the “Pay now” button'
};
const PNG = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(64, 1)
]);
const PDF = Buffer.from('%PDF-1.4\n%fake but enough for a type check\n');
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 2)]);

describe('comments on the review as a whole', () => {
	it('sit beside pinned ones, take replies, and reach Firstmate as not about one spot', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const ben = await signedIn(s.url, r, 'Ben');
		const api = `/_review/${r.rid}/api/comments`;

		const pinned = (await (await ana.send('POST', api, { body: 'Bigger', anchor })).json()).comment;
		expect(pinned).toMatchObject({
			general: false,
			anchor: expect.objectContaining({ path: '/' })
		});
		const res = await ana.send('POST', api, {
			body: 'The whole flow feels slow',
			general: true,
			anchor
		});
		expect(res.status).toBe(201);
		const general = (await res.json()).comment;
		expect(general).toMatchObject({ general: true, anchor: null, parent: null, mine: true });
		const reply = (
			await (await ben.send('POST', api, { body: 'Agreed', parent: general.id, anchor })).json()
		).comment;
		expect(reply).toMatchObject({ parent: general.id, general: true, anchor: null, mine: true });

		const seen = (await (await ben.go(api)).json()).comments;
		expect(seen.map((c: any) => [c.body, c.general, c.mine])).toEqual([
			['Bigger', false, false],
			['The whole flow feels slow', true, false],
			['Agreed', true, true]
		]);

		const closed = await s.owner.close(r.rid);
		expect(closed.bundle.comments).toEqual([
			expect.objectContaining({ n: 1, general: false, page: '/' }),
			expect.objectContaining({
				n: 2,
				general: true,
				page: null,
				anchor: null,
				replies: [expect.objectContaining({ body: 'Agreed' })]
			})
		]);
		const list = C.feedbackList(closed.bundle);
		expect(list.items[1]).toEqual({
			text: 'Ana: The whole flow feels slow — Ben replied: Agreed',
			points: 'the review as a whole (not one spot)'
		});
		expect(
			readFeedback({ taskId: 'demo-1', subject: list.subject, items: list.items })
		).toMatchObject({ ok: true });
		// Nothing about who signed in leaves the server with the bundle.
		expect(JSON.stringify(closed.bundle)).not.toMatch(/"by"|s:/);
	});
});

describe('attachments', () => {
	it('take only allowed types whose bytes match, within size, from signed-in reviewers', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const up = `/_review/${r.rid}/api/attachments`;

		const png = await ana.upload(up, PNG, 'image/png', 'folder/../shot.png');
		expect(png.status).toBe(201);
		expect((await png.json()).attachment).toMatchObject({
			id: expect.any(String),
			name: 'shot.png',
			type: 'image/png',
			size: PNG.length,
			kind: 'image',
			seconds: null
		});

		const refused = async (bytes: Buffer, type: string, name: string, status: number) =>
			expect((await ana.upload(up, bytes, type, name)).status).toBe(status);
		// An HTML page dressed as a picture, SVG and HTML themselves, and things not on the list.
		await refused(Buffer.from('<html><script>alert(1)</script>'), 'image/png', 'x.png', 415);
		await refused(
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
			'image/svg+xml',
			'x.svg',
			415
		);
		await refused(Buffer.from('<h1>hi</h1>'), 'text/html', 'x.html', 415);
		await refused(Buffer.from('MZ'), 'application/octet-stream', 'x.exe', 415);
		await refused(Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'text/plain', 'x.txt', 415);
		await refused(Buffer.alloc(0), 'text/plain', 'empty.txt', 400);
		await refused(Buffer.concat([PNG, Buffer.alloc(A.LIMITS.file)]), 'image/png', 'huge.png', 413);
		// A voice note is sound, of at most five minutes.
		await refused(PNG, 'image/png', 'v.png', 201);
		expect((await ana.upload(up, PNG, 'image/png', 'v.png', { 'x-voice-note': '1' })).status).toBe(
			415
		);
		expect(
			(
				await ana.upload(up, WEBM, 'audio/webm', 'v.webm', {
					'x-voice-note': '1',
					'x-voice-seconds': '400'
				})
			).status
		).toBe(413);

		expect((await new Browser(s.url).upload(up, PNG, 'image/png', 'x.png')).status).toBe(401);
		const forged = await fetch(new URL(up, s.url), {
			method: 'POST',
			headers: {
				cookie: [...ana.jar].map(([k, v]) => `${k}=${v}`).join('; '),
				origin: 'https://elsewhere.example',
				'content-type': 'image/png'
			},
			body: new Uint8Array(PNG)
		});
		expect(forged.status).toBe(403);
	});

	it('are seen by the review’s reviewers once on a comment, served so they cannot run', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const ben = await signedIn(s.url, r, 'Ben');
		const up = `/_review/${r.rid}/api/attachments`;
		const api = `/_review/${r.rid}/api/comments`;

		const img = (await (await ana.upload(up, PNG, 'image/png', 'shot.png')).json()).attachment;
		const pdf = (await (await ana.upload(up, PDF, 'application/pdf', 'spec "v2".pdf')).json())
			.attachment;
		const voice = (
			await (
				await ana.upload(up, WEBM, 'audio/webm;codecs=opus', 'anything.webm', {
					'x-voice-note': '1',
					'x-voice-seconds': '12.4'
				})
			).json()
		).attachment;
		expect(voice).toMatchObject({
			kind: 'voice',
			type: 'audio/webm',
			seconds: 12,
			name: 'voice-note.webm'
		});

		// Not on a comment yet: only its uploader sees it, and nobody can post it but them.
		expect((await ana.go(`${up}/${img.id}`)).status).toBe(200);
		expect((await ben.go(`${up}/${img.id}`)).status).toBe(404);
		expect(
			(await ben.send('POST', api, { body: 'mine now', anchor, attachments: [img.id] })).status
		).toBe(400);
		expect(
			(
				await ana.send('POST', api, {
					body: 'too many',
					anchor,
					attachments: ['a', 'b', 'c', 'd', 'e']
				})
			).status
		).toBe(400);

		const posted = await ana.send('POST', api, {
			body: '',
			general: true,
			attachments: [img.id, pdf.id, voice.id]
		});
		expect(posted.status).toBe(201);
		const c = (await posted.json()).comment;
		expect(c.attachments.map((a: any) => a.kind)).toEqual(['image', 'file', 'voice']);
		// Taken by one comment, an upload cannot go on another.
		expect(
			(await ana.send('POST', api, { body: 'again', anchor, attachments: [img.id] })).status
		).toBe(400);

		const pic = await ben.go(`${up}/${img.id}`);
		expect(pic.status).toBe(200);
		expect(pic.headers.get('content-type')).toBe('image/png');
		expect(pic.headers.get('x-content-type-options')).toBe('nosniff');
		expect(pic.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
		expect(pic.headers.get('content-disposition')).toMatch(/^inline; filename="shot\.png"/);
		expect(Buffer.from(await pic.arrayBuffer()).equals(PNG)).toBe(true);
		const doc = await ben.go(`${up}/${pdf.id}`);
		expect(doc.headers.get('content-disposition')).toMatch(
			/^attachment; filename="spec _v2_\.pdf"; filename\*=UTF-8''spec%20%22v2%22\.pdf$/
		);
		const sound = await ben.go(`${up}/${voice.id}`);
		expect(sound.headers.get('content-type')).toBe('audio/webm');
		expect(sound.headers.get('content-disposition')).toMatch(/^inline;/);

		// Signed out, or signed in to another review, nothing is served.
		expect((await new Browser(s.url).go(`${up}/${img.id}`)).status).toBe(401);
		const r2 = await staticReview(s);
		const cy = await signedIn(s.url, r2, 'Cy');
		expect((await cy.go(`${up}/${img.id}`)).status).toBe(401);
		expect((await cy.go(`/_review/${r2.rid}/api/attachments/${img.id}`)).status).toBe(404);

		// The review page lets pictures and sound from its own site play, and nothing else.
		const shell = await ana.go(`/_review/${r.rid}`);
		const csp = new Map(
			(shell.headers.get('content-security-policy') ?? '').split(';').map((d) => {
				const [k, ...v] = d.trim().split(/\s+/);
				return [k, v.join(' ')] as const;
			})
		);
		expect(csp.get('media-src')).toBe("'self'");
		expect(csp.get('img-src')).toBe("'self' data:");
		expect(await shell.text()).toContain('id="general"');
	});

	it('make room for a reviewer’s next upload by removing their oldest one never posted', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const ben = await signedIn(s.url, r, 'Ben');
		const up = `/_review/${r.rid}/api/attachments`;
		const add = async (b: Browser, name: string) => {
			const res = await b.upload(up, PNG, 'image/png', name);
			expect(res.status).toBe(201);
			return (await res.json()).attachment.id as string;
		};
		const posted = await add(ana, 'posted.png');
		await ana.send('POST', `/_review/${r.rid}/api/comments`, {
			body: 'Kept',
			anchor,
			attachments: [posted]
		});
		const bens = await add(ben, 'ben.png');
		const anas: string[] = [];
		for (let i = 0; i < A.LIMITS.pending; i++) anas.push(await add(ana, `${i}.png`));
		const next = await add(ana, 'next.png');

		expect((await ana.go(`${up}/${anas[0]}`)).status).toBe(404);
		for (const id of [...anas.slice(1), next, posted])
			expect((await ana.go(`${up}/${id}`)).status).toBe(200);
		expect((await ben.go(`${up}/${bens}`)).status).toBe(200);
		expect(readdirSync(path.join(s.dataDir, 'uploads', r.rid))).toHaveLength(A.LIMITS.pending + 2);
	});

	it('remove nothing for an upload the full review refuses', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const up = `/_review/${r.rid}/api/attachments`;
		const ids: string[] = [];
		for (let i = 0; i < A.LIMITS.pending; i++)
			ids.push((await (await ana.upload(up, PNG, 'image/png', `${i}.png`)).json()).attachment.id);
		const review = s.rs.state.reviews[r.rid];
		review.uploadBytes = A.LIMITS.review + 1;
		expect((await ana.upload(up, PNG, 'image/png', 'over.png')).status).toBe(413);
		for (const id of ids) expect((await ana.go(`${up}/${id}`)).status).toBe(200);
		// Exactly full: the oldest upload's room is what the next one needs.
		review.uploadBytes = A.LIMITS.review;
		expect((await ana.upload(up, PNG, 'image/png', 'fits.png')).status).toBe(201);
		expect((await ana.go(`${up}/${ids[0]}`)).status).toBe(404);
		expect((await ana.go(`${up}/${ids[1]}`)).status).toBe(200);
	});

	it('are deleted with the review when it closes; the bundle names them without their bytes', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const up = `/_review/${r.rid}/api/attachments`;
		const img = (await (await ana.upload(up, PNG, 'image/png', 'shot.png')).json()).attachment;
		const voice = (
			await (
				await ana.upload(up, WEBM, 'audio/webm', 'v.webm', {
					'x-voice-note': '1',
					'x-voice-seconds': '42'
				})
			).json()
		).attachment;
		await ana.upload(up, PDF, 'application/pdf', 'never-posted.pdf');
		await ana.send('POST', `/_review/${r.rid}/api/comments`, {
			body: 'See the picture',
			anchor,
			attachments: [img.id, voice.id]
		});
		const dir = path.join(s.dataDir, 'uploads', r.rid);
		expect(readdirSync(dir)).toHaveLength(3);

		const closed = await s.owner.close(r.rid);
		expect(existsSync(dir)).toBe(false);
		expect(closed.bundle.comments[0].attachments).toEqual([
			{ name: 'shot.png', type: 'image/png', size: PNG.length, kind: 'image', seconds: null },
			{ name: 'voice-note.webm', type: 'audio/webm', size: WEBM.length, kind: 'voice', seconds: 42 }
		]);
		expect(C.feedbackList(closed.bundle).items[0].text).toBe(
			`Ana: See the picture [attached: shot.png (${PNG.length} B); voice note, 0:42]`
		);
		expect((await ana.go(`${up}/${img.id}`)).status).toBe(401);
		await expect(s.owner.attachment(r.rid, img.id)).rejects.toThrow();
	});
});

describe('editing and deleting comments', () => {
	it('is for whoever wrote them, checked by the server', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const ben = await signedIn(s.url, r, 'Ben');
		const api = `/_review/${r.rid}/api/comments`;
		const up = `/_review/${r.rid}/api/attachments`;
		const img = (await (await ana.upload(up, PNG, 'image/png', 'shot.png')).json()).attachment;
		const c = (
			await (await ana.send('POST', api, { body: 'Bigger', anchor, attachments: [img.id] })).json()
		).comment;

		expect((await ben.send('PATCH', `${api}/${c.id}`, { body: 'Hijacked' })).status).toBe(403);
		expect((await ben.send('DELETE', `${api}/${c.id}`)).status).toBe(403);
		expect((await new Browser(s.url).send('DELETE', `${api}/${c.id}`)).status).toBe(401);
		// Ana signed in again is a new sign-in: her old comments are no longer hers to change.
		const again = await signedIn(s.url, r, 'Ana');
		expect((await again.send('PATCH', `${api}/${c.id}`, { body: 'x' })).status).toBe(403);

		const edited = await ana.send('PATCH', `${api}/${c.id}`, {
			body: 'Bigger, and green',
			attachments: []
		});
		expect(edited.status).toBe(200);
		expect((await edited.json()).comment).toMatchObject({
			body: 'Bigger, and green',
			attachments: [],
			editedAt: expect.any(String)
		});
		// The picture taken off the comment is gone from the server.
		expect(existsSync(path.join(s.dataDir, 'uploads', r.rid, img.id))).toBe(false);
		expect((await ana.send('PATCH', `${api}/${c.id}`, { body: '' })).status).toBe(400);

		const reply = (await (await ben.send('POST', api, { body: 'Agreed', parent: c.id })).json())
			.comment;
		expect((await ana.send('DELETE', `${api}/${c.id}`)).status).toBe(409);
		expect((await ben.send('DELETE', `${api}/${reply.id}`)).status).toBe(200);
		const gone = await ana.send('DELETE', `${api}/${c.id}`);
		expect(gone.status).toBe(200);
		expect((await gone.json()).removed).toEqual([c.id]);
		expect((await (await ben.go(api)).json()).comments).toEqual([]);
	});

	it('lets the review’s owner take any comment off, with its replies and attachments', async () => {
		const s = await reviewServer();
		const r = await staticReview(s);
		const ana = await signedIn(s.url, r, 'Ana');
		const ben = await signedIn(s.url, r, 'Ben');
		const api = `/_review/${r.rid}/api/comments`;
		const img = (
			await (
				await ben.upload(`/_review/${r.rid}/api/attachments`, PNG, 'image/png', 'a.png')
			).json()
		).attachment;
		const c = (await (await ana.send('POST', api, { body: 'Spam', general: true })).json()).comment;
		await ben.send('POST', api, { body: 'More spam', parent: c.id, attachments: [img.id] });
		await ben.send('POST', api, { body: 'Keep me', anchor });

		const v = await s.owner.deleteComment(r.rid, c.id);
		expect(v.removed).toHaveLength(2);
		expect((await s.owner.get(r.rid)).comments.map((x: any) => x.body)).toEqual(['Keep me']);
		expect(readdirSync(path.join(s.dataDir, 'uploads', r.rid))).toEqual([]);
		await expect(s.owner.deleteComment(r.rid, c.id)).rejects.toThrow(/gone/);
	});
});

describe('the review desk', () => {
	it('moves attachments live with their comments, and lets the captain delete a comment', async () => {
		const remote = await reviewServer();
		const dir = mkdtempSync(path.join(root, 'desk-'));
		const desk = await new D.Desk({
			dir,
			port: 0,
			remote: { url: remote.url, token: OWNER, tokenName: 'SHARED_REVIEW_OWNER_TOKEN' },
			log: () => {}
		}).start();
		stops.push(() => desk.stop());
		const deskKey = JSON.parse(readFileSync(path.join(dir, 'desk.json'), 'utf8')).key;
		const call = async (method: string, p: string, body?: unknown) => {
			const r = await fetch(`${desk.url}/_review/desk/${p}`, {
				method,
				headers: {
					'x-review-desk-key': deskKey,
					...(body ? { 'content-type': 'application/json' } : {})
				},
				body: body ? JSON.stringify(body) : undefined
			});
			return { status: r.status, body: await r.json() };
		};
		const site = path.join(root, 'site');
		mkdirSync(site, { recursive: true });
		writeFileSync(path.join(site, 'index.html'), '<button id="pay">Pay now</button>');
		const local = (
			await call('POST', 'reviews', {
				task: 'demo-1',
				title: 'Checkout',
				source: { kind: 'static', root: site, dir: '.' }
			})
		).body.review;
		const rid = new URL(local.link).pathname.split('/')[2];
		const ana = await signedIn(desk.url, { rid, passcode: local.passcode }, 'Ana');
		const img = (
			await (
				await ana.upload(`/_review/${rid}/api/attachments`, PNG, 'image/png', 'shot.png')
			).json()
		).attachment;
		const c = (
			await (
				await ana.send('POST', `/_review/${rid}/api/comments`, {
					body: 'Look',
					general: true,
					attachments: [img.id]
				})
			).json()
		).comment;
		const spam = (
			await (
				await ana.send('POST', `/_review/${rid}/api/comments`, { body: 'Oops', anchor })
			).json()
		).comment;

		const state = (await call('GET', 'state?task=demo-1')).body.reviews[0];
		expect(state.comments[0]).toMatchObject({
			general: true,
			anchor: null,
			attachments: [{ name: 'shot.png', kind: 'image', size: PNG.length }]
		});
		expect(JSON.stringify(state.comments)).not.toMatch(/"by"/);

		const del = await call('DELETE', `reviews/${local.id}/comments/${spam.id}`);
		expect(del).toMatchObject({ status: 200, body: { removed: [spam.id] } });

		const live = (await call('POST', `reviews/${local.id}/live`, {})).body.review;
		const remoteRid = new URL(live.link).pathname.split('/')[2];
		const moved = (await remote.owner.get(remoteRid)).comments;
		expect(moved).toEqual([
			expect.objectContaining({
				id: c.id,
				anchor: null,
				attachments: [expect.objectContaining({ id: img.id })]
			})
		]);
		const bytes = await remote.owner.attachment(remoteRid, img.id);
		expect(bytes.equals(PNG)).toBe(true);
		const ben = await signedIn(remote.url, { rid: remoteRid, passcode: live.passcode }, 'Ben');
		expect((await ben.go(`/_review/${remoteRid}/api/attachments/${img.id}`)).status).toBe(200);
		// The local preview and its uploads are gone.
		expect(existsSync(path.join(dir, 'local', 'uploads', rid))).toBe(false);

		const closed = (await call('POST', `reviews/${local.id}/close`, { sent: [] })).body;
		expect(closed.bundle.comments[0]).toMatchObject({
			general: true,
			attachments: [expect.objectContaining({ name: 'shot.png' })]
		});
		expect(existsSync(path.join(remote.dataDir, 'uploads', remoteRid))).toBe(false);
	});
});

describe('attachment checks', () => {
	it('know the allowed types by their first bytes, and refuse the rest', () => {
		expect(A.readType('audio/webm;codecs=opus')).toBe('audio/webm');
		expect(A.readType('image/jpg')).toBe('image/jpeg');
		expect(A.readType('image/svg+xml')).toBeNull();
		expect(A.readType('text/html')).toBeNull();
		expect(A.readFileName('..%2F..%2Fetc%2Fpasswd', 'text/plain')).toBe('passwd');
		expect(A.readFileName('', 'image/png')).toBe('attachment.png');
		expect(A.readFileName('.hidden', 'text/plain')).toBe('hidden');
		const ok = (type: string, body: Buffer) => A.readUpload({ type, name: 'x', body }).ok;
		expect(ok('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
		expect(ok('image/gif', Buffer.from('GIF89a....'))).toBe(true);
		expect(ok('image/webp', Buffer.from('RIFF....WEBPVP8 '))).toBe(true);
		expect(ok('audio/wav', Buffer.from('RIFF....WAVEfmt '))).toBe(true);
		expect(ok('audio/mp4', Buffer.from('\0\0\0\x20ftypM4A '))).toBe(true);
		expect(ok('image/webp', Buffer.from('RIFF....WAVEfmt '))).toBe(false);
		expect(ok('text/csv', Buffer.from('a,b\n1,2\n'))).toBe(true);
		expect(ok('application/json', Buffer.from('{"a":1}'))).toBe(true);
	});
});
