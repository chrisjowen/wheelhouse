import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomUUID,
	sign,
	type KeyObject
} from 'node:crypto';

/**
 * The connector side of the Wheelhouse Cloud protocol, version 2: the device
 * key, its fingerprint, the signed messages and the binary stream frames
 * (passkeys.ts and guard.ts hold what version 2 adds). The protocol itself is
 * documented in the wheelhouse-cloud repository (docs/protocol.md); the
 * section numbers below refer to it.
 */

/**
 * The highest version this connector speaks, sent in `pair/start` and `auth`
 * (§1). The gateway answers with the version it will use: a gateway that
 * speaks only version 1 pairs and relays as before.
 */
export const PROTOCOL = 2;

/**
 * The version a machine with its sealed origin on speaks (§12.7): only a
 * protocol-3 connector that signs the version it announces may take
 * `sealed-origin`. Every other machine speaks PROTOCOL.
 */
export const SEALED_PROTOCOL = 3;

/** §5: the kinds of binary frame. */
export const FRAME_HTTP = 0x01;
export const FRAME_WS_TEXT = 0x02;
export const FRAME_WS_BINARY = 0x03;

/** §4 `ready.limits`, as the protocol fixes them until the gateway says otherwise. */
export interface Limits {
	maxStreams: number;
	window: number;
	maxFrame: number;
	maxBody: number;
	maxWsMessage: number;
	/** A `tls` stream's credit window (§12.3): one stream carries a whole HTTP/2 connection. */
	tlsWindow: number;
}

export const DEFAULT_LIMITS: Limits = {
	maxStreams: 256,
	window: 256 * 1024,
	maxFrame: 64 * 1024,
	maxBody: 32 * 1024 * 1024,
	maxWsMessage: 4 * 1024 * 1024,
	tlsWindow: 1024 * 1024
};

/** §8: a control message, and a header block, at most. */
export const MAX_CONTROL_BYTES = 256 * 1024;
export const MAX_HEADER_BYTES = 64 * 1024;
export const MAX_HEADER_ENTRIES = 200;

export const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

/** The DER prefix of an Ed25519 public key in SPKI form; the raw 32 bytes follow it. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** A device key: the private key, kept as PKCS#8 DER in base64url, and its raw public key. */
export interface DeviceKey {
	privateKey: KeyObject;
	/** b64u of the raw 32-byte public key, as the gateway knows it. */
	publicKey: string;
}

export function newDeviceKey(): DeviceKey {
	const { privateKey } = generateKeyPairSync('ed25519');
	return deviceKey(privateKey);
}

function deviceKey(privateKey: KeyObject): DeviceKey {
	const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
	return { privateKey, publicKey: b64u(der.subarray(SPKI_PREFIX.length)) };
}

/** The private key as it is stored: PKCS#8 DER, base64url (letters, digits, `-` and `_` only). */
export const exportKey = (k: DeviceKey) =>
	b64u(k.privateKey.export({ format: 'der', type: 'pkcs8' }));

/** A stored key back, or null when it is not an Ed25519 private key. */
export function importKey(stored: string): DeviceKey | null {
	const text = stored.trim();
	if (!/^[A-Za-z0-9_-]{40,200}$/.test(text)) return null;
	try {
		const k = createPrivateKey({
			key: Buffer.from(text, 'base64url'),
			format: 'der',
			type: 'pkcs8'
		});
		return k.asymmetricKeyType === 'ed25519' ? deviceKey(k) : null;
	} catch {
		return null;
	}
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Buffer): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
	return out;
}

/** §2: the fingerprint people compare, `ABCD-EFGH-IJKL-MNOP`, of a b64u raw public key. */
export function fingerprint(publicKey: string): string {
	const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest();
	return base32(digest.subarray(0, 10)).match(/.{4}/g)!.join('-');
}

/**
 * The short code Fleetyard shows beside an OpenSSH public key on its approval pages, such as
 * `ABCD EFGH`, so the owner can check it is this computer's key.
 */
export function sshShortCode(publicKey: string): string {
	const data = publicKey.split(/\s+/)[1] ?? '';
	return base32(
		createHash('sha256').update(Buffer.from(data, 'base64')).digest().subarray(0, 5)
	).replace(/(.{4})/, '$1 ');
}

/** §2: a signature over `context` and `fields`, joined by newlines. */
export function signed(key: DeviceKey, context: string, ...fields: (string | number)[]): string {
	const message = [context, ...fields.map(String)].join('\n');
	return b64u(sign(null, Buffer.from(message, 'utf8'), key.privateKey));
}

export const pollSig = (key: DeviceKey, pairingId: string) =>
	signed(key, 'whc-pair-poll-v1', pairingId);
export const unpairSig = (key: DeviceKey, deviceId: string, ts: number) =>
	signed(key, 'whc-unpair-v1', deviceId, ts);
export const connectSig = (key: DeviceKey, nonce: string, deviceId: string) =>
	signed(key, 'whc-connect-v1', nonce, deviceId);
/** §4, §11: a protocol-3 connector signs the version it announces, so it can't be downgraded on the wire. */
export const protocolSig = (key: DeviceKey, nonce: string, deviceId: string, protocol: number) =>
	signed(key, 'whc-connect-v2', nonce, deviceId, protocol);
