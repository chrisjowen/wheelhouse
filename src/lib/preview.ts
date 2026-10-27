/**
 * Rules for showing a worker's reported preview (`preview <url>` status line)
 * inside Wheelhouse. Pure, so the page and the server share them and they are
 * unit-tested.
 *
 * Only previews served from this machine are embedded: http(s) on 127.0.0.1
 * or localhost, with no credentials in the URL. Anything else is refused, and
 * Wheelhouse never fetches it to check whether it answers.
 */

/** The only hosts a preview may be embedded from. */
export const PREVIEW_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const NOT_LOOPBACK =
	'Only previews on this machine (127.0.0.1 or localhost) are shown here; this one is not.';

export type PreviewTarget = { ok: true; url: string } | { ok: false; reason: string };

/** The URL to embed, or why it is refused. */
export function loopbackPreview(raw: string): PreviewTarget {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return { ok: false, reason: 'The reported preview is not a valid URL.' };
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		return { ok: false, reason: 'The reported preview is not an http(s) URL.' };
	}
	if (u.username || u.password) {
		return { ok: false, reason: 'The reported preview carries credentials, so it is not shown.' };
	}
	if (!PREVIEW_HOSTS.has(u.hostname.toLowerCase())) return { ok: false, reason: NOT_LOOPBACK };
	return { ok: true, url: u.href };
}

/**
 * The iframe sandbox for a preview. A preview on another port is another
 * origin, so it may keep its own storage and scripts. One served from the
 * page's own origin would escape a sandbox that allows both scripts and
 * same-origin, so that pair is never granted to it.
 */
export function frameSandbox(previewUrl: string, pageOrigin: string): string {
	const base = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
	let same = true;
	try {
		same = new URL(previewUrl).origin === pageOrigin;
	} catch {
		// an unparseable URL gets the stricter sandbox
	}
	return same ? base : `${base} allow-same-origin`;
}

/** The note sent to the task's worker (through Firstmate) for feedback typed under a preview. */
export function feedbackNote(previewUrl: string, text: string): string {
	return `Review feedback on the live preview (${previewUrl}):\n${text.trim()}`;
}

/** The first line feedbackNote writes, which marks a message as preview feedback. */
export const FEEDBACK_PREFIX = /^Review feedback on the live preview \([^)\n]*\):\n/;

/** What the page shows for a preview, from the server's check (api/tasks/[id]/preview). */
export interface PreviewCheck {
	/** The URL the worker reported, or null when none was. */
	url: string | null;
	reportedAt: string | null;
	/**
	 * live: it answered and allows framing; blocked: it answered but refuses to
	 * be framed; down: it did not answer; refused: not a loopback URL; none:
	 * no preview reported.
	 */
	state: 'live' | 'blocked' | 'down' | 'refused' | 'none';
	/** Why it is not shown embedded, in plain words (null when live). */
	reason: string | null;
	checkedAt: string;
}

/**
 * Whether response headers forbid framing the preview at `previewUrl` from a
 * page served at `pageOrigin` (Wheelhouse): any CSP frame-ancestors (across
 * every policy) with no source that matches the page's origin, or, only when
 * no policy has frame-ancestors, X-Frame-Options of any kind.
 */
export function frameRefusal(
	headers: Headers,
	previewUrl: string,
	pageOrigin: string
): string | null {
	const csp = headers.get('content-security-policy') ?? '';
	const directives = [...csp.matchAll(/(?:^|[;,])\s*frame-ancestors(?:\s+([^;,]*))?/gi)].map(
		(m) => m[1]?.trim() ?? ''
	);
	if (directives.length === 0) {
		const xfo = headers.get('x-frame-options');
		if (xfo && /deny|sameorigin/i.test(xfo)) {
			return `The preview refuses to be embedded (X-Frame-Options: ${xfo.trim()}).`;
		}
		return null;
	}
	const page = URL.parse(pageOrigin);
	const self = URL.parse(previewUrl);
	for (const fa of directives) {
		const allowed = page && self && fa.split(/\s+/).some((src) => ancestorAllowed(src, page, self));
		if (!allowed) return `The preview refuses to be embedded (frame-ancestors ${fa || "'none'"}).`;
	}
	return null;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

function schemeAllowed(scheme: string, page: URL): boolean {
	return scheme === page.protocol || (scheme === 'http:' && page.protocol === 'https:');
}

/** Whether one frame-ancestors source expression matches the framing page's origin. */
function ancestorAllowed(src: string, page: URL, self: URL): boolean {
	const s = src.toLowerCase();
	if (s === '*') return page.protocol === 'http:' || page.protocol === 'https:';
	if (s === "'self'") return page.origin === self.origin;
	if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return schemeAllowed(s, page);
	const m =
		/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\d+|\*))?(?:\/.*)?$/.exec(
			s
		);
	if (!m) return false;
	const [, scheme, host, port] = m;
	if (!schemeAllowed(scheme ? `${scheme}:` : self.protocol, page)) return false;
	const hostname = page.hostname.toLowerCase();
	if (host.startsWith('*.')) {
		if (!hostname.endsWith(host.slice(1))) return false;
	} else if (host !== '*' && host !== hostname) return false;
	if (port === '*') return true;
	const pagePort = page.port || DEFAULT_PORTS[page.protocol];
	return pagePort === (port ?? DEFAULT_PORTS[page.protocol]);
}
