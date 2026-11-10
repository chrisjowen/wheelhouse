#!/usr/bin/env node
/**
 * Shared review on one computer, end to end:
 *
 *   node plugins/shared-review/demo/run.mjs [--state <dir>] [--port <desk port>] [--live-port <port>]
 *                                           [--remote <review server> --token-env <variable>]
 *
 * It starts a review desk (in a fresh folder unless --state names one), a
 * stand-in for a worker's dev server, a stand-in review server on loopback,
 * and three reviews, one in each state: the static prototype in
 * demo/prototype as a local preview, the live app put live on the stand-in
 * review server, and the prototype's help page, closed. Two reviewers, Ana
 * and Ben, sign in with each review's passcode and leave comments anchored to
 * spots on the pages, as the review page does when they click, plus a
 * comment on the review as a whole with a picture and a voice note (a
 * made-up tone standing in for a recording). It prints each open review's
 * address and the link that carries its passcode, and keeps running until
 * Ctrl-C so you can open them, add your own comments, and close them from
 * Wheelhouse (with WH_REVIEW_STATE set to the same folder) or with
 * `main.mjs close <id>`. With --remote (a review server, such as one
 * `main.mjs serve` runs) and the owner token in the variable --token-env
 * names, reviews go live there instead of on the stand-in.
 */

import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Desk } from '../review/desk.mjs';
import { randomId } from '../review/lib.mjs';
import { ReviewServer } from '../review/server.mjs';
import { parseArgs } from '../review/main.mjs';
import { startLiveApp } from './live-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { opts } = parseArgs(process.argv.slice(2));
const dir = opts.state
	? path.resolve(opts.state)
	: mkdtempSync(path.join(tmpdir(), 'shared-review-demo-'));

const tokenName = opts['token-env'] ?? 'SHARED_REVIEW_OWNER_TOKEN';

