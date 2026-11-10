/**
 * The review desk: the owner's side, on this computer, that Wheelhouse
 * launches as the plugin's companion service (loopback only).
 *
 * - It runs a review server of its own on its port, for local previews: a
 *   review always starts here, reachable only from this computer.
 * - When a review server is configured (and the desk has its owner token),
 *   "go live" moves a review there, comments and all, and closes the local
 *   one: nothing goes live until someone asks for that.
 * - It keeps a connector open for every live app under review, so reviewers
 *   reach a worker's dev server through the review server and nowhere else.
 * - It serves each open review's live thumbnail for the plugin's pages, from
 *   the review's own source, on a loopback port of its own behind a one-time
 *   ticket the pages ask for with the desk key (see peek.mjs).
 * - It answers the plugin's pages and the CLI at /_review/desk/…, only with
 *   the desk key (kept in desk.json, readable only by you), from any page
 *   (CORS), since the key, not the page, is what lets a caller in.
 *
 * What it keeps, in its state folder (0700): desk.json (its address and
 * key), reviews.json (each review's task, link and passcode), bundles/ (each
 * closed review's comments) and local/ (its own review server's data).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachedWords } from './attachments.mjs';
import { OwnerClient } from './client.mjs';
import { bundle, feedbackList, markSent, readInvitees, readPoints, threadOf } from './comments.mjs';
import {
	HttpError,
	VERSION,
	isLoopbackUrl,
	randomId,
	readJson,
	readJsonFile,
	readStart,
	sameSecret,
	sendHtml,
	sendJson,
	tidy,
	writeJsonFile
} from './lib.mjs';
import { deskPage } from './pages.mjs';
import { Peeks } from './peek.mjs';
import { ReviewServer, sitePath } from './server.mjs';
import { Connector } from './tunnel.mjs';
import { DESK_SERVICE, stateDir } from './paths.mjs';

export { DESK_SERVICE, stateDir };

export const CLI = fileURLToPath(new URL('./main.mjs', import.meta.url));
const MAX_FILES = 5000;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_SITE = 200 * 1024 * 1024;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,159}$/;
const REMOTE_CHECK_MS = 30_000;

/** The running desk's record (address and key), or null. */
export function deskRecord(dir) {
	const v = readJsonFile(path.join(dir, 'desk.json'), null);
	return v && typeof v.url === 'string' && typeof v.key === 'string' ? v : null;
}

/**
 * A bundle with the points the captain sent in place of its comments (the
 * preview helper's summary, as edited), when there are any; the comments
 * themselves stay as they are.
 */
const withSummary = (b, rec) => (rec.summary ? { ...b, summary: rec.summary } : b);

/**
 * The files of a static prototype, as paths relative to `dir`: hidden files
 * and folders (.env, .git) and node_modules are left out, so they never
 * leave this computer.
 */
export function siteFiles(dir) {
	const out = [];
	let bytes = 0;
	const walk = (rel) => {
		for (const name of readdirSync(path.join(dir, rel)).sort()) {
			if (name.startsWith('.') || name === 'node_modules') continue;
			const r = rel ? `${rel}/${name}` : name;
			const st = statSync(path.join(dir, r));
			if (st.isDirectory()) walk(r);
			else if (st.isFile()) {
				if (!sitePath(r)) continue;
				if (st.size > MAX_FILE) throw new HttpError(413, `${r} is larger than 25 MB.`);
				bytes += st.size;
				out.push(r);
				if (out.length > MAX_FILES)
					throw new HttpError(413, `The folder has more than ${MAX_FILES} files.`);
				if (bytes > MAX_SITE) throw new HttpError(413, 'The folder is larger than 200 MB.');
			}
		}
	};
	walk('');
	return out;
}

