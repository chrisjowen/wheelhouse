import { createHash, createPublicKey, sign, X509Certificate, type KeyObject } from 'node:crypto';

/**
 * Just enough DER for this machine's origin certificate (§12.2 of the
 * protocol): build the PKCS#10 request the connector sends, and read what a
 * returned certificate says about its names and its embedded signed
 * certificate timestamps. Node reads certificates but writes no requests, and
 * its X509Certificate has no view of SCTs.
 */

const OID = {
	ecdsaWithSha256: '1.2.840.10045.4.3.2',
	extensionRequest: '1.2.840.113549.1.9.14',
	subjectAltName: '2.5.29.17',
	/** RFC 6962 §3.3: the SignedCertificateTimestampList embedded in a certificate. */
	embeddedScts: '1.3.6.1.4.1.11129.2.4.2'
};
/** The extended key usage a TLS server certificate needs. */
export const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

// ---- reading ----

interface Tlv {
	tag: number;
	value: Buffer;
}

/** One DER element at `at`; throws on anything this reader doesn't take (high tags, indefinite lengths). */
function read(buf: Buffer, at = 0): Tlv & { end: number } {
	if (at + 2 > buf.length) throw new Error('truncated DER');
	const tag = buf[at];
	if ((tag & 0x1f) === 0x1f) throw new Error('unsupported DER tag');
	let len = buf[at + 1];
	let head = 2;
	if (len & 0x80) {
		const n = len & 0x7f;
		if (n === 0 || n > 4 || at + 2 + n > buf.length) throw new Error('bad DER length');
		len = 0;
		for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i];
		if (len < 0x80) throw new Error('non-minimal DER length');
		head += n;
	}
	const end = at + head + len;
	if (end > buf.length) throw new Error('truncated DER');
	return { tag, value: buf.subarray(at + head, end), end };
}

/** The elements inside a constructed one, which must fill it exactly. */
function children(value: Buffer): Tlv[] {
	const out: Tlv[] = [];
	for (let at = 0; at < value.length;) {
		const t = read(value, at);
		out.push(t);
		at = t.end;
	}
	return out;
}

/** Reads exactly one element filling `buf`. */
function only(buf: Buffer): Tlv {
	const t = read(buf);
	if (t.end !== buf.length) throw new Error('trailing DER');
	return t;
}

function decodeOid(value: Buffer): string {
	if (!value.length) throw new Error('empty OID');
	const parts: number[] = [];
	let n = 0;
	for (const byte of value) {
		n = n * 128 + (byte & 0x7f);
		if (!(byte & 0x80)) {
			parts.push(n);
			n = 0;
		}
	}
	const first = parts.shift()!;
	const top = Math.min(2, Math.floor(first / 40));
	return [top, first - top * 40, ...parts].join('.');
}

/** The DNS names of a GeneralNames; throws on any other kind of name, which a machine never asks for. */
function dnsNames(generalNames: Buffer): string[] {
	return children(only(generalNames).value).map((n) => {
		if (n.tag !== 0x82) throw new Error('only DNS names are allowed');
		return n.value.toString('latin1');
	});
}

/** A certificate's extensions by OID; a repeated extension is refused. */
function certificateExtensions(cert: X509Certificate): Map<string, Buffer> {
	const [tbs] = children(only(cert.raw).value);
	const holder = children(tbs.value).find((t) => t.tag === 0xa3);
	const out = new Map<string, Buffer>();
	if (!holder) return out;
	for (const ext of children(only(holder.value).value)) {
		const parts = children(ext.value);
		const oid = decodeOid(parts[0].value);
		const value = parts[parts.length - 1];
		if (value.tag !== 0x04) throw new Error('bad extension');
		if (out.has(oid)) throw new Error('repeated extension');
		out.set(oid, value.value);
	}
	return out;
}

/** The DNS names in a certificate's subject alternative names (none when it has none). */
export function certificateDnsNames(cert: X509Certificate): string[] {
	const san = certificateExtensions(cert).get(OID.subjectAltName);
	return san ? dnsNames(san) : [];
}

/**
 * How many signed certificate timestamps a certificate embeds (RFC 6962
 * §3.3): its SignedCertificateTimestampList, a TLS-encoded list inside an
 * OCTET STRING. A malformed list counts as none.
 */
export function embeddedSctCount(cert: X509Certificate): number {
	try {
		const ext = certificateExtensions(cert).get(OID.embeddedScts);
		if (!ext) return 0;
		const list = only(ext);
		if (list.tag !== 0x04 || list.value.length < 2) return 0;
		const body = list.value;
		if (body.readUInt16BE(0) !== body.length - 2) return 0;
		let count = 0;
		for (let at = 2; at < body.length; count++) {
			if (at + 2 > body.length) return 0;
			const len = body.readUInt16BE(at);
			if (len === 0 || at + 2 + len > body.length) return 0;
			at += 2 + len;
		}
		return count;
	} catch {
		return 0;
	}
}

// ---- writing ----

function length(n: number): Buffer {
	if (n < 0x80) return Buffer.from([n]);
	const bytes: number[] = [];
	for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
	return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...content: Buffer[]): Buffer {
	const body = Buffer.concat(content);
	return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

function encodeOid(oid: string): Buffer {
	const [a, b, ...rest] = oid.split('.').map(Number);
	const out = [a * 40 + b];
	for (const n of rest) {
		const chunk = [n & 0x7f];
		for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) {
			chunk.unshift((v & 0x7f) | 0x80);
		}
		out.push(...chunk);
	}
	return der(0x06, Buffer.from(out));
}

/**
 * A PKCS#10 request for exactly `names` (as DNS subject alternative names,
 * with an empty subject), signed with `privateKey`, an ECDSA P-256 key. DER.
 */
export function createCertificateRequest(privateKey: KeyObject, names: string[]): Buffer {
	const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
	const san = der(
		0x30,
		encodeOid(OID.subjectAltName),
		der(0x04, der(0x30, ...names.map((n) => der(0x82, Buffer.from(n, 'latin1')))))
	);
	const attributes = der(
		0xa0,
		der(0x30, encodeOid(OID.extensionRequest), der(0x31, der(0x30, san)))
	);
	const info = der(0x30, der(0x02, Buffer.from([0])), der(0x30), spki, attributes);
	const sig = sign('sha256', info, privateKey);
	return der(
		0x30,
		info,
		der(0x30, encodeOid(OID.ecdsaWithSha256)),
		der(0x03, Buffer.from([0]), sig)
	);
}

// ---- PEM ----

export function toPem(label: string, body: Buffer): string {
	const lines = body
		.toString('base64')
		.match(/.{1,64}/g)!
		.join('\n');
	return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** Every certificate in a PEM chain, in order. */
export function pemCertificates(pem: string): X509Certificate[] {
	return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map(
		(m) => new X509Certificate(m[0])
	);
}

/** SHA-256 of a key's SubjectPublicKeyInfo, hex: what names one key across certificates (§12.8). */
export function spkiSha256(key: KeyObject): string {
	const pub = key.type === 'public' ? key : createPublicKey(key);
	return createHash('sha256')
		.update(pub.export({ format: 'der', type: 'spki' }))
		.digest('hex');
}