/** A review server on loopback, standing in for the one you would deploy. */
async function standIn() {
	const token = randomId(32);
	const srv = http.createServer();
	await new Promise((r) => srv.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${srv.address().port}`;
	const rs = new ReviewServer({
		dataDir: path.join(dir, 'stand-in-server'),
		publicUrl: url,
		ownerToken: token,
		log: () => {}
	});
	srv.on('request', rs.handle);
	return { url, token, srv };
}

const server = opts.remote ? null : await standIn();
const desk = await new Desk({
	dir,
	port: Number(opts.port ?? 0),
	remote: server
		? { url: server.url, token: server.token, tokenName }
		: { url: opts.remote, token: process.env[tokenName] || null, tokenName },
	log: () => {}
}).start();
const live = await startLiveApp(Number(opts['live-port'] ?? 0));
const liveUrl = `http://127.0.0.1:${live.address().port}/`;

async function deskCall(p, body = {}) {
	const r = await fetch(`${desk.url}/_review/desk/${p}`, {
		method: 'POST',
		headers: { 'x-review-desk-key': desk.key, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const v = await r.json();
	if (!r.ok) throw new Error(v.error);
	return v.review;
}

/** A reviewer signing in with the passcode, as the sign-in page's form does. */
async function signIn(review, name) {
	const link = new URL(review.link);
	const r = await fetch(new URL(`${link.pathname}/signin`, link), {
		method: 'POST',
		redirect: 'manual',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin: link.origin },
		body: new URLSearchParams({ method: 'passcode', name, passcode: review.passcode })
	});
	if (r.status !== 303) throw new Error(`${name} could not sign in (${r.status})`);
	const cookie = r.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	const rid = link.pathname.split('/')[2];
	return {
		async comment(body, anchor, parent, extra = {}) {
			const res = await fetch(`${link.origin}/_review/${rid}/api/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: link.origin, cookie },
				body: JSON.stringify({ body, anchor, parent, ...extra })
			});
			const v = await res.json();
			if (!res.ok) throw new Error(v.error);
			return v.comment;
		},
		/** Add a file (or, with `seconds`, a voice note), as the review page's Attach and Record do. */
		async attach(bytes, type, name, seconds = null) {
			const res = await fetch(`${link.origin}/_review/${rid}/api/attachments`, {
				method: 'POST',
				headers: {
					'content-type': type,
					'x-file-name': encodeURIComponent(name),
					origin: link.origin,
					cookie,
					...(seconds !== null ? { 'x-voice-note': '1', 'x-voice-seconds': String(seconds) } : {})
				},
				body: bytes
			});
			const v = await res.json();
			if (!res.ok) throw new Error(v.error);
			return v.attachment.id;
		}
	};
}

/** A small made-up screenshot: a PNG of a soft gradient with a bar where a button would be. */
function samplePng(w = 240, h = 135) {
	const rows = [];
	for (let y = 0; y < h; y++) {
		const row = Buffer.alloc(1 + w * 3);
		for (let x = 0; x < w; x++) {
			const bar = y > 85 && y < 110 && x > 30 && x < 210;
			row[1 + x * 3] = bar ? 31 : 230 - Math.round((y / h) * 40);
			row[2 + x * 3] = bar ? 111 : 236 - Math.round((x / w) * 30);
			row[3 + x * 3] = bar ? 139 : 242;
		}
		rows.push(row);
	}
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
		return Buffer.concat([len, Buffer.from(type), data, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** A stand-in voice note: a few seconds of a soft two-note tone, as a WAV file. */
function sampleWav(seconds = 3, rate = 8000) {
	const n = seconds * rate;
	const data = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) {
		const f = i < n / 2 ? 440 : 554;
		const fade = Math.min(1, i / 400, (n - i) / 400);
		data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 6000 * fade), i * 2);
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + data.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

/** Where a click lands, as the review page records it. */
const spot = (path, selector, label, at, text = null) => ({
	path,
	selector,
	at,
	doc: null,
	viewport: { w: 1280, h: 800 },
	label,
	text
});

const proto = await deskCall('reviews', {
	task: 'demo-checkout',
	project: 'demo',
	title: 'Checkout prototype',
	source: { kind: 'static', dir: path.join(here, 'prototype') }
});
let app = await deskCall('reviews', {
	task: 'demo-tides',
	project: 'demo',
	title: 'Tide tables (live app)',
	source: { kind: 'live', url: liveUrl }
});
const help = await deskCall('reviews', {
	task: 'demo-help',
	project: 'demo',
	title: 'Help page',
	start: '/help.html',
	source: { kind: 'static', dir: path.join(here, 'prototype') }
});

const ana = await signIn(proto, 'Ana');
const ben = await signIn(proto, 'Ben');
const pay = await ana.comment(
	'The Pay now button should say the amount, so people know what they are paying.',
	spot('/', '#pay', 'the “Pay now” button', { x: 0.5, y: 0.5 }, 'Pay now')
);
await ben.comment('Agreed, and make it a little taller on phones.', null, pay.id);
await ben.comment(
	'Promo codes are rare for us: tuck this behind a “Have a code?” link.',
	spot('/', 'main > label', 'the “Promo code” box', { x: 0.2, y: 0.7 })
);
const shot = await ben.attach(samplePng(), 'image/png', 'checkout-on-my-phone.png');
const voice = await ben.attach(sampleWav(), 'audio/wav', 'voice-note.wav', 3);
const overall = await ben.comment(
	'Overall the flow is clear. On my phone the summary pushes the button below the fold, see the picture.',
	null,
	null,
	{ general: true, attachments: [shot, voice] }
);
await ana.comment('Same on mine; worth a sticky footer?', null, overall.id, { general: true });
await ana.comment(
	'The help page needs opening hours.',
	spot('/help.html', 'main > p', 'a part of the page near the top', { x: 0.3, y: 0.5 })
);

// The live app goes live on the review server, as Go live does, with a new link and passcode.
if ((await desk.remote(true)).state === 'ready') app = await deskCall(`reviews/${app.id}/live`);
// Ana and Ben comment on the help page, then it is closed, as Close… does.
const benHelp = await signIn(help, 'Ben');
await benHelp.comment(
	'Say where the shop is, with a map link.',
	spot('/help.html', 'main > h1', 'the “Help” heading', { x: 0.5, y: 0.5 })
);
await deskCall(`reviews/${help.id}/close`);
await deskCall(`reviews/${help.id}/delivered`);

const anaLive = await signIn(app, 'Ana');
const benLive = await signIn(app, 'Ben');
await benLive.comment(
	'Show today’s date above the table.',
	spot('/', '#place', 'the “Harbour mouth” part of the page', { x: 0.1, y: 0.5 })
);
await anaLive.comment(
	'Heights would read better with one decimal and the unit in the header.',
	spot('/', '#tides > thead > tr > th:nth-of-type(3)', 'the “Height” part of the page', {
		x: 0.5,
		y: 0.5
	})
);

console.log(`Review desk: ${desk.url} (state in ${dir})`);
if (server) console.log(`Stand-in review server: ${server.url}`);
console.log(`Live app under review: ${liveUrl}`);
for (const r of [proto, app]) {
	console.log('');
	console.log(`${r.title} (${r.id}, task ${r.task}, ${r.where}), passcode ${r.passcode}`);
	console.log(`  link with the passcode, to share: ${r.shareLink}`);
	console.log(`note: preview ${r.link}`);
}
console.log('');
console.log(`${help.title} (${help.id}, task ${help.task}) is closed.`);
console.log('');
console.log('Ana and Ben have left comments on each. Close a review with:');
console.log(
	`  WH_REVIEW_STATE=${dir} node ${path.join(here, '..', 'review', 'main.mjs')} close <id>`
);
console.log(
	'or from Wheelhouse, started with WH_REVIEW_STATE set to that folder. Ctrl-C stops the demo.'
);

const stop = async () => {
	await desk.stop();
	live.close();
	server?.srv.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
