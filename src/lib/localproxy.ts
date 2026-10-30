import { PREVIEW_HOSTS } from './preview';
import { extractUrls } from './urls';

/**
 * The localhost proxy's addresses, shared by the page and the server. While
 * the bundled Localhost proxy plugin is on, Wheelhouse shows each address on
 * its own computer (`http://localhost:5173/app`, `http://127.0.0.1:5173/app`)
 * through itself instead: `http://5173.localhost:4310/app`, where 4310 is the
 * port the viewer reached Wheelhouse on. Browsers send any `*.localhost` name
 * to the viewer's own loopback, so the request arrives on Wheelhouse's port
 * however that port was forwarded (Docker, SSH, a cloud workspace), and
 * Wheelhouse passes it on to that port on its own loopback. Each port gets an
 * origin of its own, apart from Wheelhouse's pages and from every other port,
 * so a proxied app's root paths, client-side routes, cookies and WebSockets
 * work as they do on its own address, and it cannot reach Wheelhouse's page,
 * session token or API.
 */

/** The bundled plugin that turns the proxy on, and holds its settings. */
export const PROXY_PLUGIN = 'localhost-proxy';

/** A proxied address's host name: the target port, then `.localhost`. */
const PROXY_HOST = /^([1-9]\d{0,4})\.localhost(?::(\d{1,5}))?$/i;

const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** The target port a Host header names, or null when it is not a proxied address. */
export function proxyPort(host: string | null | undefined): number | null {
	const m = PROXY_HOST.exec(host ?? '');
	if (!m) return null;
	const port = Number(m[1]);
	return validPort(port) ? port : null;
}

/**
 * The port an http address on this computer (127.0.0.1 or localhost, no
 * credentials) is on, or null for any other address. https is left alone:
 * the proxy speaks plain http to its targets.
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
 * `raw` as the viewer should open it: through the proxy when it is an http
 * address on Wheelhouse's computer, else unchanged. An address on the port
 * the viewer reached Wheelhouse itself on is left alone.
 */
export function proxiedUrl(raw: string, viewer: Viewer): string {
	const port = loopbackPort(raw);
	if (port === null) return raw;
	const own = viewer.port || (viewer.protocol === 'https:' ? '443' : '80');
	if (PREVIEW_HOSTS.has(viewer.hostname.toLowerCase()) && String(port) === own) return raw;
	const u = new URL(raw);
	const at = `${viewer.protocol}//${port}.localhost${viewer.port ? `:${viewer.port}` : ''}`;
	return `${at}${u.pathname}${u.search}${u.hash}`;
}

/** The ports of every http address on this computer in `text`, as reported. */
export function reportedPorts(text: string): number[] {
	const ports = new Set<number>();
	for (const url of extractUrls(text)) {
		const port = loopbackPort(url);
		if (port !== null) ports.add(port);
	}
	return [...ports];
}

/** The ports the plugin's `ports` setting allows: whole numbers 1-65535, the rest ignored. */
export function settingPorts(value: unknown): number[] {
	const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
	const ports = new Set<number>();
	for (const item of items) {
		const text = String(item).trim();
		if (!/^\d{1,5}$/.test(text)) continue;
		const port = Number(text);
		if (validPort(port)) ports.add(port);
	}
	return [...ports];
}
