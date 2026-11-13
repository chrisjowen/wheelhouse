import { describe, expect, it } from 'vitest';
import { SoftPasskey } from '../../../../tests/helpers/fake-cloud-gateway';
import { CHALLENGE_TTL_MS, SessionGuard, VERIFIED_SESSION_MS, type PinsProposal } from './guard';
import type { PinnedPasskey } from './passkeys';

/**
 * §6.6 of the protocol: which sessions a machine serves. These play the
 * gateway's part by hand; connector.test.ts does it over a real socket.
 */

const ORIGIN = 'https://cloud.chrisjowen.net';

function guard(
	pins: PinnedPasskey[] | null,
	over: { propose?: (p: PinsProposal) => Promise<void> } = {}
) {
	let clock = 1_000_000;
	const proposed: PinsProposal[] = [];
	const g = new SessionGuard({
		origin: ORIGIN,
		pins,
		propose: over.propose ?? (async (p) => void proposed.push(p)),
		now: () => clock
	});
	return { g, proposed, tick: (ms: number) => (clock += ms) };
}

/** Ask for a session's challenge, as the gateway does when the captain opens the machine. */
async function challenge(g: SessionGuard, sessionId: string): Promise<string> {
	const r = await g.handle({ t: 'session.challenge', sessionId });
	return r!.challenge as string;
}

const verify = (g: SessionGuard, sessionId: string, assertion: unknown) =>
	g.handle({ t: 'session.verify', sessionId, assertion });

describe('a machine with pinned passkeys', () => {
	const mac = new SoftPasskey('MacBook Touch ID');

	it('refuses a session the gateway opens on its own, signed or not', async () => {
		const { g } = guard([mac.pin]);
		expect(g.refusal('s-1')).toMatch(/No trusted passkey signed/);
		// Handing over a signature for a challenge the machine never issued gets nowhere either.
		expect(await verify(g, 's-1', mac.sign('made-up', ORIGIN))).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/no live challenge/)
		});
		expect(g.refusal('s-1')).not.toBeNull();
	});

	it('serves a session a pinned passkey signed, and only that one', async () => {
		const { g } = guard([mac.pin]);
		const r = await g.handle({ t: 'session.challenge', sessionId: 's-1' });
		expect(r).toMatchObject({ t: 'session.challenge', sessionId: 's-1', credentials: [mac.id] });
		expect(Buffer.from(r!.challenge as string, 'base64url').toString('latin1')).toMatch(
			/^whc-session-v2\n[\s\S]{32}$/
		);
		expect(await verify(g, 's-1', mac.sign(r!.challenge as string, ORIGIN))).toEqual({
			t: 'session.verified',
			sessionId: 's-1',
			ok: true
		});
		expect(g.refusal('s-1')).toBeNull();
		expect(g.refusal('s-2')).not.toBeNull();
	});

	it('refuses a replayed challenge: for the same session, and for another', async () => {
		const { g } = guard([mac.pin]);
		const c = await challenge(g, 's-1');
		const signed = mac.sign(c, ORIGIN);
		expect(await verify(g, 's-1', signed)).toMatchObject({ ok: true });
		expect(await verify(g, 's-1', signed)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/already used/)
		});
		await challenge(g, 's-2');
		expect(await verify(g, 's-2', signed)).toMatchObject({
			ok: false,
			reason: 'signed another challenge'
		});
		expect(g.refusal('s-2')).not.toBeNull();
	});

	it('spends a challenge at its first check, even one that fails', async () => {
		const { g } = guard([mac.pin]);
		const c = await challenge(g, 's-1');
		expect(await verify(g, 's-1', new SoftPasskey('Mallory').sign(c, ORIGIN))).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/does not trust/)
		});
		expect(await verify(g, 's-1', mac.sign(c, ORIGIN))).toMatchObject({ ok: false });
	});

	it('lets a challenge lapse after 6 minutes', async () => {
		const { g, tick } = guard([mac.pin]);
		const c = await challenge(g, 's-1');
		tick(CHALLENGE_TTL_MS + 1);
		expect(await verify(g, 's-1', mac.sign(c, ORIGIN))).toMatchObject({ ok: false });
	});

	it('keeps at most 16 challenges waiting, dropping the oldest', async () => {
		const { g } = guard([mac.pin]);
		const first = await challenge(g, 's-0');
		for (let i = 1; i <= 16; i++) await challenge(g, `s-${i}`);
		expect(await verify(g, 's-0', mac.sign(first, ORIGIN))).toMatchObject({ ok: false });
	});

	it('stops serving a session once it ends, and 8 hours after it was signed', async () => {
		const { g, tick } = guard([mac.pin]);
		for (const id of ['s-1', 's-2']) await verify(g, id, mac.sign(await challenge(g, id), ORIGIN));
		await g.handle({ t: 'session.end', sessionId: 's-1' });
		expect(g.refusal('s-1')).not.toBeNull();
		tick(VERIFIED_SESSION_MS - 1000);
		expect(g.refusal('s-2')).toBeNull();
		expect(g.sweep()).toEqual([]);
		tick(2000);
		expect(g.refusal('s-2')).toMatch(/more than 8 hours ago/);
		expect(g.sweep()).toEqual(['s-2']);
	});

	it('names the passkeys it trusts when it connects', () => {
		expect(guard([mac.pin]).g.credentials).toEqual([mac.id]);
		expect(guard([mac.pin]).g.checks).toBe(true);
	});
});

