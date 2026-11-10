/**
 * Small helpers the review server, the desk and the CLI share: random ids,
 * hashing and constant-time comparison, cookies, request bodies, JSON and
 * HTML answers, a fixed-window rate limiter and atomic JSON files. No
 * dependencies, so the review server is one folder that runs on Node 22.
 */

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const VERSION = '0.1.0';

/** `n` random bytes as base64url: 16 bytes make an unguessable 22-character id. */
export const randomId = (n = 16) => randomBytes(n).toString('base64url');

export const sha256 = (s) => createHash('sha256').update(s).digest();

/** Whether two secrets match, in time that does not depend on where they differ. */
export function sameSecret(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	return timingSafeEqual(sha256(a), sha256(b));
}

/** A keyed signature of `value`, base64url. */
export const sign = (secret, value) =>
	createHmac('sha256', secret).update(value).digest('base64url');

/** Characters a passcode is made of: no 0/o, 1/l/i, so it reads aloud and types cleanly. */
const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A passcode such as `k7mq-3xrt-h9pd` (about 59 bits). */
export function newPasscode() {
	const bytes = randomBytes(12);
	let s = '';
	for (let i = 0; i < 12; i++) s += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
	return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** A passcode as typed, compared without case, spaces or dashes. */
export const normalPasscode = (s) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/[\s-]+/g, '');

const scryptAsync = (pass, salt) =>
	new Promise((resolve, reject) =>
		scrypt(pass, salt, 32, (e, key) => (e ? reject(e) : resolve(key)))
	);

/** A passcode's salted hash, for keeping it without keeping it. */
export async function hashPasscode(passcode) {
	const salt = randomBytes(16);
	const key = await scryptAsync(normalPasscode(passcode), salt);
	return { salt: salt.toString('base64url'), hash: key.toString('base64url') };
}

/** Whether `typed` is the passcode `stored` was made from, compared in constant time. */
export async function checkPasscode(stored, typed) {
	if (!stored?.salt || !stored?.hash) return false;
	const key = await scryptAsync(normalPasscode(typed), Buffer.from(stored.salt, 'base64url'));
	const want = Buffer.from(stored.hash, 'base64url');
	return want.length === key.length && timingSafeEqual(want, key);
}

/** The request's cookies, by name. */
export function cookies(req) {
	const out = {};
	for (const part of String(req.headers.cookie ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		const k = part.slice(0, i).trim();
		if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
	}
	return out;
}

/** A Set-Cookie value: HttpOnly and SameSite=Lax always, Secure over https. */
export function cookie(name, value, o = {}) {
	const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (o.secure) parts.push('Secure');
	if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAge))}`);
	return parts.join('; ');
}

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** The request body, at most `max` bytes (413 beyond). */
export function readBody(req, max) {
	return new Promise((resolve, reject) => {
		const declared = Number(req.headers['content-length']);
		if (Number.isFinite(declared) && declared > max) {
			reject(new HttpError(413, 'That is too large.'));
			req.resume();
			return;
		}
		const chunks = [];
		let size = 0;
		req.on('data', (c) => {
			size += c.length;
			if (size > max) {
				reject(new HttpError(413, 'That is too large.'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/** The body as JSON (an object), or a 400. */
export async function readJson(req, max = 256 * 1024) {
	const type = String(req.headers['content-type'] ?? '');
	if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
	const raw = await readBody(req, max);
	try {
		const v = JSON.parse(raw.toString('utf8') || '{}');
		if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
		return v;
	} catch {
		throw new HttpError(400, 'That is not a JSON object.');
	}
}

/** An urlencoded form body, as a plain object of its first values. */
export async function readForm(req, max = 16 * 1024) {
	const raw = await readBody(req, max);
	const out = {};
	for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) if (!(k in out)) out[k] = v;
	return out;
}

/** Headers every answer carries: no indexing, no referrer leaving the site, no sniffing. */
export const BASE_HEADERS = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'same-origin',
	'x-robots-tag': 'noindex, nofollow'
};

export function sendJson(res, status, value, headers = {}) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		...BASE_HEADERS,
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(body),
		...headers
	});
	res.end(body);
}

/** Pages the server draws itself: no framing by anyone, scripts and styles only its own. */
export const PAGE_CSP =
	"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export function sendHtml(res, status, html, headers = {}) {
	res.writeHead(status, {
		...BASE_HEADERS,
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store',
		'content-security-policy': PAGE_CSP,
		'x-frame-options': 'DENY',
		'content-length': Buffer.byteLength(html),
		...headers
	});
	res.end(html);
}

/** Text made safe to put in HTML, as element text or a quoted attribute. */
export function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
}

/** Text folded to one line, without control characters, at most `max` characters. */
export function tidy(s, max) {
	const t = String(s ?? '')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return max && [...t].length > max
		? [...t]
				.slice(0, max - 1)
				.join('')
				.trimEnd() + '…'
		: t;
}

/** Multi-line text, without control characters other than line breaks, at most `max` characters. */
export function tidyText(s, max) {
	const t = String(s ?? '')
		.replace(/\r\n?/g, '\n')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return [...t].length > max ? null : t;
}

/**
 * At most `limit` hits per key in each `windowMs`. In memory: a restart
 * forgets it, which only gives a guesser a fresh window after the owner
 * restarts the server.
 */
export class RateLimiter {
	constructor(now = () => Date.now()) {
		this.now = now;
		this.hits = new Map();
	}

	/** Whether the key is over its limit, without counting a hit. */
	blocked(key, limit) {
		const h = this.hits.get(key);
		return !!h && h.until > this.now() && h.count >= limit;
	}

	/** Count a hit; true while the key is within its limit. */
	hit(key, limit, windowMs) {
		const now = this.now();
		let h = this.hits.get(key);
		if (!h || h.until <= now) {
			h = { count: 0, until: now + windowMs };
			this.hits.set(key, h);
		}
		h.count++;
		if (this.hits.size > 10_000) this.sweep();
		return h.count <= limit;
	}

	reset(key) {
		this.hits.delete(key);
	}

	/** Give back one hit (a try that turned out to be allowed). */
	refund(key) {
		const h = this.hits.get(key);
		if (h && h.count > 0) h.count--;
	}

	sweep() {
		const now = this.now();
		for (const [k, h] of this.hits) if (h.until <= now) this.hits.delete(k);
	}
}

/** A JSON file, or `fallback` when it is missing or unreadable. */
export function readJsonFile(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Write a JSON file through a temporary file, readable only by its owner. */
export function writeJsonFile(file, value) {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${randomId(4)}.tmp`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t') + '\n', { mode: 0o600 });
	renameSync(tmp, file);
}

/**
 * A path on the review's own site to open first, such as `/checkout?step=2`;
 * `/` for anything else, so it can never send a reviewer to another site
 * (`//host` or `/\\host`).
 */
export function readStart(v) {
	return typeof v === 'string' && /^\/(?![/\\])[^\s\\]{0,399}$/.test(v) ? v : '/';
}

/** Whether a URL's host is this computer (loopback). */
export function isLoopbackUrl(u) {
	try {
		const h = new URL(u).hostname;
		return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
	} catch {
		return false;
	}
}
