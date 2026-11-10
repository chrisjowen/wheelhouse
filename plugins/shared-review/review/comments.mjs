/**
 * Comments and where they point, and the bundle a closed review goes back
 * as. Everything a reviewer sends is untrusted: it is checked and bounded
 * here, kept as plain text, and drawn only as text (never as HTML) by the
 * review page and Wheelhouse.
 */

import { tidy, tidyText } from './lib.mjs';

export const MAX_BODY = 2000;
export const MAX_NAME = 60;
export const MAX_COMMENTS = 500;

/** Wheelhouse's feedback list limits (src/lib/previewhelper.ts, src/lib/server/plugins/feedback.ts). */
export const FEEDBACK = { items: 30, text: 500, points: 200, subject: 200, total: 14_000 };

const num = (v, min, max) =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** A reviewer's name: one line, 1 to 60 characters; null when it is not one. */
export function readName(v) {
	const n = tidy(v);
	return n && [...n].length <= MAX_NAME ? n : null;
}

/** An email address, lower-cased; null when it does not look like one. */
export function readEmail(v) {
	const e = String(v ?? '')
		.trim()
		.toLowerCase();
	return e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z0-9-]{2,}$/.test(e) ? e : null;
}

/** Who may sign in by email: whole addresses, or `@example.com` for a domain. */
export function readInvitees(v) {
	const list = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/);
	const out = [];
	for (const raw of list) {
		const s = String(raw).trim().toLowerCase();
		if (!s) continue;
		if (/^@[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(s)) out.push(s);
		else if (readEmail(s)) out.push(s);
		else return null;
	}
	return [...new Set(out)].slice(0, 200);
}

export function invited(invitees, email) {
	const at = email.slice(email.lastIndexOf('@'));
	return invitees.includes(email) || invitees.includes(at);
}

/**
 * Where a comment points, as the review page measured it: the page's path,
 * the element (a CSS selector, and the spot inside it as fractions of its
 * box), the spot on the page as a fallback, and what it is in plain words.
 */
export function readAnchor(v) {
	const a = typeof v === 'object' && v !== null ? v : {};
	const path = typeof a.path === 'string' && a.path.startsWith('/') ? tidy(a.path, 500) : '/';
	const at =
		a.at && num(a.at.x, 0, 1) !== null && num(a.at.y, 0, 1) !== null
			? { x: a.at.x, y: a.at.y }
			: null;
	const doc =
		a.doc && num(a.doc.x, 0, 1e6) !== null && num(a.doc.y, 0, 1e6) !== null
			? { x: Math.round(a.doc.x), y: Math.round(a.doc.y) }
			: null;
	const viewport =
		a.viewport && num(a.viewport.w, 1, 20_000) !== null && num(a.viewport.h, 1, 20_000) !== null
			? { w: Math.round(a.viewport.w), h: Math.round(a.viewport.h) }
			: null;
	return {
		path,
		selector: typeof a.selector === 'string' && a.selector ? tidy(a.selector, 600) : null,
		at,
		doc,
		viewport,
		label: tidy(a.label, 200) || 'a spot on the page',
		text: typeof a.text === 'string' && a.text.trim() ? tidy(a.text, 200) : null
	};
}

/** A new comment from a reviewer, checked; or why it is refused. */
export function readComment(body) {
	const text = tidyText(body.body, MAX_BODY);
	if (text === null) return { ok: false, error: `A comment holds at most ${MAX_BODY} characters.` };
	if (!text) return { ok: false, error: 'Write something first.' };
	const parent =
		typeof body.parent === 'string' && /^[\w-]{1,40}$/.test(body.parent) ? body.parent : null;
	return { ok: true, value: { body: text, parent, anchor: readAnchor(body.anchor) } };
}

/** Comments brought in by the owner (a review moving from this computer to the server), checked. */
export function readImported(list) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const c of list.slice(0, MAX_COMMENTS)) {
		if (typeof c !== 'object' || c === null) continue;
		const r = readComment(c);
		const author = readName(c.author);
		if (!r.ok || !author || typeof c.id !== 'string' || !/^[\w-]{1,40}$/.test(c.id)) continue;
		const at =
			typeof c.at === 'string' && !Number.isNaN(Date.parse(c.at)) ? c.at : new Date().toISOString();
		out.push({ id: c.id, author, email: readEmail(c.email), at, ...r.value });
	}
	return out;
}

/** Comments as threads: each top-level comment with its replies, numbered in order. */
export function threads(comments) {
	const top = comments.filter((c) => !c.parent || !comments.some((p) => p.id === c.parent));
	return top.map((c, i) => ({
		n: i + 1,
		...c,
		replies: comments.filter((r) => r.parent === c.id)
	}));
}

