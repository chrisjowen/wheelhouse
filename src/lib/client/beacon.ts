import { SESSION_HEADER } from '$lib/client/messages';
import { watchTrouble } from '$lib/trouble.js';
import type { PageSignalKind } from '$lib/soundings';

/**
 * Soundings' beacon in Wheelhouse's own pages (while the experimental
 * `soundings` feature is on): the trouble a page runs into, sent to the server
 * in small batches for the Health page and the report. It reuses the live
 * review recorder's capture (lib/trouble.js: errors, rejected promises,
 * console errors, failed requests) and adds what only a page can see: long
 * tasks that freeze it, and a loading state that never finishes.
 *
 * Same trouble on the same page within a batch is sent once, with a count; a
 * batch goes at most every half minute, with at most MAX_BATCH kinds of
 * trouble, and the server limits what it takes in as well.
 */

const ENDPOINT = '/api/soundings/beacon';
const FLUSH_MS = 30_000;
const MAX_BATCH = 25;
/** A main-thread task at least this long froze the page. */
const LONG_TASK_MS = 200;
/** A loading state still showing after this long is stuck. */
const STUCK_MS = 60_000;
const STUCK_LOOK_MS = 10_000;
/** Loading words a spinner's label starts with (an agent's own "working" spinner is not one). */
const LOADING = /^(loading|reading|checking|looking|fetching|opening|connecting)/i;

interface Pending {
	kind: PageSignalKind;
	message: string;
	page: string;
	count: number;
}

let started = false;

/** Start the beacon (once per page load). `token` gives the session token mutations need. */
export function startBeacon(token: () => string | undefined): () => void {
	if (started || typeof window === 'undefined') return () => {};
	started = true;
	const send = window.fetch.bind(window);
	const queue = new Map<string, Pending>();

	const add = (kind: PageSignalKind, message: string, replace = false) => {
		const page = location.pathname;
		const key = `${kind}|${page}|${replace ? '' : message}`;
		const had = queue.get(key);
		if (had) {
			had.count++;
			if (replace) had.message = message;
		} else if (queue.size < MAX_BATCH) queue.set(key, { kind, message, page, count: 1 });
	};

	watchTrouble(
		(kind, message, extra) =>
			add(kind, `${String(message)}${extra?.source ? ` (${extra.source})` : ''}`.slice(0, 300)),
		(url) => url.includes(ENDPOINT)
	);

	let longest = 0;
	let observer: PerformanceObserver | null = null;
	try {
		observer = new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				if (e.duration < LONG_TASK_MS) continue;
				longest = Math.max(longest, e.duration);
				add('longtask', `The page froze for up to ${Math.round(longest)} ms at a time`, true);
			}
		});
		observer.observe({ type: 'longtask', buffered: false });
	} catch {
		// no long task timing in this browser
	}

	const seen = new WeakMap<Element, number>();
	const told = new WeakSet<Element>();
	const lookForStuck = () => {
		const now = Date.now();
		const busy = [
			...document.querySelectorAll('[aria-busy="true"]'),
			...[...document.querySelectorAll('.animate-spin')].filter((s) =>
				LOADING.test((s.parentElement?.textContent ?? '').trim())
			)
		];
		for (const el of busy) {
			if (!(el as HTMLElement).offsetParent || told.has(el)) continue;
			const since = seen.get(el) ?? now;
			seen.set(el, since);
			if (now - since < STUCK_MS) continue;
			told.add(el);
			const what = (el.getAttribute('aria-label') || el.parentElement?.textContent || '')
				.replace(/\s+/g, ' ')
				.trim()
				.slice(0, 80);
			add(
				'stuck',
				`Still loading after ${Math.round(STUCK_MS / 1000)} s${what ? `: “${what}”` : ''}`
			);
		}
	};

	const flush = (leaving = false) => {
		if (!queue.size) return;
		const t = token();
		if (!t) return;
		const signals = [...queue.values()];
		queue.clear();
		longest = 0;
		void send(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: t },
			body: JSON.stringify({ signals }),
			keepalive: leaving
		}).catch(() => {});
	};
	const flusher = setInterval(() => flush(), FLUSH_MS);
	const looker = setInterval(lookForStuck, STUCK_LOOK_MS);
	const leave = () => flush(true);
	addEventListener('pagehide', leave);
	return () => {
		clearInterval(flusher);
		clearInterval(looker);
		observer?.disconnect();
		removeEventListener('pagehide', leave);
		// The trouble watcher stays: it cannot be taken out of fetch and console safely.
	};
}