export class Desk {
	/**
	 * @param {{ dir: string, port: number, remote?: { url: string, token: string | null, tokenName: string } | null,
	 *   fetchImpl?: typeof fetch, log?: (s: string) => void }} o
	 */
	constructor(o) {
		this.o = o;
		this.dir = o.dir;
		this.log = o.log ?? ((s) => console.log(`${new Date().toISOString()} ${s}`));
		this.fetch = o.fetchImpl ?? fetch;
		this.file = path.join(this.dir, 'reviews.json');
		this.records = readJsonFile(this.file, null) ?? {
			schema: 'shared-review-desk.v1',
			reviews: {}
		};
		this.connectors = new Map();
		this.tunnelState = new Map();
		this.remoteState = null;
		this.peeks = new Peeks({ log: this.log, fetchImpl: this.fetch });
	}

	save() {
		writeJsonFile(this.file, this.records);
	}

	/** Start listening on loopback, write desk.json, and reconnect every live app still under review. */
	async start() {
		const other = deskRecord(this.dir);
		if (other && alive(other.pid) && (await answers(other.url, this.fetch))) {
			throw new Error(`a review desk already runs at ${other.url} (process ${other.pid})`);
		}
		this.key = randomId(24);
		this.localToken = randomId(32);
		this.server = http.createServer((req, res) => void this.handle(req, res));
		await new Promise((resolve, reject) => {
			this.server.once('error', reject);
			this.server.listen(this.o.port, '127.0.0.1', resolve);
		});
		this.port = this.server.address().port;
		this.url = `http://127.0.0.1:${this.port}`;
		this.local = new ReviewServer({
			dataDir: path.join(this.dir, 'local'),
			publicUrl: this.url,
			ownerToken: this.localToken,
			service: DESK_SERVICE,
			log: this.log
		});
		this.localClient = new OwnerClient(this.url, this.localToken, this.fetch);
		const r = this.o.remote;
		this.remoteClient = r?.url && r.token ? new OwnerClient(r.url, r.token, this.fetch) : null;
		writeJsonFile(path.join(this.dir, 'desk.json'), {
			schema: 'shared-review-desk.v1',
			url: this.url,
			port: this.port,
			pid: process.pid,
			key: this.key,
			version: VERSION,
			startedAt: new Date().toISOString(),
			cli: CLI
		});
		// Live apps still under review get their connectors back after a restart.
		for (const rec of Object.values(this.records.reviews)) {
			if (rec.state === 'open' && rec.source.kind === 'live') this.connect(rec);
		}
		this.log(`review desk at ${this.url}${this.remoteClient ? `, going live at ${r.url}` : ''}`);
		return this;
	}

	async stop() {
		for (const c of this.connectors.values()) c.stop();
		this.connectors.clear();
		this.peeks.stop();
		await new Promise((r) => this.server?.close(() => r()));
		this.server?.closeAllConnections?.();
	}

	clientFor(rec) {
		if (rec.where === 'local') return this.localClient;
		if (!this.remoteClient || rec.server !== this.o.remote.url.replace(/\/+$/, '')) {
			throw new HttpError(
				409,
				`The desk has no owner token for ${rec.server}, where this review lives.`
			);
		}
		return this.remoteClient;
	}

	/** Whether reviews can go live, and where, in plain words. */
	async remote(force = false) {
		const r = this.o.remote;
		if (!r?.url)
			return {
				url: null,
				state: 'off',
				reason: 'No review server is set, so reviews stay on this computer.',
				signIn: []
			};
		const url = r.url.replace(/\/+$/, '');
		if (!r.token) {
			return {
				url,
				state: 'no-token',
				reason: `The desk has no owner token: it reads ${r.tokenName} from its environment (wh-vault run hands it over).`,
				signIn: []
			};
		}
		const cached = this.remoteState;
		if (!force && cached && Date.now() - cached.at < REMOTE_CHECK_MS) return cached.value;
		let value;
		try {
			const info = await this.remoteClient.info({ timeoutMs: 4_000 });
			value = {
				url,
				state: 'ready',
				reason: null,
				signIn: Array.isArray(info.signIn) ? info.signIn : ['passcode']
			};
		} catch (e) {
			value = {
				url,
				state: e.status === 401 ? 'refused' : 'unreachable',
				reason: e.status === 401 ? 'The review server refused the owner token.' : e.message,
				signIn: []
			};
		}
		this.remoteState = { at: Date.now(), value };
		return value;
	}

