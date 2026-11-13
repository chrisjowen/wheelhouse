import {
	assertionProblem,
	newChallenge,
	parsePasskeys,
	type ChallengePurpose,
	type PinnedPasskey
} from './passkeys';

/**
 * Which relay sessions this machine serves (§6.6 of the protocol, version 2).
 * A machine with pinned passkeys answers each session the gateway wants to
 * open with a fresh challenge, checks the captain's passkey signature over it
 * itself, and serves only a session it verified, for at most 8 hours and not
 * after the session ends. Each challenge works once and only for what it was
 * issued for, so a replayed signature, or one made for another session or
 * purpose, is refused.
 *
 * Changing the pins takes two steps, and the gateway can only start them: a
 * new list signed by a passkey this machine already trusts is kept as the
 * one pending change, and becomes what it trusts only once the captain
 * approves it here, on this machine (the Remotes page or `wheelhouse remote
 * pins`), never through the gateway. Until then sessions are checked against
 * the passkeys trusted now. A change nobody decides on expires after an hour.
 *
 * A machine paired without pins (by a gateway that spoke only version 1, or
 * before Wheelhouse spoke 2) serves every session, as version 1 did.
 * Verified sessions live in memory: they outlast a reconnect, not a restart.
 */

/** A challenge is good this long: the passkey prompt's 5 minutes, and one more. */
export const CHALLENGE_TTL_MS = 6 * 60_000;
/** A verified session is served this long at most, whatever the gateway says. */
export const VERIFIED_SESSION_MS = 8 * 60 * 60_000;
/** A pending change of pins nobody approves or rejects lapses after this long. */
export const PENDING_PINS_MS = 60 * 60_000;
/** At most this many challenges wait for a signature, and this many verified sessions are kept. */
const MAX_CHALLENGES = 16;
const MAX_VERIFIED = 64;

type Obj = Record<string, unknown>;

/** A new list of passkeys a trusted one signed: the pending change, until the captain decides here. */
export interface PinsProposal {
	/** The gateway's reference for the update. */
	ref: string;
	passkeys: PinnedPasskey[];
	/** The name of the trusted passkey that signed it. */
	signedBy: string;
}

export interface SessionGuardOptions {
	/** The gateway's origin: passkeys sign for it, and for its host name as the RP ID. */
	origin: string;
	/** The passkeys this machine trusts; null when it was paired without (it then checks nothing). */
	pins: PinnedPasskey[] | null;
	/** Keep a signed change as the pending one, for the captain to approve or reject here. */
	propose: (proposal: PinsProposal) => Promise<void>;
	log?: (line: string) => void;
	now?: () => number;
}

const idOf = (v: unknown) =>
	typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : undefined;

export class SessionGuard {
	private pinned: PinnedPasskey[] | null;
	/** Challenges issued and not yet seen signed, by purpose and session id or ref. */
	private challenges = new Map<string, { challenge: string; expires: number }>();
	/** Sessions a trusted passkey signed, and when. */
	private verified = new Map<string, number>();
	/** Sessions whose streams were refused, so each is logged once. */
	private refused = new Set<string>();
	private readonly now: () => number;

	constructor(private opts: SessionGuardOptions) {
		this.pinned = opts.pins;
		this.now = opts.now ?? Date.now;
	}

	/** This machine checks every session's passkey signature itself. */
	get checks(): boolean {
		return this.pinned !== null;
	}

	/** The credential ids of the passkeys it trusts, as `auth.pins` names them. */
	get credentials(): string[] {
		return (this.pinned ?? []).map((p) => p.id);
	}

	/**
	 * Why a stream of this relay session is refused (§6.4), or null when it may
	 * be served. The first refusal of each session is logged: a stream of a
	 * session nobody signed is what a gateway acting on its own would send.
	 */
	refusal(sessionId: string): string | null {
		if (!this.checks) return null;
		const at = this.verified.get(sessionId);
		const why =
			at === undefined
				? 'No trusted passkey signed this session.'
				: this.now() - at > VERIFIED_SESSION_MS
					? 'This session was signed more than 8 hours ago; open the machine again.'
					: null;
		if (why && !this.refused.has(sessionId)) {
			this.refused.add(sessionId);
			while (this.refused.size > MAX_VERIFIED) {
				this.refused.delete(this.refused.values().next().value!);
			}
			this.log(`refused the streams of session ${sessionId.slice(0, 8)}: ${why}`);
		}
		return why;
	}

	/** Forget the verified sessions past their 8 hours, returning them so their streams can end. */
	sweep(): string[] {
		const old = [...this.verified].filter(([, at]) => this.now() - at > VERIFIED_SESSION_MS);
		for (const [id] of old) this.verified.delete(id);
		return old.map(([id]) => id);
	}

