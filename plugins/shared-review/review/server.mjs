/**
 * The review server: holds reviews, reviewers' sessions and their comments,
 * and serves each review's prototype to signed-in reviewers only.
 *
 * Its own pages and APIs live under /_review/; every other path is the
 * prototype of the review the browser last opened (the `wr_cur` cookie), so a
 * prototype or dev server that uses absolute paths (`/assets/app.js`,
 * `/@vite/client`) works unchanged. Nothing outside /_review/ answers
 * without a signed-in session for an open review.
 *
 *   /_review/<rid>                 the share link: sign in, then the review page
 *   /_review/<rid>/api/…           the review page's comments and their attachments (reviewer session)
 *   /_review/api/…                 the owner's API (Authorization: Bearer <owner token>)
 *   /_review/health                for health checks
 *   anything else                  the current review's prototype (static files, or a live app through its tunnel)
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
	createReadStream
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BASE_HEADERS,
	HttpError,
	RateLimiter,
	VERSION,
	checkPasscode,
	cookie,
	cookies,
	hashPasscode,
	newPasscode,
	normalPasscode,
	randomId,
	readBody,
	readForm,
	readJson,
	readJsonFile,
	readStart,
	sameSecret,
	sendHtml,
	sendJson,
	sha256,
	sign,
	tidy,
	writeJsonFile
} from './lib.mjs';
import { LIMITS, attachmentHeaders, mb, readUpload } from './attachments.mjs';
import {
	MAX_COMMENTS,
	bundle,
	invited,
	readComment,
	readEdit,
	readEmail,
	readImported,
	readInvitees,
	readName
} from './comments.mjs';
import { message, address } from './mail.mjs';
import {
	closedPage,
	magicPage,
	nothingPage,
	offlinePage,
	shellPage,
	signInPage
} from './pages.mjs';
import { MAX_ANSWER, MAX_REQUEST, TunnelBroker, requestHeaders } from './tunnel.mjs';

const ASSETS = fileURLToPath(new URL('./assets/', import.meta.url));
const RID = /^[A-Za-z0-9_-]{16,64}$/;
const AID = /^[\w-]{1,40}$/;
const SESSION_DAYS = 14;
const MAGIC_MINUTES = 15;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_SITE = 200 * 1024 * 1024;
const MAX_FILES = 5000;

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.wasm': 'application/wasm',
	'.pdf': 'application/pdf',
	'.xml': 'application/xml'
};

/** What a review is called on its pages and in the owner's lists. */
function readTitle(v) {
	const t = tidy(v, 120);
	return t || null;
}

