/**
 * Wheelhouse Cloud, as the browser sees it: whether this machine is paired
 * with a hosted gateway that relays the captain's browser to this Wheelhouse,
 * whether the connector is online, and the relay sessions it has seen. The
 * device key itself never leaves the server.
 */

/**
 *   off          turned off here (`wheelhouse remote off`, or the switch in Settings)
 *   not-paired   no gateway knows this machine yet (`wheelhouse remote connect`)
 *   not-running  paired and on, but no connector runs (Wheelhouse starts one; or `wheelhouse remote run`)
 *   connecting   connecting, or reconnecting after a drop
 *   online       connected: the gateway can relay to this machine
 *   stopped      the connector stopped: the reason says why and what fixes it
 */
export type CloudState = 'off' | 'not-paired' | 'not-running' | 'connecting' | 'online' | 'stopped';

/** A relay session the connector has seen (§6.4 of the protocol): no paths, bodies or header values. */
export interface RelaySession {
	id: string;
	user: string;
	firstAt: string;
	lastAt: string;
	requests: number;
}

export interface CloudDeviceView {
	id: string;
	name: string;
	/** Who approved the pairing, as the gateway named them. */
	user: string | null;
	fingerprint: string;
	pairedAt: string;
}

export interface CloudView {
	schema: 'wheelhouse-cloud.v1';
	enabled: boolean;
	/** The gateway's origin, or '' when none is set. */
	gateway: string;
	device: CloudDeviceView | null;
	/** Where the device key is kept, for the captain to read. */
	keyStore: string | null;
	state: CloudState;
	reason: string | null;
	/** Online since. */
	since: string | null;
	/** The last time the gateway was heard from. */
	lastSeen: string | null;
	sessions: RelaySession[];
	/** This page itself came through the gateway. */
	viaRelay: boolean;
}

/**
 * A page that came through the gateway: where previews on this machine open
 * for it (the relay's template with `{port}` in its host, as the connector
 * passes it in X-Wheelhouse-Remote-Preview) and the local port Wheelhouse
 * itself is on.
 */
export interface RemoteView {
	preview: string;
	appPort: number;
}

/** The relay's preview template if it is one: an http(s) origin with `{port}` once in its host. */
export function previewTemplate(raw: string | null | undefined): string | null {
	if (!raw || raw.length > 300 || raw.split('{port}').length !== 2) return null;
	const u = URL.parse(raw.replace('{port}', '1'));
	if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
	if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
	if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return null;
	const host = raw.slice(raw.indexOf('//') + 2);
	return host.includes('{port}') && !host.includes('/') ? raw : null;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

/**
 * `raw` as a page that came through the gateway opens it: an address on this
 * machine (http(s) on 127.0.0.1 or localhost, or `http://<port>.localhost`)
 * goes to the relay's host for that port, and one on Wheelhouse's own port
 * stays on the page's own origin. Anything else is unchanged.
 */
export function remoteAddress(raw: string, remote: RemoteView, pageOrigin: string): string {
	const u = URL.parse(raw);
	if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) {
		return raw;
	}
	const host = u.hostname.toLowerCase();
	const named = /^([1-9]\d{0,4})\.localhost$/.exec(host);
	let port: number;
	if (named) port = Number(named[1]);
	else if (LOOPBACK.has(host)) port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
	else return raw;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return raw;
	const rest = `${u.pathname}${u.search}${u.hash}`;
	if (!named && port === remote.appPort) return `${pageOrigin}${rest}`;
	return `${remote.preview.replace('{port}', String(port))}${rest}`;
}