describe('changing the pins', () => {
	const mac = new SoftPasskey('MacBook Touch ID');
	const phone = new SoftPasskey('iPhone');

	async function update(g: SessionGuard, passkeys: unknown[], signer: SoftPasskey) {
		const c = await g.handle({ t: 'pins.challenge', ref: 'r-1' });
		return g.handle({
			t: 'pins.update',
			ref: 'r-1',
			passkeys,
			assertion: signer.sign(c!.challenge as string, ORIGIN)
		});
	}

	it('keeps a new list a trusted passkey signed as pending, and changes nothing until it is approved here', async () => {
		const { g, proposed } = guard([mac.pin]);
		expect(await update(g, [mac.pin, phone.pin], mac)).toEqual({
			t: 'pins.updated',
			ref: 'r-1',
			ok: true,
			pending: true
		});
		expect(proposed).toEqual([
			{ ref: 'r-1', passkeys: [mac.pin, phone.pin], signedBy: 'MacBook Touch ID' }
		]);
		// Still the old pins: a passkey only the pending list has opens nothing.
		expect(g.credentials).toEqual([mac.id]);
		expect(await verify(g, 's-1', phone.sign(await challenge(g, 's-1'), ORIGIN))).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/does not trust/)
		});
		// Approved here, it is trusted.
		g.repin([mac.pin, phone.pin]);
		expect(g.credentials).toEqual([mac.id, phone.id]);
		expect(await verify(g, 's-2', phone.sign(await challenge(g, 's-2'), ORIGIN))).toMatchObject({
			ok: true
		});
	});

	it('refuses a list signed by a passkey it does not trust yet, even one on the new list', async () => {
		const { g, proposed } = guard([mac.pin]);
		expect(await update(g, [mac.pin, phone.pin], phone)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/does not trust/)
		});
		expect(proposed).toEqual([]);
		expect(g.credentials).toEqual([mac.id]);
	});

	it('refuses a session’s signature as a change of pins, and a change’s signature as a session', async () => {
		const { g, proposed } = guard([mac.pin]);
		const session = await challenge(g, 'same-id');
		await g.handle({ t: 'pins.challenge', ref: 'same-id' });
		expect(
			await g.handle({
				t: 'pins.update',
				ref: 'same-id',
				passkeys: [mac.pin, phone.pin],
				assertion: mac.sign(session, ORIGIN)
			})
		).toMatchObject({ ok: false, reason: 'signed a challenge for another purpose' });
		expect(proposed).toEqual([]);
		const pins = (await g.handle({ t: 'pins.challenge', ref: 'r-2' }))!.challenge as string;
		await challenge(g, 's-1');
		expect(await verify(g, 's-1', mac.sign(pins, ORIGIN))).toMatchObject({
			ok: false,
			reason: 'signed a challenge for another purpose'
		});
		expect(g.refusal('s-1')).not.toBeNull();
	});

	it('refuses a malformed list, and one that cannot be kept for approval', async () => {
		const { g } = guard([mac.pin], {
			propose: async () => {
				throw new Error('disk full');
			}
		});
		expect(await update(g, [], mac)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/malformed/)
		});
		expect(await update(g, [phone.pin], mac)).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/disk full/)
		});
		expect(g.credentials).toEqual([mac.id]);
	});
});

describe('a machine paired without pins', () => {
	it('serves every session, as protocol 1 did, and issues no challenges', async () => {
		const { g } = guard(null);
		expect(g.checks).toBe(false);
		expect(g.credentials).toEqual([]);
		expect(g.refusal('s-1')).toBeNull();
		expect(await g.handle({ t: 'session.challenge', sessionId: 's-1' })).toMatchObject({
			challenge: null,
			error: expect.any(String)
		});
	});

	it('but one whose pins could not be read refuses every session', async () => {
		const { g } = guard([]);
		expect(g.checks).toBe(true);
		expect(g.refusal('s-1')).not.toBeNull();
		expect(await g.handle({ t: 'session.challenge', sessionId: 's-1' })).toMatchObject({
			challenge: null
		});
	});
});
