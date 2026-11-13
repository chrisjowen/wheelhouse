import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { fingerprint } from './protocol';

/**
 * The captain's passkeys as this machine pins them, and the check it makes
 * itself of a passkey's signature (§2.1 of the protocol, version 2): with
 * passkeys pinned, the machine serves only sessions one of them signed, so
 * the gateway cannot open a session on its own.
 */

/** A passkey as the gateway hands it over to pin. */
export interface PinnedPasskey {
	/** The credential id, b64u. */
	id: string;
	/** b64u of the public key as SPKI DER. */
	publicKey: string;
	/** The COSE algorithm: -7 (ES256), -8 (EdDSA) or -257 (RS256). */
	alg: number;
	/** The captain's name for it, for showing only. */
	name: string;
}

/** A list of pins has 1 to this many passkeys. */
export const MAX_PINS = 20;

const B64U = /^[A-Za-z0-9_-]+$/;
const isB64u = (v: unknown, max: number): v is string =>
	typeof v === 'string' && v.length <= max && B64U.test(v);

/** The key type each COSE algorithm needs, so a key can't be checked under another's rules. */
function fits(key: KeyObject, alg: number): boolean {
	if (alg === -7) {
		return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
	}
	if (alg === -8) return key.asymmetricKeyType === 'ed25519';
	if (alg === -257) return key.asymmetricKeyType === 'rsa';
	return false;
}

function publicKeyOf(p: PinnedPasskey): KeyObject | null {
	try {
		const key = createPublicKey({
			key: Buffer.from(p.publicKey, 'base64url'),
			format: 'der',
			type: 'spki'
		});
		return fits(key, p.alg) ? key : null;
	} catch {
		return null;
	}
}

/** §2.1: a list of passkeys to pin, or null when it is empty, too long, or any entry is malformed. */
export function parsePasskeys(v: unknown): PinnedPasskey[] | null {
	if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PINS) return null;
	const out: PinnedPasskey[] = [];
	for (const p of v) {
		if (typeof p !== 'object' || p === null) return null;
		const { id, publicKey, alg, name } = p as Record<string, unknown>;
		if (!isB64u(id, 1024) || !isB64u(publicKey, 4096) || typeof alg !== 'number') return null;
		const pin = { id, publicKey, alg, name: typeof name === 'string' ? name.slice(0, 60) : '' };
		if (!publicKeyOf(pin) || out.some((o) => o.id === id)) return null;
		out.push(pin);
	}
	return out;
}

/** §2.1: the fingerprint shown beside a pinned passkey's name: of its SPKI DER, `ABCD-EFGH-IJKL-MNOP`. */
export const passkeyFingerprint = (p: PinnedPasskey) => fingerprint(p.publicKey);

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

/**
 * §2.1: why an assertion is not one of `passkeys` signing `challenge` at the
 * gateway's own `origin` (and its RP ID, the origin's host name) with the
 * captain present and verified; null when it is.
 */
export function assertionProblem(
	assertion: unknown,
	expected: { challenge: string; origin: string; passkeys: PinnedPasskey[] }
): string | null {
	if (typeof assertion !== 'object' || assertion === null) return 'no passkey signature';
	const { id, response: r } = assertion as Record<string, unknown>;
	if (typeof id !== 'string' || typeof r !== 'object' || r === null) {
		return 'a malformed passkey signature';
	}
	const passkey = expected.passkeys.find((p) => p.id === id);
	if (!passkey) return 'signed with a passkey this machine does not trust';
	const { clientDataJSON, authenticatorData, signature } = r as Record<string, unknown>;
	if (
		!isB64u(clientDataJSON, 8192) ||
		!isB64u(authenticatorData, 8192) ||
		!isB64u(signature, 2048)
	) {
		return 'a malformed passkey signature';
	}
	const clientData = Buffer.from(clientDataJSON, 'base64url');
	let c: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(clientData.toString('utf8'));
		if (typeof parsed !== 'object' || parsed === null) return 'malformed client data';
		c = parsed as Record<string, unknown>;
	} catch {
		return 'malformed client data';
	}
	if (c.type !== 'webauthn.get') return 'not a passkey sign-in';
	if (c.challenge !== expected.challenge) return 'signed another challenge';
	if (c.origin !== expected.origin) return 'signed for another site';
	if (c.crossOrigin !== undefined && c.crossOrigin !== false) return 'signed inside another site';
	const authData = Buffer.from(authenticatorData, 'base64url');
	if (authData.length < 37) return 'malformed authenticator data';
	const rpId = URL.parse(expected.origin)?.hostname ?? '';
	if (!authData.subarray(0, 32).equals(sha256(rpId))) return 'signed for another site';
	const flags = authData[32];
	if (!(flags & 0x01) || !(flags & 0x04)) return 'the passkey did not verify the captain';
	const key = publicKeyOf(passkey);
	if (!key) return 'a pinned passkey is malformed';
	const signed = Buffer.concat([authData, sha256(clientData)]);
	try {
		const ok = verify(
			passkey.alg === -8 ? null : 'sha256',
			signed,
			key,
			Buffer.from(signature, 'base64url')
		);
		return ok ? null : 'a bad passkey signature';
	} catch {
		return 'a bad passkey signature';
	}
}
