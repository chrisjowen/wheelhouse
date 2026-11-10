/**
 * Peeks: the live thumbnail of a review the plugin's pages draw, served by the
 * desk on this computer, from the review's own source (its folder of static
 * files, or the live app on loopback) rather than from a review server, so it
 * needs no reviewer session and works whether the review is local or live.
 *
 * Each open review that is peeked at gets a port of its own on loopback, so
 * its prototype sits at that origin's root and absolute paths work, as they
 * do for reviewers. Nothing there answers without a peek session:
 *
 * - the plugin's page asks the desk, with the desk key, for a ticket, naming
 *   the page's own origin (Wheelhouse, on this computer);
 * - the frame opens `/_review/peek/<ticket>` once: the ticket works once,
 *   for two minutes, and swaps itself for a session cookie (HttpOnly,
 *   SameSite=Lax) on the same host name as Wheelhouse, so the frame is
 *   same-site and its cookie is sent;
 * - every answer allows framing by that one origin only.
 *
 * Tickets and sessions live in memory: a desk that restarts forgets them,
 * and closing a review closes its port.
 */

import { realpathSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BASE_HEADERS, HttpError, cookie, cookies, randomId, readBody, sha256 } from './lib.mjs';
import { frameable, sendSiteFile } from './server.mjs';
import { askUpstream, requestHeaders } from './tunnel.mjs';

const TICKET_MS = 2 * 60_000;
const SESSION_MS = 12 * 3_600_000;
const MAX_SESSIONS = 50;
const MAX_REQUEST = 1024 * 1024;
const PREFIX = '/_review/peek/';