	connect(rec) {
		this.connectors.get(rec.id)?.stop();
		let client;
		try {
			client = this.clientFor(rec);
		} catch {
			this.tunnelState.set(rec.id, 'no-token');
			return;
		}
		const c = new Connector({
			server: client.server,
			token: client.token,
			rid: rec.rid,
			upstream: rec.source.url,
			fetchImpl: this.fetch,
			onState: (s) => this.tunnelState.set(rec.id, s)
		}).start();
		this.connectors.set(rec.id, c);
	}

	disconnect(rec) {
		this.connectors.get(rec.id)?.stop();
		this.connectors.delete(rec.id);
		this.tunnelState.delete(rec.id);
	}

	/* ----------------------------------------------------------- actions */

	/** Start a review as a local preview: on this computer only. */
	async startReview(body) {
		const task =
			body.task === undefined || body.task === null || body.task === '' ? null : String(body.task);
		if (task !== null && !TASK_ID.test(task)) throw new HttpError(400, 'That is not a task id.');
		const project = body.project ? tidy(body.project, 160) : null;
		const src = typeof body.source === 'object' && body.source !== null ? body.source : {};
		const start = readStart(body.start);
		let source;
		if (src.kind === 'live') {
			if (typeof src.url !== 'string' || !/^https?:\/\//.test(src.url) || !isLoopbackUrl(src.url)) {
				throw new HttpError(400, 'A live app must be on this computer (127.0.0.1 or localhost).');
			}
			const u = new URL(src.url);
			source = {
				kind: 'live',
				url: u.origin,
				start: start === '/' ? readStart(u.pathname + u.search) : start
			};
		} else if (src.kind === 'static') {
			let dir = typeof src.dir === 'string' ? src.dir : '';
			if (src.root && !path.isAbsolute(dir)) dir = path.resolve(String(src.root), dir);
			if (!path.isAbsolute(dir))
				throw new HttpError(400, 'Name the prototype’s folder by its full path.');
			dir = path.resolve(dir);
			if (
				src.root &&
				dir !== path.resolve(src.root) &&
				!dir.startsWith(path.resolve(src.root) + path.sep)
			) {
				throw new HttpError(400, 'The folder must be inside the task’s worktree.');
			}
			if (!existsSync(dir) || !statSync(dir).isDirectory())
				throw new HttpError(400, `There is no folder at ${dir}.`);
			source = { kind: 'static', dir, spa: src.spa === true, start };
		} else throw new HttpError(400, 'Review a live app (its address) or a folder of static files.');
		const signIn =
			Array.isArray(body.signIn) && body.signIn.length
				? body.signIn.filter((m) => m === 'passcode' || m === 'email')
				: ['passcode'];
		if (!signIn.length) throw new HttpError(400, 'Reviewers sign in by passcode or email.');
		const invitees = readInvitees(body.invitees ?? []);
		if (invitees === null)
			throw new HttpError(400, 'Invite email addresses, or @example.com for a whole domain.');
		if (signIn.includes('email') && !invitees.length)
			throw new HttpError(400, 'Email sign-in needs someone to invite.');
		const title = tidy(body.title, 120) || (task ? `Review of ${task}` : 'Prototype review');

		const rec = {
			id: `sr-${randomId(6).replace(/[-_]/g, 'x').toLowerCase()}`,
			task,
			project,
			title,
			source,
			share: { signIn, invitees },
			where: 'local',
			server: this.url,
			rid: null,
			link: null,
			passcode: null,
			state: 'open',
			createdAt: new Date().toISOString(),
			liveAt: null,
			closedAt: null,
			deliveredAt: null,
			sentIds: [],
			held: [],
			bundleFile: null
		};
		const made = await this.place(
			rec,
			this.localClient,
			{ signIn: ['passcode'], invitees: [] },
			[]
		);
		Object.assign(rec, made);
		this.records.reviews[rec.id] = rec;
		this.save();
		if (source.kind === 'live') this.connect(rec);
		this.log(`started ${rec.id} (${source.kind}) as a local preview`);
		return this.view(rec, []);
	}