/** A path inside a static site, made safe: no `..`, no hidden folders; null when it is not one. */
export function sitePath(raw) {
	let p;
	try {
		p = decodeURIComponent(raw);
	} catch {
		return null;
	}
	if (p.includes('\0') || p.includes('\\')) return null;
	const parts = p.split('/').filter(Boolean);
	if (parts.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return null;
	const joined = parts.join('/');
	return joined.length <= 400 ? joined : null;
}

/**
 * A prototype's own security policy with its `frame-ancestors` replaced:
 * `'self'` by default, so only its review page frames it.
 */
export function frameable(csp, ancestors = "'self'") {
	const kept = String(csp ?? '')
		.split(';')
		.map((d) => d.trim())
		.filter((d) => d && !/^frame-ancestors\b/i.test(d));
	return [...kept, `frame-ancestors ${ancestors}`].join('; ');
}

/**
 * Answer one GET or HEAD from a folder of static files: `index.html` for a
 * folder, and for a single-page app `index.html` for unknown paths without an
 * extension. Paths go through `sitePath`, so `..` and hidden files never
 * answer; `allowed(file)` can refuse more (a file outside the folder through
 * a link, say). `headers(type)` gives every answer's headers.
 */
export function sendSiteFile(req, res, { root, spa, url, headers, allowed = () => true }) {
	const method = req.method ?? 'GET';
	if (method !== 'GET' && method !== 'HEAD')
		throw new HttpError(405, 'A static prototype only answers GET.');
	const rel = sitePath(url.pathname);
	const pick = (p) => {
		const file = path.join(root, p);
		try {
			const st = statSync(file);
			if (st.isFile()) return allowed(file) ? { file, size: st.size } : null;
			if (st.isDirectory()) {
				const index = path.join(file, 'index.html');
				if (existsSync(index) && allowed(index)) return { file: index, size: statSync(index).size };
			}
		} catch {
			// not there
		}
		return null;
	};
	let hit = rel === null ? null : pick(rel);
	if (!hit && rel !== null && spa && !path.extname(rel)) hit = pick('index.html');
	if (!hit) {
		const body = 'Not found in this prototype.';
		res.writeHead(404, {
			...headers('text/plain; charset=utf-8'),
			'content-length': Buffer.byteLength(body)
		});
		return res.end(method === 'HEAD' ? undefined : body);
	}
	res.writeHead(200, {
		...headers(TYPES[path.extname(hit.file).toLowerCase()] ?? 'application/octet-stream'),
		'content-length': hit.size
	});
	if (method === 'HEAD') return res.end();
	createReadStream(hit.file).pipe(res);
}

export class ReviewServer {
	/**
	 * @param {{ dataDir: string, publicUrl: string, ownerToken: string, sessionSecret?: string,
	 *   mailer?: { kind: string, send: Function } | null, emailFrom?: string | null,
	 *   trustProxy?: boolean, service?: string, now?: () => number, log?: (s: string) => void }} o
	 */
	constructor(o) {
		if (!o.ownerToken || o.ownerToken.length < 24) {
			throw new Error('the owner token must be at least 24 characters');
		}
		this.o = o;
		this.public = new URL(o.publicUrl);
		this.secure = this.public.protocol === 'https:';
		this.now = o.now ?? (() => Date.now());
		this.log = o.log ?? ((s) => console.log(`${new Date(this.now()).toISOString()} ${s}`));
		this.limits = new RateLimiter(this.now);
		this.tunnel = new TunnelBroker(this.now);
		mkdirSync(o.dataDir, { recursive: true, mode: 0o700 });
		this.file = path.join(o.dataDir, 'state.json');
		this.state = readJsonFile(this.file, null) ?? {
			schema: 'shared-review.v1',
			reviews: {},
			sessions: {},
			magic: {}
		};
		this.secret = o.sessionSecret || this.loadSecret();
		this.sweep();
	}

	/** The session-signing secret: given, else made once and kept in the data folder. */
	loadSecret() {
		const file = path.join(this.o.dataDir, 'session-secret');
		if (existsSync(file)) return readFileSync(file, 'utf8').trim();
		const s = randomId(32);
		writeFileSync(file, s, { mode: 0o600 });
		return s;
	}

	save() {
		writeJsonFile(this.file, this.state);
	}

	/** Forget expired sessions and sign-in links. */
	sweep() {
		const now = this.now();
		for (const [k, s] of Object.entries(this.state.sessions))
			if (s.exp <= now) delete this.state.sessions[k];
		for (const [k, m] of Object.entries(this.state.magic))
			if (m.exp <= now) delete this.state.magic[k];
	}

	/** Sign-in methods this server can offer. */
	methods() {
		return this.o.mailer && this.o.emailFrom ? ['passcode', 'email'] : ['passcode'];
	}

	link(rid) {
		return new URL(`/_review/${rid}`, this.public).href;
	}

	siteDir(rid) {
		return path.join(this.o.dataDir, 'sites', rid);
	}

	/** Where a review's attachments are kept: removed when it closes. */
	uploadDir(rid) {
		return path.join(this.o.dataDir, 'uploads', rid);
	}

	uploadFile(rid, aid) {
		return path.join(this.uploadDir(rid), aid);
	}

	summary(r) {
		const people = [...new Set(r.comments.map((c) => c.author))];
		return {
			rid: r.rid,
			title: r.title,
			task: r.task,
			project: r.project,
			state: r.state,
			createdAt: r.createdAt,
			openedAt: r.openedAt ?? null,
			closedAt: r.closedAt ?? null,
			source: r.source,
			signIn: r.signIn,
			invitees: r.invitees,
			link: this.link(r.rid),
			comments: r.comments.length,
			people,
			lastAt: r.comments.length ? r.comments[r.comments.length - 1].at : null,
			connected: r.source.kind === 'live' ? this.tunnel.connected(r.rid) : null
		};
	}

	/**
	 * The client's address, for rate limits. Behind a proxy it trusts, the
	 * last X-Forwarded-For entry: the one the proxy itself added, which a
	 * client cannot forge the way it can write the first.
	 */
	ip(req) {
		if (this.o.trustProxy) {
			const f = String(req.headers['x-forwarded-for'] ?? '')
				.split(',')
				.map((x) => x.trim())
				.filter(Boolean)
				.pop();
			if (f) return f;
		}
		return req.socket.remoteAddress ?? 'unknown';
	}

	/** Refuse a change sent from another site's page. */
	sameOrigin(req) {
		const origin = req.headers.origin;
		if (!origin || origin === 'null') return;
		try {
			const o = new URL(origin);
			if (o.host === req.headers.host || o.origin === this.public.origin) return;
		} catch {
			// fall through
		}
		throw new HttpError(403, 'That came from another site.');
	}

	/* ------------------------------------------------------------ sessions */

	sessionCookie(rid) {
		return `wr_s_${rid}`;
	}

	newSession(res, rid, who) {
		const sid = randomId(24);
		this.state.sessions[sha256(sid).toString('base64url')] = {
			rid,
			name: who.name,
			email: who.email ?? null,
			at: new Date(this.now()).toISOString(),
			exp: this.now() + SESSION_DAYS * 86_400_000
		};
		this.save();
		res.setHeader('set-cookie', [
			cookie(this.sessionCookie(rid), `${sid}.${sign(this.secret, `${rid}.${sid}`)}`, {
				secure: this.secure,
				maxAge: SESSION_DAYS * 86_400
			}),
			cookie('wr_cur', rid, { secure: this.secure })
		]);
	}

	/** The signed-in reviewer for this review, or null. */
	session(req, rid) {
		const raw = cookies(req)[this.sessionCookie(rid)];
		if (!raw) return null;
		const dot = raw.lastIndexOf('.');
		if (dot < 1) return null;
		const sid = raw.slice(0, dot);
		if (!sameSecret(raw.slice(dot + 1), sign(this.secret, `${rid}.${sid}`))) return null;
		const s = this.state.sessions[sha256(sid).toString('base64url')];
		if (!s || s.rid !== rid || s.exp <= this.now()) return null;
		const r = this.state.reviews[rid];
		return r && r.state === 'open' ? { ...s, key: sha256(sid).toString('base64url') } : null;
	}

	/* --------------------------------------------------------------- HTTP */

	/** The request handler: `http.createServer(server.handle)`. */
	handle = async (req, res) => {
		try {
			const url = new URL(req.url ?? '/', 'http://review.invalid');
			const p = url.pathname;
			if (p === '/_review/health') {
				return sendJson(res, 200, {
					ok: true,
					service: this.o.service ?? 'wheelhouse-shared-review',
					version: VERSION
				});
			}
			if (p.startsWith('/_review/assets/'))
				return this.asset(res, p.slice('/_review/assets/'.length));
			if (p.startsWith('/_review/api/'))
				return await this.owner(req, res, p.slice('/_review/api/'.length));
			const m = /^\/_review\/([^/]+)(\/.*)?$/.exec(p);
			if (m && RID.test(m[1])) return await this.reviewer(req, res, m[1], m[2] ?? '', url);
			if (p === '/_review' || p.startsWith('/_review/')) return sendHtml(res, 404, nothingPage());
			return await this.prototype(req, res, url);
		} catch (e) {
			const status = e instanceof HttpError ? e.status : 500;
			if (status === 500) this.log(`error: ${e instanceof Error ? e.message : String(e)}`);
			if (res.headersSent) return res.end();
			const wantsJson =
				String(req.url).startsWith('/_review/api/') ||
				/\/api\//.test(String(req.url).split('?')[0]);
			if (wantsJson)
				return sendJson(res, status, {
					error: status === 500 ? 'Something went wrong.' : e.message
				});
			return sendHtml(res, status, nothingPage());
		}
	};

	asset(res, name) {
		if (!/^[a-z][a-z0-9-]*\.(js|css)$/.test(name)) return sendHtml(res, 404, nothingPage());
		const file = path.join(ASSETS, name);
		if (!existsSync(file)) return sendHtml(res, 404, nothingPage());
		const body = readFileSync(file);
		res.writeHead(200, {
			...BASE_HEADERS,
			'content-type': TYPES[path.extname(name)],
			'cache-control': 'no-cache',
			'content-length': body.length
		});
		res.end(body);
	}

	/* ------------------------------------------------------- reviewer side */

	async reviewer(req, res, rid, rest, url) {
		const r = this.state.reviews[rid];
		const open = r && r.state === 'open';
		const method = req.method ?? 'GET';
		if (rest.startsWith('/api/')) {
			const s = open ? this.session(req, rid) : null;
			if (!s) return sendJson(res, 401, { error: 'Sign in again.' });
			return this.reviewerApi(req, res, r, s, rest.slice(5), url);
		}
		if (!open) return sendHtml(res, 404, closedPage());
		const back = () => {
			res.writeHead(303, {
				...BASE_HEADERS,
				location: `/_review/${rid}`,
				'cache-control': 'no-store'
			});
			res.end();
		};
		if (rest === '' || rest === '/') {
			if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Not here.');
			const s = this.session(req, rid);
			if (!s) return sendHtml(res, 200, signInPage({ rid, title: r.title, methods: r.signIn }));
			return sendHtml(
				res,
				200,
				shellPage({ rid, title: r.title, name: s.name, start: r.source.start ?? '/' }),
				{
					'set-cookie': cookie('wr_cur', rid, { secure: this.secure })
				}
			);
		}
		if (rest === '/enter') {
			const s = this.session(req, rid);
			if (!s) return back();
			res.writeHead(302, {
				...BASE_HEADERS,
				location: r.source.start ?? '/',
				'cache-control': 'no-store',
				'set-cookie': cookie('wr_cur', rid, { secure: this.secure })
			});
			return res.end();
		}
		if (rest === '/signin' && method === 'POST') return this.signIn(req, res, r);
		if (rest === '/magic') {
			if (method === 'POST') return this.magic(req, res, r);
			return sendHtml(res, 200, magicPage({ rid, title: r.title }));
		}
		if (rest === '/signout' && method === 'POST') {
			this.sameOrigin(req);
			const s = this.session(req, rid);
			if (s) {
				delete this.state.sessions[s.key];
				this.save();
			}
			res.setHeader(
				'set-cookie',
				cookie(this.sessionCookie(rid), '', { secure: this.secure, maxAge: 0 })
			);
			return back();
		}
		return sendHtml(res, 404, nothingPage());
	}

	async signIn(req, res, r) {
		this.sameOrigin(req);
		const f = await readForm(req);
		const page = (status, o) =>
			sendHtml(
				res,
				status,
				signInPage({ rid: r.rid, title: r.title, methods: r.signIn, name: f.name ?? '', ...o })
			);
		const name = readName(f.name);
		if (!name)
			return page(400, { error: 'Tell the others who you are: your name, up to 60 characters.' });
		const ip = this.ip(req);
		if (f.method === 'passcode' && r.signIn.includes('passcode')) {
			const mine = `pc:${r.rid}:${ip}`;
			const all = `pc:${r.rid}`;
			// Count the try before checking it, so tries sent at once cannot all slip under the limit.
			const okMine = this.limits.hit(mine, 5, 15 * 60_000);
			const okAll = this.limits.hit(all, 30, 15 * 60_000);
			if (!okMine || !okAll) {
				return page(429, { error: 'Too many tries. Wait a few minutes, then try again.' });
			}
			if (!(await checkPasscode(r.passcode, f.passcode))) {
				return page(401, { error: 'That passcode is not right.' });
			}
			this.limits.reset(mine);
			this.limits.refund(all);
			this.newSession(res, r.rid, { name });
			this.log(`signed in to ${r.rid.slice(0, 6)}… by passcode`);
			res.writeHead(303, {
				...BASE_HEADERS,
				location: `/_review/${r.rid}`,
				'cache-control': 'no-store'
			});
			return res.end();
		}
		if (f.method === 'email' && r.signIn.includes('email')) {
			const email = readEmail(f.email);
			if (!email)
				return page(400, { error: 'That does not look like an email address.', email: f.email });
			const okIp = this.limits.hit(`em:${r.rid}:${ip}`, 5, 15 * 60_000);
			const okTo = this.limits.hit(`em:${email}`, 3, 15 * 60_000);
			if (!okIp || !okTo)
				return page(429, { error: 'Too many links asked for. Wait a few minutes.', email });
			if (invited(r.invitees, email)) await this.sendLink(r, name, email);
			return page(200, {
				email,
				notice: `If ${email} is invited to this review, a sign-in link is on its way. It works once, for ${MAGIC_MINUTES} minutes.`
			});
		}
		return page(400, { error: 'This review does not offer that way to sign in.' });
	}

	async sendLink(r, name, email) {
		const token = randomId(32);
		this.state.magic[sha256(token).toString('base64url')] = {
			rid: r.rid,
			name,
			email,
			exp: this.now() + MAGIC_MINUTES * 60_000
		};
		this.save();
		const from = this.o.emailFrom;
		const link = `${this.link(r.rid)}/magic#t=${token}`;
		const text = [
			`Hello ${name},`,
			'',
			`Here is your link to the prototype review "${r.title}":`,
			'',
			link,
			'',
			`It signs you in once, within ${MAGIC_MINUTES} minutes. If you did not ask for it, ignore this email.`
		].join('\n');
		try {
			await this.o.mailer.send({
				from: address(from),
				to: email,
				raw: message({
					from,
					to: email,
					subject: `Sign in to review: ${r.title}`,
					text,
					domain: this.public.hostname
				})
			});
			this.log(`sent a sign-in link for ${r.rid.slice(0, 6)}…`);
		} catch (e) {
			this.log(`could not send a sign-in link: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async magic(req, res, r) {
		this.sameOrigin(req);
		const f = await readForm(req);
		const key = sha256(String(f.token ?? '')).toString('base64url');
		const m = this.state.magic[key];
		if (!m || m.rid !== r.rid || m.exp <= this.now()) {
			return sendHtml(
				res,
				400,
				magicPage({
					rid: r.rid,
					title: r.title,
					error:
						'This link has expired or was used already. Open the review link to ask for a new one.'
				})
			);
		}
		// Single use: gone before the session exists.
		delete this.state.magic[key];
		this.newSession(res, r.rid, { name: m.name, email: m.email });
		this.log(`signed in to ${r.rid.slice(0, 6)}… by email link`);
		res.writeHead(303, {
			...BASE_HEADERS,
			location: `/_review/${r.rid}`,
			'cache-control': 'no-store'
		});
		res.end();
	}

	async reviewerApi(req, res, r, s, what, url) {
		const method = req.method ?? 'GET';
		const me = author(s);
		if (what === 'comments' && method === 'GET') {
			return sendJson(res, 200, {
				review: { title: r.title, state: r.state },
				me: { name: s.name },
				limits: {
					file: LIMITS.file,
					voice: LIMITS.voice,
					perComment: LIMITS.perComment,
					voiceSeconds: LIMITS.voiceSeconds
				},
				comments: r.comments.map((c) => publicComment(c, me))
			});
		}
		if (what === 'comments' && method === 'POST') {
			this.sameOrigin(req);
			if (!this.limits.hit(`cm:${s.key}`, 30, 60_000))
				throw new HttpError(429, 'Slow down a little.');
			const c = readComment(await readJson(req, 64 * 1024));
			if (!c.ok) throw new HttpError(400, c.error);
			if (r.comments.length >= MAX_COMMENTS)
				throw new HttpError(409, 'This review has as many comments as it can hold.');
			const parent = c.value.parent
				? r.comments.find((p) => p.id === c.value.parent && !p.parent)
				: null;
			const id = randomId(9);
			const comment = {
				id,
				author: s.name,
				email: s.email ?? null,
				by: me,
				at: new Date(this.now()).toISOString(),
				editedAt: null,
				body: c.value.body,
				parent: parent ? parent.id : null,
				anchor: parent ? parent.anchor : c.value.anchor,
				attachments: this.claim(r, me, c.value.attachments, id, [])
			};
			r.comments.push(comment);
			this.save();
			return sendJson(res, 201, { comment: publicComment(comment, me) });
		}
		const one = /^comments\/([\w-]{1,40})$/.exec(what);
		if (one && (method === 'PATCH' || method === 'DELETE')) {
			this.sameOrigin(req);
			if (!this.limits.hit(`cm:${s.key}`, 30, 60_000))
				throw new HttpError(429, 'Slow down a little.');
			const c = r.comments.find((x) => x.id === one[1]);
			if (!c) throw new HttpError(404, 'That comment is gone.');
			if (!c.by || c.by !== me)
				throw new HttpError(403, 'Only whoever wrote a comment can change it.');
			if (method === 'PATCH') {
				const e = readEdit(await readJson(req, 64 * 1024));
				if (!e.ok) throw new HttpError(400, e.error);
				const attachments = this.claim(r, me, e.value.attachments, c.id, c.attachments ?? []);
				if (!e.value.body && !attachments.length)
					throw new HttpError(400, 'Write something first, or delete the comment.');
				for (const a of c.attachments ?? [])
					if (!attachments.some((x) => x.id === a.id)) this.dropUpload(r, a.id);
				c.body = e.value.body;
				c.attachments = attachments;
				c.editedAt = new Date(this.now()).toISOString();
				this.save();
				return sendJson(res, 200, { comment: publicComment(c, me) });
			}
			const replies = r.comments.filter((x) => x.parent === c.id);
			if (replies.some((x) => x.by !== me))
				throw new HttpError(409, 'Others replied to this, so it stays; edit it instead.');
			this.removeComments(r, [c, ...replies]);
			this.save();
			return sendJson(res, 200, { ok: true, removed: [c.id, ...replies.map((x) => x.id)] });
		}
		if (what === 'attachments' && method === 'POST') {
			this.sameOrigin(req);
			return this.upload(req, res, r, s, me);
		}
		const att = /^attachments\/([\w-]{1,40})$/.exec(what);
		if (att && (method === 'GET' || method === 'HEAD')) {
			const u = r.uploads?.[att[1]];
			// Anyone in the review can open what is on a comment; only its uploader what is not yet.
			if (!u || u.missing || (!u.comment && u.by !== me))
				throw new HttpError(404, 'That attachment is gone.');
			return this.sendUpload(req, res, r, u);
		}
		if (att && method === 'DELETE') {
			this.sameOrigin(req);
			const u = r.uploads?.[att[1]];
			if (!u || u.by !== me || u.comment) throw new HttpError(404, 'That attachment is gone.');
			this.dropUpload(r, u.id);
			this.save();
			return sendJson(res, 200, { ok: true });
		}
		if (what === 'me' && method === 'GET') {
			return sendJson(res, 200, { name: s.name, current: cookies(req).wr_cur === r.rid });
		}
		if (what === 'current' && method === 'POST') {
			this.sameOrigin(req);
			return sendJson(
				res,
				200,
				{ ok: true },
				{ 'set-cookie': cookie('wr_cur', r.rid, { secure: this.secure }) }
			);
		}
		void url;
		throw new HttpError(404, 'Not here.');
	}

	/* -------------------------------------------------------- attachments */

	/** A reviewer's upload, kept until a comment takes it (or the review closes). */
	async upload(req, res, r, s, me) {
		if (!this.limits.hit(`up:${s.key}`, 20, 60_000))
			throw new HttpError(429, 'Slow down a little.');
		r.uploads ??= {};
		r.uploadBytes ??= 0;
		const voice = req.headers['x-voice-note'] === '1';
		const body = await readBody(req, voice ? LIMITS.voice : LIMITS.file);
		const u = readUpload({
			type: req.headers['content-type'],
			name: req.headers['x-file-name'],
			voice,
			seconds: req.headers['x-voice-seconds'],
			body
		});
		if (!u.ok) throw new HttpError(u.status, u.error);
		const pending = Object.values(r.uploads)
			.filter((x) => x.by === me && !x.comment)
			.sort((a, b) => a.at.localeCompare(b.at));
		for (const x of pending.slice(0, Math.max(0, pending.length - LIMITS.pending + 1)))
			this.dropUpload(r, x.id);
		if (r.uploadBytes + body.length > LIMITS.review)
			throw new HttpError(413, `This review holds at most ${mb(LIMITS.review)} of attachments.`);
		const id = randomId(9);
		mkdirSync(this.uploadDir(r.rid), { recursive: true, mode: 0o700 });
		writeFileSync(this.uploadFile(r.rid, id), body, { mode: 0o600 });
		r.uploads[id] = {
			id,
			...u.value,
			by: me,
			at: new Date(this.now()).toISOString(),
			comment: null
		};
		r.uploadBytes += body.length;
		this.save();
		return sendJson(res, 201, { attachment: { id, ...u.value } });
	}

	/**
	 * The attachments a comment ends up with: those it has already, and this
	 * reviewer's own uploads not on a comment yet. Anything else is refused.
	 */
	claim(r, me, ids, cid, current) {
		const out = [];
		for (const id of ids) {
			const have = current.find((a) => a.id === id);
			if (have) {
				out.push(have);
				continue;
			}
			const u = r.uploads?.[id];
			if (!u || u.by !== me || u.comment || u.missing)
				throw new HttpError(400, 'One of those attachments is gone; add it again.');
			out.push(attachmentOf(u));
		}
		if (out.length > LIMITS.perComment)
			throw new HttpError(400, `A comment holds at most ${LIMITS.perComment} attachments.`);
		for (const a of out) if (r.uploads?.[a.id]) r.uploads[a.id].comment = cid;
		return out;
	}

	dropUpload(r, id) {
		const u = r.uploads?.[id];
		if (!u) return;
		rmSync(this.uploadFile(r.rid, id), { force: true });
		r.uploadBytes = Math.max(0, (r.uploadBytes ?? 0) - (u.missing ? 0 : u.size));
		delete r.uploads[id];
	}

	/** Remove comments and their attachments. */
	removeComments(r, list) {
		const ids = new Set(list.map((c) => c.id));
		for (const c of list) for (const a of c.attachments ?? []) this.dropUpload(r, a.id);
		r.comments = r.comments.filter((c) => !ids.has(c.id));
	}

	sendUpload(req, res, r, u) {
		const file = this.uploadFile(r.rid, u.id);
		if (!existsSync(file)) throw new HttpError(404, 'That attachment is gone.');
		res.writeHead(200, {
			...BASE_HEADERS,
			...attachmentHeaders(u),
			'content-length': u.size
		});
		if (req.method === 'HEAD') return res.end();
		createReadStream(file).pipe(res);
	}

	/* ---------------------------------------------------------- prototype */

	async prototype(req, res, url) {
		const rid = cookies(req).wr_cur;
		const r = rid && RID.test(rid) ? this.state.reviews[rid] : null;
		if (!r || r.state !== 'open' || !this.session(req, rid))
			return sendHtml(res, 404, nothingPage());
		if (r.source.kind === 'static') return this.staticFile(req, res, r, url);
		return this.live(req, res, r, url);
	}

	protoHeaders(type, csp) {
		return {
			...BASE_HEADERS,
			'content-type': type,
			'cache-control': 'no-store',
			'content-security-policy': frameable(csp)
		};
	}

	staticFile(req, res, r, url) {
		return sendSiteFile(req, res, {
			root: this.siteDir(r.rid),
			spa: r.source.spa,
			url,
			headers: (type) => this.protoHeaders(type)
		});
	}

	async live(req, res, r, url) {
		if (!this.tunnel.connected(r.rid)) return sendHtml(res, 502, offlinePage(r.title));
		const method = req.method ?? 'GET';
		const body =
			method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, MAX_REQUEST);
		const origin = `${this.secure ? 'https' : 'http'}://${req.headers.host ?? this.public.host}`;
		const answer = await this.tunnel.request(r.rid, {
			method,
			path: url.pathname + url.search,
			headers: requestHeaders(req.headers),
			body: body.length ? body.toString('base64') : null,
			origin
		});
		if (answer.error) {
			return answer.status === 410
				? sendHtml(res, 404, closedPage())
				: sendHtml(res, 502, offlinePage(r.title));
		}
		const headers = {};
		const cookiesOut = [];
		let csp = null;
		for (const [k, v] of answer.headers ?? []) {
			if (k === 'set-cookie') cookiesOut.push(v);
			else if (k === 'content-security-policy') csp = v;
			else if (k === 'x-frame-options' || k === 'content-length') continue;
			else headers[k] = v;
		}
		const out = Buffer.from(answer.body ?? '', 'base64');
		res.writeHead(answer.status >= 100 && answer.status < 600 ? answer.status : 502, {
			...headers,
			...this.protoHeaders(headers['content-type'] ?? 'application/octet-stream', csp),
			'x-content-type-options': headers['x-content-type-options'] ?? 'nosniff',
			...(cookiesOut.length ? { 'set-cookie': cookiesOut } : {}),
			'content-length': out.length
		});
		res.end(method === 'HEAD' ? undefined : out);
	}

	/* ------------------------------------------------------------ owner API */

	async owner(req, res, rest) {
		const ip = this.ip(req);
		if (this.limits.blocked(`own:${ip}`, 20)) throw new HttpError(429, 'Too many tries.');
		const auth = String(req.headers.authorization ?? '');
		const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
		if (!sameSecret(token, this.o.ownerToken)) {
			this.limits.hit(`own:${ip}`, 20, 60_000);
			throw new HttpError(401, 'The owner token is missing or wrong.');
		}
		const method = req.method ?? 'GET';
		if (rest === 'info' && method === 'GET') {
			return sendJson(res, 200, {
				service: this.o.service ?? 'wheelhouse-shared-review',
				version: VERSION,
				publicUrl: this.public.origin,
				signIn: this.methods()
			});
		}
		if (rest === 'reviews' && method === 'GET') {
			this.sweep();
			return sendJson(res, 200, {
				reviews: Object.values(this.state.reviews).map((r) => this.summary(r))
			});
		}
		if (rest === 'reviews' && method === 'POST')
			return this.create(res, await readJson(req, 4 * 1024 * 1024));
		const m = /^reviews\/([^/]+)(?:\/(.*))?$/.exec(rest);
		const r = m && RID.test(m[1]) ? this.state.reviews[m[1]] : null;
		if (!r) throw new HttpError(404, 'No such review.');
		const sub = m[2] ?? '';
		if (sub === '' && method === 'GET')
			return sendJson(res, 200, { review: this.summary(r), comments: r.comments });
		if (sub === '' && method === 'DELETE') {
			this.close(r);
			delete this.state.reviews[r.rid];
			this.save();
			return sendJson(res, 200, { ok: true });
		}
		if (sub.startsWith('files/') && method === 'PUT')
			return this.putFile(req, res, r, sub.slice(6));
		const oc = /^comments\/([\w-]{1,40})$/.exec(sub);
		if (oc && method === 'DELETE') {
			// The owner may take any comment off, with its replies.
			if (r.state !== 'open') throw new HttpError(409, 'That review is closed.');
			const c = r.comments.find((x) => x.id === oc[1]);
			if (!c) throw new HttpError(404, 'That comment is gone.');
			const list = [c, ...r.comments.filter((x) => x.parent === c.id)];
			this.removeComments(r, list);
			this.save();
			return sendJson(res, 200, { ok: true, removed: list.map((x) => x.id) });
		}
		const oa = /^attachments\/([\w-]{1,40})$/.exec(sub);
		if (oa && method === 'GET') {
			const u = r.uploads?.[oa[1]];
			if (!u || u.missing || r.state === 'closed')
				throw new HttpError(404, 'That attachment is gone.');
			return this.sendUpload(req, res, r, u);
		}
		if (oa && method === 'PUT') return this.putUpload(req, res, r, oa[1]);
		if (sub === 'open' && method === 'POST') {
			if (r.state === 'draft') {
				r.state = 'open';
				r.openedAt = new Date(this.now()).toISOString();
				this.save();
				this.log(`opened ${r.rid.slice(0, 6)}…`);
			}
			return sendJson(res, 200, { review: this.summary(r) });
		}
		if (sub === 'close' && method === 'POST') {
			this.close(r);
			this.save();
			return sendJson(res, 200, {
				review: this.summary(r),
				comments: r.comments,
				bundle: bundle({ ...r, id: r.rid }, r.comments, { link: this.link(r.rid) })
			});
		}
		if (sub === 'tunnel/next' && method === 'GET') {
			if (r.source.kind !== 'live' || r.state === 'closed')
				throw new HttpError(410, 'The review closed.');
			const ac = new AbortController();
			res.on('close', () => ac.abort());
			const job = await this.tunnel.next(r.rid, ac.signal);
			if (res.writableEnded || res.destroyed) {
				// The connector went away: give the request to the next one.
				if (job) this.tunnel.queued.set(r.rid, [job, ...(this.tunnel.queued.get(r.rid) ?? [])]);
				return;
			}
			if (!job) {
				res.writeHead(204, { 'cache-control': 'no-store' });
				return res.end();
			}
			return sendJson(res, 200, job);
		}
		const a = /^tunnel\/answer\/([\w-]{1,40})$/.exec(sub);
		if (a && method === 'POST') {
			const v = await readJson(req, Math.ceil(MAX_ANSWER * 1.4));
			const answer = {
				status: Number.isInteger(v.status) ? v.status : 502,
				headers: Array.isArray(v.headers)
					? v.headers.filter(
							(h) =>
								Array.isArray(h) &&
								typeof h[0] === 'string' &&
								typeof h[1] === 'string' &&
								!/[\r\n]/.test(h[0] + h[1])
						)
					: [],
				body: typeof v.body === 'string' ? v.body : '',
				error: typeof v.error === 'string' ? v.error : null
			};
			return this.tunnel.answer(r.rid, a[1], answer)
				? sendJson(res, 200, { ok: true })
				: sendJson(res, 404, { error: 'Nothing waits for that.' });
		}
		throw new HttpError(404, 'Not here.');
	}

	async create(res, body) {
		const title = readTitle(body.title);
		if (!title) throw new HttpError(400, 'Give the review a title.');
		const src = typeof body.source === 'object' && body.source !== null ? body.source : {};
		if (src.kind !== 'static' && src.kind !== 'live')
			throw new HttpError(400, 'The source is static files or a live app.');
		const start = readStart(src.start);
		const wanted = Array.isArray(body.signIn) && body.signIn.length ? body.signIn : ['passcode'];
		const offered = this.methods();
		const signIn = [];
		for (const m of wanted) {
			if (m !== 'passcode' && m !== 'email')
				throw new HttpError(400, 'Sign-in is by passcode or email.');
			if (!offered.includes(m))
				throw new HttpError(
					400,
					'This server cannot send email, so it offers passcode sign-in only.'
				);
			if (!signIn.includes(m)) signIn.push(m);
		}
		const invitees = readInvitees(body.invitees ?? []);
		if (invitees === null)
			throw new HttpError(400, 'Invite email addresses, or @example.com for a whole domain.');
		if (signIn.includes('email') && !invitees.length)
			throw new HttpError(400, 'Email sign-in needs at least one invited address or domain.');
		let passcode = null;
		let hashed = null;
		if (signIn.includes('passcode')) {
			passcode = body.passcode ? String(body.passcode) : newPasscode();
			if (normalPasscode(passcode).length < 8)
				throw new HttpError(400, 'A passcode needs at least 8 letters or digits.');
			hashed = await hashPasscode(passcode);
		}
		const rid = randomId(16);
		const now = new Date(this.now()).toISOString();
		const r = {
			rid,
			title,
			task: typeof body.task === 'string' ? tidy(body.task, 160) || null : null,
			project: typeof body.project === 'string' ? tidy(body.project, 160) || null : null,
			state: src.kind === 'static' ? 'draft' : 'open',
			createdAt: now,
			openedAt: src.kind === 'static' ? null : now,
			closedAt: null,
			source: { kind: src.kind, spa: src.kind === 'static' && src.spa === true, start },
			signIn,
			invitees,
			passcode: hashed,
			files: { count: 0, bytes: 0 },
			comments: readImported(body.comments),
			uploads: {},
			uploadBytes: 0
		};
		// Attachments brought in with comments wait for their bytes (putUpload).
		for (const c of r.comments) {
			for (const a of c.attachments) {
				r.uploads[a.id] = { ...a, by: c.by, at: c.at, comment: c.id, missing: true };
				r.uploadBytes += a.size;
			}
		}
		if (r.uploadBytes > LIMITS.review)
			throw new HttpError(413, `A review holds at most ${mb(LIMITS.review)} of attachments.`);
		this.state.reviews[rid] = r;
		this.save();
		this.log(`created ${rid.slice(0, 6)}… (${src.kind})`);
		return sendJson(res, 201, { review: this.summary(r), passcode, link: this.link(rid) });
	}

	async putFile(req, res, r, raw) {
		if (r.source.kind !== 'static' || r.state === 'closed')
			throw new HttpError(409, 'This review takes no files.');
		const rel = sitePath(raw);
		if (!rel) throw new HttpError(400, 'That is not a file path a site can have.');
		if (r.files.count >= MAX_FILES)
			throw new HttpError(413, `A prototype holds at most ${MAX_FILES} files.`);
		const body = await readBody(req, MAX_FILE);
		if (r.files.bytes + body.length > MAX_SITE)
			throw new HttpError(413, 'The prototype is too large.');
		const file = path.join(this.siteDir(r.rid), rel);
		mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
		writeFileSync(file, body, { mode: 0o600 });
		r.files.count++;
		r.files.bytes += body.length;
		this.save();
		return sendJson(res, 200, { ok: true });
	}

	/** The bytes of an attachment the owner brought in with its comment (a review going live). */
	async putUpload(req, res, r, aid) {
		const u = AID.test(aid) ? r.uploads?.[aid] : null;
		if (!u || !u.missing || r.state === 'closed')
			throw new HttpError(409, 'No comment waits for that attachment.');
		const body = await readBody(req, u.kind === 'voice' ? LIMITS.voice : LIMITS.file);
		const check = readUpload({ type: u.type, name: u.name, voice: u.kind === 'voice', body });
		if (!check.ok || body.length !== u.size)
			throw new HttpError(400, 'Those bytes are not that attachment.');
		mkdirSync(this.uploadDir(r.rid), { recursive: true, mode: 0o700 });
		writeFileSync(this.uploadFile(r.rid, aid), body, { mode: 0o600 });
		delete u.missing;
		this.save();
		return sendJson(res, 200, { ok: true });
	}

	/**
	 * Close a review: its link, sessions, sign-in links, files and
	 * attachments go; its comments (naming their attachments) stay for the owner.
	 */
	close(r) {
		if (r.state !== 'closed') {
			r.state = 'closed';
			r.closedAt = new Date(this.now()).toISOString();
			this.log(`closed ${r.rid.slice(0, 6)}…`);
		}
		for (const [k, s] of Object.entries(this.state.sessions))
			if (s.rid === r.rid) delete this.state.sessions[k];
		for (const [k, m] of Object.entries(this.state.magic))
			if (m.rid === r.rid) delete this.state.magic[k];
		rmSync(this.siteDir(r.rid), { recursive: true, force: true });
		rmSync(this.uploadDir(r.rid), { recursive: true, force: true });
		r.uploads = {};
		r.uploadBytes = 0;
		this.tunnel.drop(r.rid);
	}
}

/** Who wrote a comment, as this server knows them: their email address, else their sign-in. Never shown. */
function author(s) {
	return s.email ? `e:${s.email}` : `s:${s.key}`;
}

/** What a comment keeps about one of its attachments. */
function attachmentOf(u) {
	return {
		id: u.id,
		name: u.name,
		type: u.type,
		size: u.size,
		kind: u.kind,
		seconds: u.seconds ?? null
	};
}

/** A comment as reviewers see it: never anyone's email address or sign-in; `mine` for its author. */
function publicComment(c, me) {
	return {
		id: c.id,
		author: c.author,
		at: c.at,
		editedAt: c.editedAt ?? null,
		body: c.body,
		parent: c.parent,
		general: !c.anchor,
		anchor: c.anchor,
		attachments: (c.attachments ?? []).map((a) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			size: a.size,
			kind: a.kind,
			seconds: a.seconds ?? null
		})),
		mine: !!c.by && c.by === me
	};
}