/** The page's origin, when it is a page on this computer that a peek may be framed by. */
export function peekOrigin(origin) {
	let u;
	try {
		u = new URL(String(origin ?? ''));
	} catch {
		return null;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
	if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
	return u.origin;
}

/** A one-line page in the frame's place, framable by pages on this computer only, with no script. */
function sendNote(res, status, text) {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Preview</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:28px system-ui,sans-serif;color:#667;text-align:center;padding:2rem">${text}</body></html>`;
	res.writeHead(status, {
		...BASE_HEADERS,
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store',
		'content-security-policy':
			"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*",
		'content-length': Buffer.byteLength(html)
	});
	res.end(html);
}

export class Peeks {
	/** @param {{ log?: (s: string) => void, now?: () => number, fetchImpl?: typeof fetch }} o */
	constructor(o = {}) {
		this.log = o.log ?? (() => {});
		this.now = o.now ?? (() => Date.now());
		this.fetch = o.fetchImpl ?? fetch;
		/** review id → { server, port, rec, tickets: Map, sessions: Map } */
		this.ports = new Map();
	}

	/**
	 * A one-time address that opens `rec`'s peek in a frame on `origin`
	 * (the page asking), or null when that page cannot frame one.
	 */
	async ticket(rec, origin) {
		const from = peekOrigin(origin);
		if (!from) return null;
		const p = await this.port(rec);
		p.rec = rec;
		const t = randomId(24);
		const now = this.now();
		for (const [k, v] of p.tickets) if (v.exp <= now) p.tickets.delete(k);
		p.tickets.set(sha256(t).toString('base64url'), { origin: from, exp: now + TICKET_MS });
		return `http://${new URL(from).hostname}:${p.port}${PREFIX}${t}`;
	}

	port(rec) {
		const have = this.ports.get(rec.id);
		if (have) return have.ready;
		const p = { server: null, port: 0, rec, tickets: new Map(), sessions: new Map(), ready: null };
		p.server = http.createServer((req, res) => void this.handle(p, req, res));
		this.ports.set(rec.id, p);
		p.ready = new Promise((resolve, reject) => {
			p.server.once('error', reject);
			p.server.once('close', () => reject(new Error('The review was closed.')));
			p.server.listen(0, '127.0.0.1', resolve);
		}).then(
			() => {
				if (this.ports.get(rec.id) !== p) {
					p.server.close();
					throw new Error('The review was closed.');
				}
				p.port = p.server.address().port;
				return p;
			},
			(e) => {
				if (this.ports.get(rec.id) === p) this.ports.delete(rec.id);
				throw e;
			}
		);
		return p.ready;
	}

	/** Close a review's peek: its port, tickets and sessions. */
	close(id) {
		const p = this.ports.get(id);
		if (!p) return;
		this.ports.delete(id);
		p.server.closeAllConnections?.();
		p.server.close();
	}

	stop() {
		for (const id of [...this.ports.keys()]) this.close(id);
	}

	async handle(p, req, res) {
		try {
			await this.answer(p, req, res);
		} catch (e) {
			if (res.headersSent) return res.end();
			const status = e instanceof HttpError ? e.status : 500;
			if (status === 500) this.log(`peek error: ${e instanceof Error ? e.message : String(e)}`);
			sendNote(res, status, 'The preview could not be shown.');
		}
	}

	async answer(p, req, res) {
		const host = String(req.headers.host ?? '');
		if (![`127.0.0.1:${p.port}`, `localhost:${p.port}`].includes(host))
			throw new HttpError(421, 'Not this computer.');
		const url = new URL(req.url ?? '/', 'http://peek.invalid');
		const name = `wr_peek_${p.port}`;
		const now = this.now();

		if (url.pathname.startsWith(PREFIX)) {
			const key = sha256(url.pathname.slice(PREFIX.length)).toString('base64url');
			const t = p.tickets.get(key);
			p.tickets.delete(key);
			if (!t || t.exp <= now) {
				return sendNote(res, 403, 'This preview has expired. Reload the page.');
			}
			for (const [k, v] of p.sessions) if (v.exp <= now) p.sessions.delete(k);
			while (p.sessions.size >= MAX_SESSIONS) p.sessions.delete(p.sessions.keys().next().value);
			const sid = randomId(24);
			p.sessions.set(sha256(sid).toString('base64url'), {
				origin: t.origin,
				exp: now + SESSION_MS
			});
			res.writeHead(302, {
				...BASE_HEADERS,
				location: p.rec.source.start ?? '/',
				'cache-control': 'no-store',
				'set-cookie': cookie(name, sid, { maxAge: SESSION_MS / 1000 })
			});
			return res.end();
		}

		const sid = cookies(req)[name];
		const s = sid ? p.sessions.get(sha256(sid).toString('base64url')) : null;
		if (!s || s.exp <= now) return sendNote(res, 403, 'This preview has expired. Reload the page.');
		const frame = (csp) => frameable(csp, s.origin);

		const src = p.rec.source;
		if (src.kind === 'static') {
			let root;
			try {
				root = realpathSync(src.dir);
			} catch {
				return sendNote(res, 404, 'The prototype’s folder is gone.');
			}
			return sendSiteFile(req, res, {
				root,
				spa: src.spa,
				url,
				// What reviewers get: no node_modules, nothing reached through a link out of the folder.
				allowed: (file) => {
					if (file.split(path.sep).includes('node_modules')) return false;
					try {
						const real = realpathSync(file);
						return real === root || real.startsWith(root + path.sep);
					} catch {
						return false;
					}
				},
				headers: (type) => ({
					...BASE_HEADERS,
					'content-type': type,
					'cache-control': 'no-store',
					'content-security-policy': frame()
				})
			});
		}

		const method = req.method ?? 'GET';
		const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req, MAX_REQUEST);
		const origin = `http://${host}`;
		const answer = await askUpstream(
			src.url,
			{
				method,
				path: url.pathname + url.search,
				headers: requestHeaders(req.headers),
				body: body?.length ? body.toString('base64') : null,
				origin
			},
			this.fetch
		);
		if (answer.error) return sendNote(res, 502, 'The live app is not answering right now.');
		const headers = {};
		const setCookies = [];
		let csp = null;
		for (const [k, v] of answer.headers ?? []) {
			if (k === 'set-cookie') setCookies.push(v);
			else if (k === 'content-security-policy') csp = v;
			else if (k === 'x-frame-options' || k === 'content-length') continue;
			else headers[k] = v;
		}
		const out = Buffer.from(answer.body ?? '', 'base64');
		res.writeHead(answer.status >= 100 && answer.status < 600 ? answer.status : 502, {
			...headers,
			'cache-control': 'no-store',
			'content-security-policy': frame(csp),
			...(setCookies.length ? { 'set-cookie': setCookies } : {}),
			'content-length': out.length
		});
		res.end(method === 'HEAD' ? undefined : out);
	}
}
