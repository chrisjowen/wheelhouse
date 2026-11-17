/*
 * Trouble on a page: uncaught errors, resources that fail to load, rejected
 * promises nobody handled, console errors and failed requests, each handed to
 * `report` as it happens. Plain browser JavaScript with no imports, so it can
 * be shared as is by two scripts:
 *
 * - the live review recorder (server/livereview/recorder.js), which Wheelhouse
 *   serves into a preview's pages with this file's source placed in front of
 *   it (the `export` taken off), and
 * - Soundings' beacon in Wheelhouse's own pages (client/beacon.ts), which
 *   imports it.
 *
 * Keep it that way: self-contained, no imports, no TypeScript syntax.
 */

/**
 * @typedef {'exception' | 'resource' | 'console' | 'network'} TroubleKind
 * @typedef {(kind: TroubleKind, message: string, extra?: { source?: string | null }) => void} TroubleReport
 */

/**
 * Start watching this window for trouble. `skip` names request URLs not to
 * report (the reporter's own, so a failing report does not report itself).
 *
 * @param {TroubleReport} report
 * @param {(url: string) => boolean} [skip]
 */
export function watchTrouble(report, skip) {
	const shortUrl = (/** @type {unknown} */ u) => {
		try {
			const x = new URL(String(u), location.href);
			return x.pathname + x.search;
		} catch {
			return String(u);
		}
	};
	const safeJson = (/** @type {unknown} */ v) => {
		try {
			return JSON.stringify(v);
		} catch {
			return String(v);
		}
	};
	addEventListener(
		'error',
		(e) => {
			const target = /** @type {any} */ (e.target);
			if (target && target !== window && target.tagName) {
				report(
					'resource',
					`Could not load ${target.tagName.toLowerCase()} ${target.src || target.href || ''}`
				);
			} else {
				const ev = /** @type {ErrorEvent} */ (e);
				report('exception', ev.message, {
					source: ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}` : null
				});
			}
		},
		true
	);
	addEventListener('unhandledrejection', (e) =>
		report('exception', `Unhandled: ${e.reason && e.reason.message ? e.reason.message : e.reason}`)
	);
	const consoleError = console.error;
	console.error = function (...args) {
		report(
			'console',
			args
				.map((a) =>
					a instanceof Error ? a.message : typeof a === 'object' ? safeJson(a) : String(a)
				)
				.join(' ')
		);
		return consoleError.apply(this, args);
	};
	const ofetch = window.fetch;
	if (ofetch)
		window.fetch = async function (input, init) {
			const req = /** @type {any} */ (input);
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : req?.url;
			const method = (init && init.method) || (req && req.method) || 'GET';
			if (skip && url && skip(String(url))) return ofetch.call(this, input, init);
			try {
				const res = await ofetch.call(this, input, init);
				if (res.status >= 400) report('network', `${method} ${shortUrl(url)} → ${res.status}`);
				return res;
			} catch (err) {
				// A request the page itself called off (leaving a page, a newer search) is not trouble.
				if (!(err && /** @type {any} */ (err).name === 'AbortError'))
					report(
						'network',
						`${method} ${shortUrl(url)} failed (${err && /** @type {any} */ (err).message})`
					);
				throw err;
			}
		};
}
