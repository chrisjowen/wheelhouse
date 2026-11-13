import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SoftPasskey } from '../../../../tests/helpers/fake-cloud-gateway';
import { assertionProblem, MAX_PINS, parsePasskeys, passkeyFingerprint } from './passkeys';

/** §2.1 of the protocol: the passkeys a machine pins, and the signatures it checks itself. */

const ORIGIN = 'https://cloud.chrisjowen.net';
const CHALLENGE = Buffer.alloc(32, 9).toString('base64url');

describe('parsePasskeys', () => {
	it('takes ES256, EdDSA and RS256 passkeys, names cut to 60 characters', () => {
		const keys = [
			new SoftPasskey('A'.repeat(80), -7),
			new SoftPasskey('Ed', -8),
			new SoftPasskey('RSA', -257)
		];
		const pins = parsePasskeys(keys.map((k) => k.pin));
		expect(pins?.map((p) => p.alg)).toEqual([-7, -8, -257]);
		expect(pins?.[0].name).toHaveLength(60);
	});

	it('refuses an empty or too long list, another algorithm, a key of the wrong kind and a repeated id', () => {
		const k = new SoftPasskey('Mac');
		expect(parsePasskeys([])).toBeNull();
		expect(parsePasskeys('nope')).toBeNull();
		expect(
			parsePasskeys(Array.from({ length: MAX_PINS + 1 }, () => new SoftPasskey('x', -8).pin))
		).toBeNull();
		expect(parsePasskeys([{ ...k.pin, alg: -35 }])).toBeNull();
		// An Ed25519 key named as ES256 is not checked under ES256's rules.
		expect(parsePasskeys([{ ...new SoftPasskey('Ed', -8).pin, alg: -7 }])).toBeNull();
		expect(parsePasskeys([{ ...k.pin, publicKey: 'not a key' }])).toBeNull();
		expect(parsePasskeys([k.pin, k.pin])).toBeNull();
	});
});

describe('passkeyFingerprint', () => {
	it('is the first 10 bytes of SHA-256 of the SPKI DER, grouped as the gateway shows it', () => {
		const k = new SoftPasskey('Mac');
		const fp = passkeyFingerprint(k.pin);
		expect(fp).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
		const digest = createHash('sha256').update(Buffer.from(k.publicKey, 'base64url')).digest();
		// The first 5 bytes are the first 8 base32 characters.
		let bits = '';
		for (const b of digest.subarray(0, 5)) bits += b.toString(2).padStart(8, '0');
		const first = bits
			.match(/.{5}/g)!
			.map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(c, 2)]);
		expect(fp.slice(0, 9)).toBe(`${first.slice(0, 4).join('')}-${first.slice(4, 8).join('')}`);
	});
});

describe('assertionProblem', () => {
	const check = (assertion: unknown, passkeys = [mac.pin]) =>
		assertionProblem(assertion, { challenge: CHALLENGE, origin: ORIGIN, passkeys });
	const mac = new SoftPasskey('Mac');

	it('accepts a pinned passkey signing this challenge at the gateway, user verified, with each algorithm', () => {
		for (const alg of [-7, -8, -257] as const) {
			const k = new SoftPasskey('k', alg);
			expect(check(k.sign(CHALLENGE, ORIGIN), [k.pin])).toBeNull();
		}
	});

	it('refuses a passkey it does not trust, though it names a trusted one’s id', () => {
		const mallory = new SoftPasskey('Mallory');
		expect(check(mallory.sign(CHALLENGE, ORIGIN))).toMatch(/does not trust/);
		expect(check({ ...mallory.sign(CHALLENGE, ORIGIN), id: mac.id })).toMatch(
			/bad passkey signature/
		);
	});

	it('refuses another challenge, another site, another RP ID and a signature made inside another site', () => {
		expect(check(mac.sign(Buffer.alloc(32, 1).toString('base64url'), ORIGIN))).toMatch(
			/another challenge/
		);
		expect(check(mac.sign(CHALLENGE, ORIGIN, { origin: 'https://evil.example' }))).toMatch(
			/another site/
		);
		expect(check(mac.sign(CHALLENGE, ORIGIN, { rpId: 'evil.example' }))).toMatch(/another site/);
		expect(check(mac.sign(CHALLENGE, ORIGIN, { crossOrigin: true }))).toMatch(
			/inside another site/
		);
	});

	it('refuses a passkey registration and a signature without the user present and verified', () => {
		expect(check(mac.sign(CHALLENGE, ORIGIN, { type: 'webauthn.create' }))).toMatch(
			/not a passkey sign-in/
		);
		expect(check(mac.sign(CHALLENGE, ORIGIN, { flags: 0x01 }))).toMatch(/did not verify/);
		expect(check(mac.sign(CHALLENGE, ORIGIN, { flags: 0x04 }))).toMatch(/did not verify/);
	});

	it('refuses what was changed after signing, and anything malformed', () => {
		const a = mac.sign(CHALLENGE, ORIGIN);
		const flipped = Buffer.from(a.response.authenticatorData, 'base64url');
		flipped[36] ^= 1;
		expect(
			check({
				...a,
				response: { ...a.response, authenticatorData: flipped.toString('base64url') }
			})
		).toMatch(/bad passkey signature/);
		expect(
			check({
				...a,
				response: { ...a.response, authenticatorData: Buffer.alloc(36).toString('base64url') }
			})
		).toMatch(/malformed authenticator data/);
		expect(check({ ...a, response: { ...a.response, clientDataJSON: 'bm90IGpzb24' } })).toMatch(
			/malformed client data/
		);
		expect(check({ ...a, response: { ...a.response, signature: 'not base64url!' } })).toMatch(
			/malformed/
		);
		expect(check(undefined)).toMatch(/no passkey signature/);
		expect(check({ id: mac.id })).toMatch(/malformed/);
	});

	it('refuses a pinned key that is not what its algorithm says, even with a good signature', () => {
		const { publicKey } = generateKeyPairSync('ed25519');
		const odd = {
			...mac.pin,
			publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
		};
		expect(check(mac.sign(CHALLENGE, ORIGIN), [odd])).toMatch(/malformed/);
	});
});
