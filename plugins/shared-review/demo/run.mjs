#!/usr/bin/env node
/**
 * Shared review on one computer, end to end, without a review server:
 *
 *   node plugins/shared-review/demo/run.mjs [--state <dir>] [--port <desk port>] [--live-port <port>]
 *                                           [--remote <review server> --token-env <variable>]
 *
 * It starts a review desk (in a fresh folder unless --state names one), a
 * stand-in for a worker's dev server, and two reviews as local previews: the
 * static prototype in demo/prototype, and the live app. Two reviewers, Ana
 * and Ben, sign in with each review's passcode and leave comments anchored to
 * spots on the pages, as the review page does when they click. It prints each
 * review's address and passcode, and keeps running until Ctrl-C so you can
 * open them, add your own comments, and close them from Wheelhouse (with
 * WH_REVIEW_STATE set to the same folder) or with `main.mjs close <id>`.
 * With --remote (a review server, such as one `main.mjs serve` runs on this
 * computer) and the owner token in the variable --token-env names, the
 * reviews can go live there too.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Desk } from '../review/desk.mjs';
import { parseArgs } from '../review/main.mjs';
import { startLiveApp } from './live-app.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { opts } = parseArgs(process.argv.slice(2));
const dir = opts.state
	? path.resolve(opts.state)
	: mkdtempSync(path.join(tmpdir(), 'shared-review-demo-'));

const tokenName = opts['token-env'] ?? 'SHARED_REVIEW_OWNER_TOKEN';
const desk = await new Desk({
	dir,
	port: Number(opts.port ?? 0),
	remote: opts.remote
		? { url: opts.remote, token: process.env[tokenName] || null, tokenName }
		: null,
	log: () => {}
}).start();
const live = await startLiveApp(Number(opts['live-port'] ?? 0));
const liveUrl = `http://127.0.0.1:${live.address().port}/`;

async function deskCall(p, body) {
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
		async comment(body, anchor, parent) {
			const res = await fetch(`${link.origin}/_review/${rid}/api/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: link.origin, cookie },
				body: JSON.stringify({ body, anchor, parent })
			});
			const v = await res.json();
			if (!res.ok) throw new Error(v.error);
			return v.comment;
		}
	};
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
const app = await deskCall('reviews', {
	task: 'demo-tides',
	project: 'demo',
	title: 'Tide tables (live app)',
	source: { kind: 'live', url: liveUrl }
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
await ana.comment(
	'The help page needs opening hours.',
	spot('/help.html', 'main > p', 'a part of the page near the top', { x: 0.3, y: 0.5 })
);

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
console.log(`Live app under review: ${liveUrl}`);
for (const r of [proto, app]) {
	console.log('');
	console.log(`${r.title} (${r.id}, task ${r.task}), passcode ${r.passcode}`);
	console.log(`note: preview ${r.link}`);
}
console.log('');
console.log('Ana and Ben have left comments on both. Close a review with:');
console.log(
	`  WH_REVIEW_STATE=${dir} node ${path.join(here, '..', 'review', 'main.mjs')} close <id>`
);
console.log(
	'or from Wheelhouse, started with WH_REVIEW_STATE set to that folder. Ctrl-C stops the demo.'
);

const stop = async () => {
	await desk.stop();
	live.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
