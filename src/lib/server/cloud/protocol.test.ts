import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintOf } from '../../../../tests/helpers/fake-cloud-gateway';
import {
	backoffMs,
	closeAction,
	connectSig,
	decodeFrame,
	encodeFrame,
	exportKey,
	fingerprint,
	importKey,
	isRestartPath,
	newDeviceKey,
	pollSig,
	unpairSig
} from './protocol';

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const check = (publicKey: string, message: string, sig: string) =>
	verify(
		null,
		Buffer.from(message),
		createPublicKey({
			key: Buffer.concat([SPKI, Buffer.from(publicKey, 'base64url')]),
			format: 'der',
			type: 'spki'
		}),
		Buffer.from(sig, 'base64url')
	);

describe('device keys', () => {
	it('puts the raw 32-byte public key on the wire', () => {
		const k = newDeviceKey();
		expect(Buffer.from(k.publicKey, 'base64url')).toHaveLength(32);
		expect(k.publicKey).not.toContain('=');
	});

	it('keeps the private key as one Keychain-safe line and reads it back', () => {
		const k = newDeviceKey();
		const stored = exportKey(k);
		expect(stored).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(importKey(`${stored}\n`)?.publicKey).toBe(k.publicKey);
		expect(importKey('not a key')).toBeNull();
		expect(importKey('A'.repeat(64))).toBeNull();
	});

	it('shows the fingerprint as four groups of base32, the same as the gateway computes', () => {
		const k = newDeviceKey();
		expect(fingerprint(k.publicKey)).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
		expect(fingerprint(k.publicKey)).toBe(fingerprintOf(k.publicKey));
		// The all-zero key, checked against Python's hashlib and base64.b32encode.
		expect(fingerprint(Buffer.alloc(32).toString('base64url'))).toBe('MZUH-VLPY-MK6X-O3EP');
	});

	it('signs each purpose with its own context string', () => {
		const k = newDeviceKey();
		expect(check(k.publicKey, 'whc-pair-poll-v1\np1', pollSig(k, 'p1'))).toBe(true);
		expect(check(k.publicKey, 'whc-unpair-v1\nd1\n42', unpairSig(k, 'd1', 42))).toBe(true);
		expect(check(k.publicKey, 'whc-connect-v1\nn\nd1', connectSig(k, 'n', 'd1'))).toBe(true);
		// A connect signature is no poll signature.
		expect(check(k.publicKey, 'whc-pair-poll-v1\nd1', connectSig(k, 'n', 'd1'))).toBe(false);
	});
});

describe('frames', () => {
	it('carries kind, a big-endian stream id and the payload', () => {
		const f = encodeFrame(0x03, 0x01020304, Buffer.from('hi'));
		expect([...f.subarray(0, 5)]).toEqual([3, 1, 2, 3, 4]);
		expect(decodeFrame(f)).toEqual({ kind: 3, id: 0x01020304, payload: Buffer.from('hi') });
		expect(decodeFrame(Buffer.from([1, 0, 0]))).toBeNull();
	});
});

describe('the restart refusal', () => {
	it.each([
		'/api/wheelhouse/restart',
		'/API/Wheelhouse/Restart?x=1',
		'/api/wheelhouse%2Frestart',
		'/api/wheelhouse/%72estart',
		'/api/%2577heelhouse/restart',
		'//api//wheelhouse/restart',
		'/api/./wheelhouse/restart',
		'/x/../api/wheelhouse/restart'
	])('refuses %s', (p) => expect(isRestartPath(p)).toBe(true));

	it.each(['/', '/api/wheelhouse/upgrade', '/settings/cloud', '/api/restart'])(
		'lets %s through',
		(p) => expect(isRestartPath(p)).toBe(false)
	);
});

describe('close codes', () => {
	it('stops for an unknown, removed or replaced device and an old protocol', () => {
		expect(closeAction(4401).kind).toBe('stop');
		expect(closeAction(4403)).toMatchObject({ kind: 'stop', forget: true });
		expect(closeAction(4409).kind).toBe('stop');
		expect(closeAction(4426).kind).toBe('stop');
	});

	it('reconnects after anything else, waiting a minute after too many connects', () => {
		for (const c of [1000, 1001, 1006, 1011, 1012, 1013, 4400, 4408]) {
			expect(closeAction(c).kind).toBe('reconnect');
		}
		expect(closeAction(4429)).toMatchObject({ kind: 'reconnect', minDelayMs: 60_000 });
	});

	it('backs off with full jitter, capped at a minute', () => {
		expect(backoffMs(0, () => 0.999)).toBeLessThan(1000);
		expect(backoffMs(3, () => 0.5)).toBe(4000);
		expect(backoffMs(20, () => 0.999)).toBeLessThan(60_000);
		expect(backoffMs(5, () => 0)).toBe(0);
	});
});
