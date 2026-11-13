/**
 * Wheelhouse Cloud, as the browser sees it: whether this machine is paired
 * with a hosted gateway that relays the captain's browser to this Wheelhouse,
 * whether the connector is online, and the relay sessions it has seen. The
 * device key itself never leaves the server.
 */

/**
 * The gateway Wheelhouse Cloud uses until the captain names another (on the
 * Remotes page, Settings → Cloud, or `wheelhouse remote connect --gateway`):
 * anyone may host their own gateway and point Wheelhouse at it.
 */
export const DEFAULT_GATEWAY = 'https://cloud.chrisjowen.net';

/**
 *   off          not started here: remote access is off until the captain starts it on the
 *                Remotes page (or turns it off: `wheelhouse remote off`, Stop)
 *   not-paired   no gateway knows this machine yet (Start pairs it; or `wheelhouse remote connect`)
 *   not-running  started, but no connector runs (`wheelhouse open` runs one; or `wheelhouse remote run`)
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

/** A passkey this machine trusts to sign its sessions, as the gateway's Account page shows it too. */
export interface CloudPasskeyView {
	name: string;
	fingerprint: string;
}

export interface CloudDeviceView {
	id: string;
	name: string;
	/** Who approved the pairing, as the gateway named them. */
	user: string | null;
	fingerprint: string;
	pairedAt: string;
	/**
	 * The passkeys this machine trusts (§6.6 of the protocol): it serves only
	 * sessions one of them signed. Null when it was paired without them, so
	 * it serves every session the gateway opens; empty when they could not be
	 * read, so it refuses every session.
	 */
	passkeys: CloudPasskeyView[] | null;
	/** When they were pinned, or last changed. */
	pinnedAt: string | null;
}

/**
 * A pairing started from the Remotes page, waiting for the captain to type its
 * code on the gateway and pick this fingerprint there; or why it ended.
 */
export interface CloudPairingView {
	gateway: string;
	/** The gateway's own pair page, where the code is typed. */
	verificationUri: string;
	userCode: string;
	fingerprint: string;
	expiresAt: string;
	/** Why the last pairing ended without a machine, if it did. */
	error: string | null;
}

export interface CloudView {
	schema: 'wheelhouse-cloud.v1';
	/** The cloud may be used here at all (`wheelhouse remote on`/`off`; Start and Stop set it too). */
	enabled: boolean;
	/** Started on the Remotes page: `wheelhouse open` keeps the connection up while this is on. */
	started: boolean;
	/** The gateway's origin: DEFAULT_GATEWAY unless the captain named another. */
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
	/** A pairing the Remotes page started (the server fills it in; null elsewhere). */
	pairing?: CloudPairingView | null;
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