	/**
	 * A `session.*` or `pins.*` control message from the gateway, and the
	 * answer to send back (none for `session.end`, or one that is not for it).
	 */
	async handle(msg: Obj): Promise<Obj | null> {
		const sessionId = idOf(msg.sessionId);
		const ref = idOf(msg.ref);
		switch (msg.t) {
			case 'session.challenge':
				return sessionId
					? { t: 'session.challenge', sessionId, ...this.issue('session', sessionId) }
					: null;
			case 'pins.challenge':
				return ref ? { t: 'pins.challenge', ref, ...this.issue('pins', ref) } : null;
			case 'session.verify': {
				if (!sessionId) return null;
				const problem = this.spend('session', sessionId, msg.assertion);
				if (problem) {
					this.log(`refused to open session ${sessionId.slice(0, 8)}: ${problem}`);
					return { t: 'session.verified', sessionId, ok: false, reason: problem };
				}
				this.verified.delete(sessionId);
				this.verified.set(sessionId, this.now());
				while (this.verified.size > MAX_VERIFIED) {
					this.verified.delete(this.verified.keys().next().value!);
				}
				this.log(`session ${sessionId.slice(0, 8)} was signed with a trusted passkey.`);
				return { t: 'session.verified', sessionId, ok: true };
			}
			case 'session.end':
				if (sessionId) this.verified.delete(sessionId);
				return null;
			case 'pins.update':
				return ref ? this.proposed(ref, msg) : null;
			default:
				return null;
		}
	}

	/**
	 * The answer to a `session.*` or `pins.*` request on a connection that may
	 * not have sessions signed (a gateway that negotiated protocol 1): nothing
	 * is issued, checked or kept, and `why` says so.
	 */
	refuse(msg: Obj, why: string): Obj | null {
		const sessionId = idOf(msg.sessionId);
		const ref = idOf(msg.ref);
		switch (msg.t) {
			case 'session.challenge':
				return sessionId
					? { t: 'session.challenge', sessionId, challenge: null, error: why }
					: null;
			case 'session.verify':
				return sessionId ? { t: 'session.verified', sessionId, ok: false, reason: why } : null;
			case 'pins.challenge':
				return ref ? { t: 'pins.challenge', ref, challenge: null, error: why } : null;
			case 'pins.update':
				return ref ? { t: 'pins.updated', ref, ok: false, reason: why } : null;
			default:
				return null;
		}
	}

	/** The captain approved the pending change here: trust its passkeys from now on. */
	repin(pins: PinnedPasskey[]): void {
		this.pinned = pins;
		this.log(`now trusts ${pins.map((p) => p.name || p.id.slice(0, 8)).join(', ')}.`);
	}

	/**
	 * `pins.update`: a new list, signed by a passkey trusted now (never one on
	 * the new list alone), is kept as the pending change for the captain to
	 * approve here; it changes nothing until they do.
	 */
	private async proposed(ref: string, msg: Obj): Promise<Obj> {
		const signedBy = this.pinned?.find((p) => p.id === (msg.assertion as Obj | null)?.id);
		const problem = this.spend('pins', ref, msg.assertion);
		const passkeys = parsePasskeys(msg.passkeys);
		const refused = problem ?? (passkeys ? null : 'the new list of passkeys is malformed');
		if (refused || !passkeys) {
			this.log(`kept its trusted passkeys: ${refused}`);
			return { t: 'pins.updated', ref, ok: false, reason: refused };
		}
		try {
			await this.opts.propose({ ref, passkeys, signedBy: signedBy?.name ?? '' });
		} catch (e) {
			const reason = `the new passkeys could not be kept: ${(e as Error).message}`.slice(0, 200);
			this.log(`kept its trusted passkeys: ${reason}`);
			return { t: 'pins.updated', ref, ok: false, reason };
		}
		this.log(
			`was asked to trust ${passkeys.map((p) => p.name || p.id.slice(0, 8)).join(', ')} instead; approve or reject that on the Remotes page.`
		);
		return { t: 'pins.updated', ref, ok: true, pending: true };
	}

	private log(line: string): void {
		this.opts.log?.(line);
	}

	/** A fresh challenge for one session or pins update, and the passkeys that may sign it. */
	private issue(purpose: ChallengePurpose, id: string): Obj {
		if (!this.pinned?.length) {
			return { challenge: null, error: 'this machine has no pinned passkeys' };
		}
		const now = this.now();
		for (const [k, c] of this.challenges) if (c.expires < now) this.challenges.delete(k);
		const key = `${purpose}:${id}`;
		const challenge = newChallenge(purpose);
		this.challenges.delete(key);
		this.challenges.set(key, { challenge, expires: now + CHALLENGE_TTL_MS });
		while (this.challenges.size > MAX_CHALLENGES) {
			this.challenges.delete(this.challenges.keys().next().value!);
		}
		return { challenge, credentials: this.credentials };
	}

	/**
	 * Use up the challenge issued for this purpose and id, pass or fail, and
	 * check the assertion against it.
	 */
	private spend(purpose: ChallengePurpose, id: string, assertion: unknown): string | null {
		const key = `${purpose}:${id}`;
		const issued = this.challenges.get(key);
		this.challenges.delete(key);
		if (!this.pinned?.length) return 'this machine has no pinned passkeys';
		if (!issued || issued.expires < this.now()) {
			return 'no live challenge for it: never issued, already used, or expired';
		}
		return assertionProblem(assertion, {
			purpose,
			challenge: issued.challenge,
			origin: this.opts.origin,
			passkeys: this.pinned
		});
	}
}
