/**
 * Live apps. A worker's dev server runs on its owner's computer, which the
 * review server usually cannot reach, so the owner's side connects out to the
 * server instead: a connector keeps a few long-polls open on the review's
 * tunnel (owner token required), takes each reviewer request the server hands
 * it, asks the dev server on loopback, and posts the answer back. It works
 * through any proxy or ingress, since it is plain HTTPS from the owner's side.
 *
 * Requests and answers are whole (no streaming, no WebSockets), which suits
 * a prototype; a dev server's hot reload does not reach reviewers, who reload.
 */

import { randomId } from './lib.mjs';

export const MAX_REQUEST = 8 * 1024 * 1024;
export const MAX_ANSWER = 24 * 1024 * 1024;
const POLL_MS = 25_000;
const ANSWER_MS = 30_000;
/** A connector that has not polled for this long counts as gone. */
const GONE_MS = 45_000;

const HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'proxy-connection',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'host',
	'content-length'
]);

/** A reviewer's request headers as the dev server gets them: no hop-by-hop ones, no review cookies. */
export function requestHeaders(raw) {
	const out = [];
	for (const [k, v] of Object.entries(raw)) {
		const key = k.toLowerCase();
		if (HOP.has(key) || key === 'accept-encoding' || key.startsWith('x-forwarded-')) continue;
		const values = Array.isArray(v) ? v : [v];
		for (const value of values) {
			if (value === undefined) continue;
			if (key === 'cookie') {
				// The review's own cookies (sessions) never leave the review server.
				const kept = String(value)
					.split(';')
					.map((p) => p.trim())
					.filter((p) => p && !/^wr_/.test(p))
					.join('; ');
				if (kept) out.push(['cookie', kept]);
				continue;
			}
			out.push([key, String(value)]);
		}
	}
	return out;
}

/** The server side: reviewer requests wait here until a connector takes them. */
export class TunnelBroker {
	constructor(now = () => Date.now()) {
		this.now = now;
		/** rid → requests no connector has taken yet */
		this.queued = new Map();
		/** rid → connectors' parked polls */
		this.polls = new Map();
		/** request id → { rid, resolve, timer } */
		this.open = new Map();
		/** rid → when a connector last asked */
		this.seen = new Map();
	}

	/** Whether a connector has asked for work lately. */
	connected(rid) {
		return (
			(this.polls.get(rid)?.length ?? 0) > 0 ||
			this.now() - (this.seen.get(rid) ?? -Infinity) < GONE_MS
		);
	}

	/** Hand a reviewer's request to the review's connector, and wait for the answer. */
	request(rid, job) {
		return new Promise((resolve) => {
			const id = randomId(9);
			const timer = setTimeout(() => {
				this.open.delete(id);
				const q = this.queued.get(rid);
				if (q)
					this.queued.set(
						rid,
						q.filter((j) => j.id !== id)
					);
				resolve({ status: 504, error: 'The live app did not answer in time.' });
			}, ANSWER_MS);
			this.open.set(id, { rid, resolve, timer });
			const full = { id, ...job };
			const poll = this.polls.get(rid)?.shift();
			if (poll) poll(full);
			else this.queued.set(rid, [...(this.queued.get(rid) ?? []), full]);
		});
	}

	/** A connector's long-poll: the next request, or null after a while with none. */
	next(rid, signal) {
		this.seen.set(rid, this.now());
		const q = this.queued.get(rid);
		if (q?.length) return Promise.resolve(q.shift());
		return new Promise((resolve) => {
			const done = (job) => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', gone);
				this.seen.set(rid, this.now());
				resolve(job);
			};
			const gone = () => {
				const list = this.polls.get(rid) ?? [];
				this.polls.set(
					rid,
					list.filter((p) => p !== done)
				);
				done(null);
			};
			const timer = setTimeout(gone, POLL_MS);
			signal?.addEventListener('abort', gone, { once: true });
			this.polls.set(rid, [...(this.polls.get(rid) ?? []), done]);
		});
	}

	/** A connector's answer to one request; false when nothing waits for it. */
	answer(rid, id, value) {
		const o = this.open.get(id);
		if (!o || o.rid !== rid) return false;
		this.open.delete(id);
		clearTimeout(o.timer);
		o.resolve(value);
		return true;
	}

	/** The review closed: refuse what waits, and let its connectors go. */
	drop(rid) {
		for (const [id, o] of this.open) {
			if (o.rid !== rid) continue;
			clearTimeout(o.timer);
			this.open.delete(id);
			o.resolve({ status: 410, error: 'The review closed.' });
		}
		for (const p of this.polls.get(rid) ?? []) p(null);
		this.polls.delete(rid);
		this.queued.delete(rid);
		this.seen.delete(rid);
	}
}

