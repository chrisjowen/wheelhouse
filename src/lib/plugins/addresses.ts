import { PREVIEW_HOSTS } from '../preview';
import { extractUrls } from '../urls';

/**
 * Addresses on Wheelhouse's own computer, and the `*.localhost` host names a
 * plugin may claim for them, shared by the pages and the server.
 *
 * A plugin can declare host templates such as `{port}.localhost`: one or more
 * lower-case labels ending in `.localhost`, with `{port}` (a port, 1-65535)
 * once in the first label. Browsers send any `*.localhost` name to the
 * viewer's own loopback, so a request for one arrives on whichever port the
 * viewer reached Wheelhouse on, and a DNS-rebinding page cannot send one.
 *
 * - An address rewrite (`addressRewrites`) has Wheelhouse show every http
 *   address on 127.0.0.1 or localhost under the template instead, on the
 *   viewer's own Wheelhouse port: with `{port}.localhost`,
 *   `http://localhost:5173/app` opens as `http://5173.localhost:4310/app`.
 * - A host route (`hostRoutes`) has Wheelhouse hand requests for the template
 *   to the plugin's server entry (see server/hostroutes).
 */

/** A host template: `{port}` once in the first label, ending in `.localhost`. */
const TEMPLATE = /^[a-z0-9-]*\{port\}[a-z0-9-]*(?:\.[a-z0-9-]+)*\.localhost$/;

export function validHostTemplate(v: unknown): v is string {
	return typeof v === 'string' && v.length <= 100 && TEMPLATE.test(v);
}

const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** The port a host name (without its own `:port`) fills `template` with, or null when it does not match. */
export function matchHost(template: string, hostname: string): number | null {
	const [before, after] = template.split('{port}');
	const m = new RegExp(`^${escape(before)}([1-9]\\d{0,4})${escape(after)}$`).exec(
		hostname.toLowerCase()
	);
	const port = m ? Number(m[1]) : NaN;
	return validPort(port) ? port : null;
}

/** A Host header's name and port; null when it is not a `*.localhost` name a plugin could claim. */
export function localhostName(host: string | null | undefined): string | null {
	const m = /^((?:[a-z0-9-]+\.)+localhost)(?::\d{1,5})?$/i.exec(host ?? '');
	return m ? m[1].toLowerCase() : null;
}

/**
 * The port an http address on this computer (127.0.0.1 or localhost, no
 * credentials) is on, or null for any other address. https is left alone.
 */
export function loopbackPort(raw: string): number | null {
	const u = URL.parse(raw);
	if (!u || u.protocol !== 'http:' || u.username || u.password) return null;
	if (!PREVIEW_HOSTS.has(u.hostname.toLowerCase())) return null;
	const port = u.port ? Number(u.port) : 80;
	return validPort(port) ? port : null;
}

/** Where the viewer reached Wheelhouse: its page's location. */
export interface Viewer {
	protocol: string;
	hostname: string;
	port: string;
}

/**
 * `raw` as the viewer should open it under an address rewrite's host
 * `template`, when it is an http address on Wheelhouse's computer; else
 * unchanged. An address on the port the viewer reached Wheelhouse itself on
 * is left alone.
 */
export function rewriteAddress(raw: string, template: string | null, viewer: Viewer): string {
	const port = template ? loopbackPort(raw) : null;
	if (port === null || !template) return raw;
	const own = viewer.port || (viewer.protocol === 'https:' ? '443' : '80');
	if (PREVIEW_HOSTS.has(viewer.hostname.toLowerCase()) && String(port) === own) return raw;
	const u = new URL(raw);
	const host = template.replace('{port}', String(port));
	return `${viewer.protocol}//${host}${viewer.port ? `:${viewer.port}` : ''}${u.pathname}${u.search}${u.hash}`;
}

/** Every distinct http(s) address on 127.0.0.1 or localhost in `text`, as written. */
export function loopbackAddresses(text: string): string[] {
	const found = new Set<string>();
	for (const url of extractUrls(text)) {
		const u = URL.parse(url);
		if (u && (u.protocol === 'http:' || u.protocol === 'https:')) {
			if (PREVIEW_HOSTS.has(u.hostname.toLowerCase()) && !u.username && !u.password) {
				found.add(url);
			}
		}
	}
	return [...found];
}