/** Where a comment points, in a few words: `the “Pay now” button on /checkout (62% across, 40% down)`. */
export function pointsAt(anchor) {
	const where = anchor.at
		? ` (${Math.round(anchor.at.x * 100)}% across, ${Math.round(anchor.at.y * 100)}% down it)`
		: '';
	return tidy(`${anchor.label} on ${anchor.path}${where}`, FEEDBACK.points);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names as a list: "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function names(list) {
	if (list.length < 2) return list.join('');
	return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The full bundle a closed review goes back as: the review, who took part,
 * and every comment with where it points.
 */
export function bundle(review, comments, extra = {}) {
	const people = [];
	for (const c of comments) {
		let p = people.find((x) => x.name === c.author && (x.email ?? null) === (c.email ?? null));
		if (!p) people.push((p = { name: c.author, email: c.email ?? null, comments: 0 }));
		p.comments++;
	}
	return {
		schema: 'shared-review-bundle.v1',
		review: {
			id: review.id ?? review.rid,
			title: review.title,
			task: review.task ?? null,
			project: review.project ?? null,
			source: review.source,
			createdAt: review.createdAt,
			closedAt: review.closedAt ?? null,
			...extra
		},
		people,
		comments: threads(comments).map((t) => ({
			n: t.n,
			id: t.id,
			author: t.author,
			email: t.email ?? null,
			at: t.at,
			body: t.body,
			page: t.anchor.path,
			anchor: t.anchor,
			replies: t.replies.map((r) => ({
				id: r.id,
				author: r.author,
				email: r.email ?? null,
				at: r.at,
				body: r.body
			}))
		}))
	};
}

/** The thread a comment belongs to: its parent's id when that is in the list, else its own. */
export function threadOf(c, comments) {
	return c.parent && comments.some((p) => p.id === c.parent) ? c.parent : c.id;
}

/**
 * Mark which of a bundle's comments reached Firstmate: every thread and
 * reply gets `sent: true` or `sent: false`, so a thread the captain chose not
 * to send (or that arrived too late) stays in the bundle, marked unsent.
 */
export function markSent(b, sentIds) {
	const sent = new Set(sentIds ?? []);
	return {
		...b,
		comments: b.comments.map((t) => ({
			...t,
			sent: sent.has(t.id),
			replies: t.replies.map((r) => ({ ...r, sent: sent.has(r.id) }))
		}))
	};
}

/**
 * The bundle as Wheelhouse's feedback list (one line per thread, its replies
 * folded in, and where it points), within the list's limits: at most 30
 * lines of 500 characters, about 14,000 in all. What does not fit is named
 * in a last line that points at the full bundle.
 */
export function feedbackList(b, o = {}) {
	const count = b.comments.reduce((n, t) => n + 1 + t.replies.length, 0);
	const who = names(b.people.map((p) => p.name));
	const subject = tidy(
		`the shared review “${b.review.title}” (${plural(count, 'comment')}${who ? ` from ${who}` : ''})`,
		FEEDBACK.subject
	);
	const line = (t) =>
		[`${t.author}: ${t.body}`, ...t.replies.map((r) => `${r.author} replied: ${r.body}`)].join(
			' — '
		);
	const all = b.comments.map((t) => ({ full: tidy(line(t)), points: pointsAt(t.anchor) }));
	// Shorten every line alike until the list fits Firstmate's note size (in bytes, so any script fits).
	const fit = (shown) => {
		let cap = FEEDBACK.text;
		let pcap = FEEDBACK.points;
		for (;;) {
			const items = shown.map((t) => ({ text: tidy(t.full, cap), points: tidy(t.points, pcap) }));
			const bytes = items.reduce(
				(n, it) => n + Buffer.byteLength(it.text) + Buffer.byteLength(it.points) + 24,
				0
			);
			if (bytes <= FEEDBACK.total || cap <= 40) {
				const cut = items.some(
					(it, i) => it.text !== shown[i].full || it.points !== shown[i].points
				);
				return { items, cut };
			}
			cap = Math.floor(cap * 0.85);
			pcap = Math.max(40, Math.floor(pcap * 0.85));
		}
	};
	let shown = all.slice(0, FEEDBACK.items);
	let { items, cut } = fit(shown);
	if (cut || all.length > shown.length) {
		// Keep a line free to say what did not fit.
		shown = all.slice(0, FEEDBACK.items - 1);
		({ items } = fit(shown));
		const more = all.length - shown.length;
		const rest = more
			? `${plural(more, 'more thread')} did not fit in this list. `
			: 'Some comments were shortened in this list. ';
		items.push({
			text: tidy(
				`${rest}The full bundle has every comment in full and where it points${o.file ? `: ${o.file}` : ''}`,
				FEEDBACK.text
			),
			points: null
		});
	}
	const ids = b.comments.flatMap((t) => [t.id, ...t.replies.map((r) => r.id)]);
	return { subject, items, ids };
}