/** Answer headers a reviewer gets from the dev server: no hop-by-hop ones, no review cookies, no Domain. */
export function answerHeaders(headers, upstream) {
	const out = [];
	const origin = new URL(upstream).origin;
	headers.forEach((value, key) => {
		const k = key.toLowerCase();
		if (HOP.has(k) || k === 'content-encoding' || k === 'set-cookie') return;
		if (k === 'location' && value.startsWith(origin)) {
			out.push([k, value.slice(origin.length) || '/']);
			return;
		}
		out.push([k, value]);
	});
	for (const c of headers.getSetCookie?.() ?? []) {
		if (/^\s*wr_/i.test(c)) continue;
		out.push(['set-cookie', c.replace(/;\s*domain=[^;]*/gi, '')]);
	}
	return out;
}

/** Ask the dev server at `upstream` (loopback) for one reviewer request. */
export async function askUpstream(upstream, job, fetchImpl = fetch) {
	const base = new URL(upstream);
	const url = new URL(job.path, base);
	if (url.origin !== base.origin) return { status: 400, headers: [], body: '' };
	const headers = new Headers();
	for (const [k, v] of job.headers ?? []) {
		// The reviewer's browser named the review server; the dev server expects its own address.
		const value =
			job.origin && (k === 'origin' || k === 'referer') && v.startsWith(job.origin)
				? base.origin + v.slice(job.origin.length)
				: v;
		try {
			headers.append(k, value);
		} catch {
			// A header fetch will not send; leave it out.
		}
	}
	const body = job.body ? Buffer.from(job.body, 'base64') : undefined;
	let r;
	try {
		r = await fetchImpl(url, {
			method: job.method,
			headers,
			body: job.method === 'GET' || job.method === 'HEAD' ? undefined : body,
			redirect: 'manual',
			signal: AbortSignal.timeout(ANSWER_MS - 2_000)
		});
	} catch {
		return { status: 502, headers: [], body: '', error: 'The live app did not answer.' };
	}
	const buf = Buffer.from(await r.arrayBuffer());
	if (buf.length > MAX_ANSWER) {
		return { status: 502, headers: [], body: '', error: 'The live app answered with too much.' };
	}
	return {
		status: r.status,
		headers: answerHeaders(r.headers, upstream),
		body: buf.toString('base64')
	};
}

/**
 * The owner's side: keeps `lanes` long-polls open on one review's tunnel and
 * answers each request from `upstream`. Stops when the review is gone.
 */
export class Connector {
	constructor({ server, token, rid, upstream, lanes = 4, fetchImpl = fetch, onState = () => {} }) {
		Object.assign(this, { server, token, rid, upstream, lanes, fetchImpl, onState });
		this.stopped = false;
		this.controller = new AbortController();
	}

	start() {
		for (let i = 0; i < this.lanes; i++) void this.lane();
		return this;
	}

	stop() {
		this.stopped = true;
		this.controller.abort();
	}

	async lane() {
		const base = `${this.server.replace(/\/$/, '')}/_review/api/reviews/${this.rid}/tunnel`;
		const auth = { authorization: `Bearer ${this.token}` };
		let wait = 500;
		while (!this.stopped) {
			let job = null;
			try {
				const r = await this.fetchImpl(`${base}/next`, {
					headers: auth,
					signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(POLL_MS + 10_000)])
				});
				if (r.status === 404 || r.status === 410) {
					this.onState('gone');
					this.stop();
					return;
				}
				if (r.status === 200) job = await r.json();
				else if (r.status !== 204) throw new Error(`status ${r.status}`);
				wait = 500;
				this.onState('connected');
			} catch {
				if (this.stopped) return;
				this.onState('retrying');
				await new Promise((r) => setTimeout(r, wait));
				wait = Math.min(wait * 2, 5_000);
				continue;
			}
			if (!job) continue;
			const answer = await askUpstream(this.upstream, job, this.fetchImpl);
			try {
				await this.fetchImpl(`${base}/answer/${job.id}`, {
					method: 'POST',
					headers: { ...auth, 'content-type': 'application/json' },
					body: JSON.stringify(answer),
					signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(ANSWER_MS)])
				});
			} catch {
				// The reviewer gets a timeout; the next poll carries on.
			}
		}
	}
}