/** §12.2: the signature on a request for this machine's origin certificate, over the request's DER. */
export const certRequestSig = (key: DeviceKey, deviceId: string, csrDer: Buffer) =>
	signed(key, 'whc-cert-request-v1', deviceId, b64u(createHash('sha256').update(csrDer).digest()));
/** §6.11: the signature on `GET /v1/fleet`. */
export const fleetSig = (key: DeviceKey, deviceId: string, ts: number, nonce: string) =>
	signed(key, 'whc-fleet-v1', deviceId, ts, nonce);

/** The DER prefix of an X25519 public key in SPKI form; the raw 32 bytes follow it. */
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * §11.1: the encryption key a protocol-3 connector names in `auth` (`e2eKey`),
 * new for every connection and signed with the device key. The gateway needs
 * one from every protocol-3 connector; this machine serves no sealed relay
 * with it (§11), only its own origin (§12), so it keeps no private half.
 */
export function e2eKeyBinding(key: DeviceKey, deviceId: string, now = Date.now()) {
	const pub = createPublicKey(generateKeyPairSync('x25519').privateKey);
	const der = pub.export({ format: 'der', type: 'spki' });
	const binding = {
		version: 1 as const,
		deviceId,
		keyId: randomUUID(),
		publicKey: b64u(der.subarray(X25519_SPKI_PREFIX.length)),
		createdAt: now
	};
	const signature = signed(
		key,
		'wheelhouse-e2e-key-v1',
		deviceId,
		binding.keyId,
		binding.publicKey,
		binding.createdAt
	);
	return { ...binding, signature };
}

/** §12.1: a machine label, 20 random base32 characters the gateway draws once per device. */
export const MACHINE_LABEL = /^[a-z2-7]{20}$/;

/**
 * §12.1: one of a machine's own names under the machine domain, its app host
 * `<label>.<domain>` (port 0) or a preview host `p<port>.<label>.<domain>`;
 * null for any other name.
 */
export function machineHost(host: string, domain: string): { label: string; port: number } | null {
	const suffix = `.${domain.toLowerCase()}`;
	const name = host.toLowerCase();
	if (!name.endsWith(suffix)) return null;
	const m = /^(?:p([1-9]\d{0,4})\.)?([a-z2-7]{20})$/.exec(name.slice(0, -suffix.length));
	if (!m) return null;
	const port = m[1] ? Number(m[1]) : 0;
	return port > 65535 ? null : { label: m[2], port };
}

/** §5: one binary frame. */
export function encodeFrame(kind: number, id: number, payload: Buffer | Uint8Array): Buffer {
	const head = Buffer.allocUnsafe(5);
	head[0] = kind;
	head.writeUInt32BE(id, 1);
	return Buffer.concat([head, payload]);
}

export function decodeFrame(data: Buffer): { kind: number; id: number; payload: Buffer } | null {
	if (data.length < 5) return null;
	return { kind: data[0], id: data.readUInt32BE(1), payload: data.subarray(5) };
}

/** §4.2: what a closed device socket means for the connector. */
export type CloseAction =
	| { kind: 'reconnect'; minDelayMs?: number; note?: string }
	| { kind: 'stop'; reason: string; forget?: boolean };

export function closeAction(code: number): CloseAction {
	switch (code) {
		case 4400:
			return { kind: 'reconnect', note: 'the gateway reported a protocol error' };
		case 4401:
			return {
				kind: 'stop',
				reason:
					'The gateway does not know this machine (4401). Pair it again: wheelhouse remote connect.'
			};
		case 4403:
			return {
				kind: 'stop',
				forget: true,
				reason:
					'This machine was removed from Wheelhouse Cloud (4403), so its key was deleted. Pair it again: wheelhouse remote connect.'
			};
		case 4409:
			return {
				kind: 'stop',
				reason:
					'Another connection with this machine’s key replaced this one (4409). Make sure only one Wheelhouse connects, then restart it.'
			};
		case 4426:
			return {
				kind: 'stop',
				reason:
					'The gateway no longer speaks this Wheelhouse’s protocol (4426). Update Wheelhouse: wheelhouse upgrade.'
			};
		case 4429:
			return { kind: 'reconnect', minDelayMs: 60_000, note: 'too many connects' };
		default:
			return { kind: 'reconnect' };
	}
}

/** §4.2: full-jitter backoff before reconnect number `attempt` (0-based). */
export const backoffMs = (attempt: number, random = Math.random) =>
	Math.floor(random() * Math.min(60_000, 1000 * 2 ** attempt));

/** Headers that only make sense for one connection, never relayed (§6.3). */
export const HOP_BY_HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'proxy-connection',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);

/** §6.4: whether a path reaches Wheelhouse's restart, however it is spelled. */
export function isRestartPath(path: string): boolean {
	let p = path.split(/[?#]/, 1)[0];
	for (let i = 0; i < 3; i++) {
		try {
			const d = decodeURIComponent(p);
			if (d === p) break;
			p = d;
		} catch {
			break;
		}
	}
	// Dot segments and doubled or back slashes are resolved the way a server's URL parser would.
	const flat = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
	const normal = URL.parse(flat, 'http://x')?.pathname ?? flat;
	return [flat, normal].some((s) => s.toLowerCase().startsWith('/api/wheelhouse/restart'));
}