	/**
	 * Make the review on a server: create it, send its files and the
	 * attachments of the comments it brings (from `from`, where they are now), open it.
	 */
	async place(rec, client, share, comments, from = null) {
		const files = rec.source.kind === 'static' ? siteFiles(rec.source.dir) : [];
		const made = await client.create({
			title: rec.title,
			task: rec.task,
			project: rec.project,
			source: { kind: rec.source.kind, spa: rec.source.spa, start: rec.source.start },
			signIn: share.signIn,
			invitees: share.invitees,
			comments
		});
		const rid = made.review.rid;
		try {
			for (const c of comments) {
				for (const a of c.attachments ?? []) {
					if (!from) throw new HttpError(500, 'Attachments need somewhere to come from.');
					await client.putAttachment(rid, a.id, await from.attachment(rec.rid, a.id));
				}
			}
			if (rec.source.kind === 'static') {
				for (const f of files)
					await client.putFile(rid, f, readFileSync(path.join(rec.source.dir, f)));
				await client.open(rid);
			}
		} catch (e) {
			await client.purge(rid).catch(() => {});
			throw e;
		}
		return { rid, link: made.link, passcode: made.passcode, server: client.server };
	}

	/** Move a local preview to the review server, with its comments, and close the local one. */
	async goLive(id) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (rec.state !== 'open') throw new HttpError(409, 'That review is closed.');
		if (rec.where !== 'local') throw new HttpError(409, 'That review is live already.');
		const remote = await this.remote(true);
		if (remote.state !== 'ready')
			throw new HttpError(409, remote.reason ?? 'There is no review server to go live on.');
		const share = { ...rec.share };
		if (share.signIn.includes('email') && !remote.signIn.includes('email')) {
			throw new HttpError(
				409,
				`${remote.url} cannot send email, so it offers passcode sign-in only.`
			);
		}
		const { comments } = await this.localClient.get(rec.rid);
		const made = await this.place(rec, this.remoteClient, share, comments, this.localClient);
		this.disconnect(rec);
		const old = rec.rid;
		Object.assign(rec, made, { where: 'remote', liveAt: new Date().toISOString() });
		this.save();
		await this.localClient.close(old).catch(() => {});
		await this.localClient.purge(old).catch(() => {});
		if (rec.source.kind === 'live') this.connect(rec);
		this.log(`${rec.id} is live at ${remote.url}`);
		return this.view(rec, comments);
	}

	/**
	 * The feedback list for some of a review's threads (the ones the captain
	 * ticked in Close…), from the comments not yet sent; null when none is left.
	 */
	async selection(id, picked) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (rec.state !== 'open') throw new HttpError(409, 'That review is closed.');
		const { comments } = await this.clientFor(rec).get(rec.rid);
		const want = new Set(picked);
		const sent = rec.sentIds ?? [];
		const chosen = comments.filter((c) => want.has(threadOf(c, comments)) && !sent.includes(c.id));
		return {
			feedback: chosen.length
				? feedbackList(bundle(rec, chosen), {
						file: path.join(this.dir, 'bundles', `${rec.id}.json`)
					})
				: null
		};
	}

	/**
	 * Close a review: its link goes down, and its comments come back as the
	 * bundle, kept in bundles/<id>.json, each thread and reply marked sent or
	 * unsent. `sent` names the comments just sent to Firstmate, kept on the
	 * review before anything else can fail; `held` names the threads the
	 * captain chose not to send, which stay in the bundle only; `points`, when
	 * the captain sent the preview helper's summary of them instead of the
	 * comments as they are, are those points, kept in the bundle beside the
	 * comments (`summary`). Any other comment never sent is `late`.
	 */
	async closeReview(id, sent, held = [], points = null) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (Array.isArray(sent)) {
			rec.held = held;
			if (points) rec.summary = { at: new Date().toISOString(), points };
			this.recordSent(rec, sent);
		}
		const client = this.clientFor(rec);
		let closed;
		if (rec.state === 'open') {
			closed = await client.close(rec.rid);
			this.disconnect(rec);
			this.peeks.close(rec.id);
			rec.state = 'closed';
			rec.closedAt = new Date().toISOString();
			rec.bundleFile = path.join(this.dir, 'bundles', `${rec.id}.json`);
			const b = bundle({ ...rec, closedAt: rec.closedAt }, closed.comments, {
				id: rec.id,
				link: rec.link,
				where: rec.where
			});
			writeJsonFile(rec.bundleFile, withSummary(markSent(b, rec.sentIds), rec));
			this.save();
			this.log(`closed ${rec.id} with ${closed.comments.length} comments`);
		}
		const b = readJsonFile(rec.bundleFile, null);
		if (!b) throw new HttpError(410, 'That review’s bundle is gone.');
		const flat = b.comments.flatMap((t) => [
			t,
			...t.replies.map((r) => ({ ...r, anchor: t.anchor, parent: t.id }))
		]);
		const late = Array.isArray(sent) ? this.unsent(rec, flat) : [];
		return {
			review: this.view(rec, []),
			bundle: b,
			feedback: feedbackList(b, { file: rec.bundleFile }),
			late: late.length ? feedbackList(bundle(rec, late), { file: rec.bundleFile }) : null
		};
	}

	/**
	 * The bundle is where it is going (Firstmate, or whoever closed it from a
	 * terminal): drop the comments from the review server; the bundle file stays.
	 * `sent` names the comments just sent to Firstmate.
	 */
	async delivered(id, sent) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (rec.state === 'open') throw new HttpError(409, 'Close the review first.');
		if (rec.state === 'closed') {
			this.recordSent(rec, sent);
			await this.clientFor(rec)
				.purge(rec.rid)
				.catch((e) => {
					if (e.status !== 404) throw e;
				});
			rec.state = 'delivered';
			rec.deliveredAt = new Date().toISOString();
			this.save();
		}
		return this.view(rec, []);
	}

	/** Take a comment (and its replies) off an open review, as its owner. */
	async deleteComment(id, cid) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (rec.state !== 'open') throw new HttpError(409, 'That review is closed.');
		const v = await this.clientFor(rec).deleteComment(rec.rid, cid);
		this.log(`took ${v.removed.length} comment(s) off ${rec.id}`);
		return v;
	}

	/**
	 * Keep which comments reached Firstmate, so none is offered or sent twice,
	 * and mark them sent in the bundle once there is one.
	 */
	recordSent(rec, ids) {
		const add = ids.filter((i) => !(rec.sentIds ?? []).includes(i));
		rec.sentIds = [...(rec.sentIds ?? []), ...add];
		rec.held ??= [];
		this.save();
		if (add.length && rec.bundleFile) {
			const b = readJsonFile(rec.bundleFile, null);
			if (b) writeJsonFile(rec.bundleFile, withSummary(markSent(b, rec.sentIds), rec));
		}
	}

	/** Comments still to offer Firstmate: not sent, and not in a thread the captain held back. */
	unsent(rec, comments) {
		const sent = rec.sentIds ?? [];
		const held = rec.held ?? [];
		return comments.filter((c) => !sent.includes(c.id) && !held.includes(threadOf(c, comments)));
	}

	/* -------------------------------------------------------------- views */

	view(rec, comments, problem = null, summary = null) {
		const live = rec.state === 'open';
		const flat = comments.map((c) => ({
			id: c.id,
			author: c.author,
			email: c.email ?? null,
			at: c.at,
			editedAt: c.editedAt ?? null,
			body: c.body,
			parent: c.parent ?? null,
			general: !c.anchor,
			anchor: c.anchor
				? { path: c.anchor.path ?? '/', label: c.anchor.label ?? 'a spot on the page' }
				: null,
			attachments: (c.attachments ?? []).map((a) => ({
				name: a.name,
				type: a.type,
				size: a.size,
				kind: a.kind,
				seconds: a.seconds ?? null
			}))
		}));
		// While the review is open, Close… offers every thread with something unsent (all ticked).
		const unsent = live
			? comments.filter((c) => !(rec.sentIds ?? []).includes(c.id))
			: this.unsent(rec, comments);
		const sentIds = rec.sentIds ?? [];
		const threads = flat
			.filter((c) => threadOf(c, flat) === c.id)
			.map((t, i) => {
				const own = flat.filter((c) => threadOf(c, flat) === t.id);
				return {
					id: t.id,
					n: i + 1,
					author: t.author,
					at: t.at,
					first: tidy(
						t.body.split('\n').find((l) => l.trim()) ?? attachedWords(t.attachments),
						160
					),
					anchor: t.anchor,
					replies: own.length - 1,
					unsent: own.filter((c) => !sentIds.includes(c.id)).length
				};
			});
		return {
			id: rec.id,
			task: rec.task,
			project: rec.project,
			title: rec.title,
			where: rec.where,
			server: rec.server,
			state: rec.state,
			link: live ? rec.link : null,
			passcode: live ? rec.passcode : null,
			// The link with the passcode in its fragment: the sign-in page reads it, so reviewers
			// need not type it, and a fragment never reaches a server's log or a Referer.
			shareLink: live && rec.link ? withPasscode(rec.link, rec.passcode) : null,
			share: rec.share,
			source:
				rec.source.kind === 'live'
					? { kind: 'live', url: rec.source.url, start: rec.source.start }
					: { kind: 'static', dir: rec.source.dir, spa: rec.source.spa, start: rec.source.start },
			tunnel: rec.source.kind === 'live' && live ? this.tunnel(rec, summary) : null,
			createdAt: rec.createdAt,
			liveAt: rec.liveAt,
			closedAt: rec.closedAt,
			deliveredAt: rec.deliveredAt,
			sent: (rec.sentIds ?? []).length > 0,
			bundleFile: rec.bundleFile,
			comments: flat,
			threads,
			held: rec.held ?? [],
			people: [...new Set(flat.map((c) => c.author))],
			feedback:
				(live || rec.state === 'closed') && unsent.length
					? feedbackList(bundle(rec, unsent), {
							file: path.join(this.dir, 'bundles', `${rec.id}.json`)
						})
					: null,
			problem
		};
	}

	/** A one-time address for a frame on the page at `origin` to show the review's live thumbnail. */
	async peek(id, origin) {
		const rec = this.records.reviews[id];
		if (!rec) throw new HttpError(404, 'No such review.');
		if (rec.state !== 'open') throw new HttpError(409, 'That review is closed.');
		const url = await this.peeks.ticket(rec, origin);
		if (!url)
			throw new HttpError(400, 'A preview shows only where Wheelhouse is open on this computer.');
		return { url };
	}

	/** How a live app's connector is doing: the server's word when it has one, else the connector's. */
	tunnel(rec, summary) {
		const own = this.tunnelState.get(rec.id) ?? 'starting';
		if (own === 'no-token' || own === 'gone') return own;
		if (summary?.connected === true) return 'connected';
		return own === 'connected' ? 'connected' : own;
	}

	/** Every review (or one task's), each with its comments as its server has them now. */
	async state(task) {
		const recs = Object.values(this.records.reviews)
			.filter((r) => !task || r.task === task)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		const reviews = await Promise.all(
			recs.map(async (rec) => {
				if (rec.state !== 'open') {
					const b = rec.bundleFile ? readJsonFile(rec.bundleFile, null) : null;
					const flat = b
						? b.comments.flatMap((t) => [
								t,
								...t.replies.map((r) => ({ ...r, anchor: t.anchor, parent: t.id }))
							])
						: [];
					return this.view(rec, flat);
				}
				try {
					const { review, comments } = await this.clientFor(rec).get(rec.rid);
					return this.view(rec, comments, null, review);
				} catch (e) {
					return this.view(rec, [], e instanceof Error ? e.message : String(e));
				}
			})
		);
		return { version: VERSION, url: this.url, remote: await this.remote(), reviews };
	}

	/* --------------------------------------------------------------- HTTP */

	async handle(req, res) {
		const url = new URL(req.url ?? '/', 'http://desk.invalid');
		if (url.pathname === '/_review/health') {
			return sendJson(res, 200, { ok: true, service: DESK_SERVICE, version: VERSION });
		}
		if (url.pathname === '/_review' || url.pathname === '/_review/')
			return sendHtml(res, 200, deskPage());
		if (url.pathname.startsWith('/_review/desk/')) {
			try {
				return await this.api(req, res, url);
			} catch (e) {
				const status = e instanceof HttpError ? e.status : e.status && e.status >= 400 ? 502 : 500;
				if (status === 500) this.log(`error: ${e instanceof Error ? e.message : String(e)}`);
				return sendJson(
					res,
					status,
					{ error: e instanceof Error ? e.message : 'Something went wrong.' },
					this.cors(req)
				);
			}
		}
		return this.local.handle(req, res);
	}

	cors(req) {
		const origin = req.headers.origin;
		return origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
	}

	async api(req, res, url) {
		const host = String(req.headers.host ?? '');
		if (
			![`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`].includes(host)
		) {
			throw new HttpError(421, 'The desk answers only on this computer.');
		}
		const cors = this.cors(req);
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				...cors,
				'access-control-allow-methods': 'GET, POST, DELETE',
				'access-control-allow-headers': 'content-type, x-review-desk-key',
				'access-control-max-age': '600'
			});
			return res.end();
		}
		if (!sameSecret(String(req.headers['x-review-desk-key'] ?? ''), this.key)) {
			throw new HttpError(401, 'The desk key is missing or wrong.');
		}
		const p = url.pathname.slice('/_review/desk/'.length);
		const method = req.method ?? 'GET';
		const ok = (v, status = 200) => sendJson(res, status, v, cors);
		if (p === 'state' && method === 'GET')
			return ok(await this.state(url.searchParams.get('task')));
		if (p === 'reviews' && method === 'POST')
			return ok({ review: await this.startReview(await readJson(req)) }, 201);
		const dc = /^reviews\/(sr-[a-z0-9]{1,16})\/comments\/([\w-]{1,40})$/.exec(p);
		if (dc && method === 'DELETE') return ok(await this.deleteComment(dc[1], dc[2]));
		const m = /^reviews\/(sr-[a-z0-9]{1,16})\/(live|close|delivered|bundle|feedback|peek)$/.exec(p);
		if (m && m[2] === 'bundle' && method === 'GET') {
			const rec = this.records.reviews[m[1]];
			const b = rec?.bundleFile ? readJsonFile(rec.bundleFile, null) : null;
			if (!b) throw new HttpError(404, 'That review has no bundle yet: close it first.');
			return ok(b);
		}
		if (m && method === 'POST') {
			const body = await readJson(req);
			if (m[2] === 'live') return ok({ review: await this.goLive(m[1]) });
			if (m[2] === 'feedback')
				return ok(
					await this.selection(m[1], Array.isArray(body.threads) ? body.threads.map(String) : [])
				);
			if (m[2] === 'peek') return ok(await this.peek(m[1], body.origin));
			if (m[2] === 'close')
				return ok(
					await this.closeReview(
						m[1],
						Array.isArray(body.sent) ? body.sent.map(String) : null,
						Array.isArray(body.held) ? body.held.map(String) : [],
						readPoints(body.points)
					)
				);
			if (m[2] === 'delivered')
				return ok({
					review: await this.delivered(m[1], Array.isArray(body.sent) ? body.sent.map(String) : [])
				});
		}
		throw new HttpError(404, 'Not here.');
	}
}

/** A review's link with its passcode in the fragment (`#p=…`), or the link alone without one. */
export function withPasscode(link, passcode) {
	return passcode ? `${link}#p=${encodeURIComponent(passcode)}` : link;
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function answers(url, fetchImpl) {
	try {
		const r = await fetchImpl(`${url}/_review/health`, { signal: AbortSignal.timeout(1500) });
		const v = await r.json();
		return v.service === DESK_SERVICE;
	} catch {
		return false;
	}
}
