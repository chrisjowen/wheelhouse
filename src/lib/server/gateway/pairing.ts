import { randomBytes, timingSafeEqual } from 'node:crypto';
import { normaliseCode, PAIRING_MS } from '../../gateway';

/**
 * Pairing a chat account with the gateway. The captain starts it in
 * Wheelhouse's own Settings page (behind the loopback, Origin and session
 * token checks), which shows a one-time code for ten minutes; whoever sends
 * that code to the bot in a direct message becomes the one account the
 * channel answers. Strangers' messages count as wrong tries, and enough of
 * them end the pairing, so the code cannot be guessed; they are never told
 * anything either way.
 */

/** No 0/O or 1/I, so a code read off the screen types back the same. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
/** Wrong codes allowed before the pairing is called off. */
export const PAIRING_MAX_TRIES = 5;

export type Offer = 'match' | 'wrong' | 'closed';

export class Pairing {
	private code: string | null = null;
	private expires = 0;
	private tries = 0;
	/** Why the last pairing ended without pairing, when it did. */
	note: string | null = null;

	constructor(
		private now: () => number = Date.now,
		private random: (n: number) => Buffer = randomBytes
	) {}

	/** Start (or restart) a pairing; the code is returned once, formatted to read aloud. */
	start(): { code: string; expiresAt: string } {
		const bytes = this.random(CODE_LENGTH);
		// 256 is a multiple of 32, so each letter is equally likely.
		this.code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
		this.expires = this.now() + PAIRING_MS;
		this.tries = 0;
		this.note = null;
		return {
			code: `${this.code.slice(0, 4)}-${this.code.slice(4)}`,
			expiresAt: new Date(this.expires).toISOString()
		};
	}

	cancel(note: string | null = null): void {
		this.code = null;
		this.note = note;
	}

	/** The pairing waiting for its code, if any. */
	open(): { expiresAt: string } | null {
		if (this.code && this.now() >= this.expires) this.cancel('The pairing code expired.');
		return this.code ? { expiresAt: new Date(this.expires).toISOString() } : null;
	}

	/**
	 * A direct message: is it the code? A match ends the pairing. From an
	 * account that is not paired, anything else counts as a wrong try; the
	 * paired account's ordinary messages (`count: false`) do not.
	 */
	offer(text: string, { count = true }: { count?: boolean } = {}): Offer {
		if (!this.open() || !this.code) return 'closed';
		const given = Buffer.from(normaliseCode(text));
		const want = Buffer.from(this.code);
		if (given.length === want.length && timingSafeEqual(given, want)) {
			this.code = null;
			this.note = null;
			return 'match';
		}
		if (!count) return 'wrong';
		this.tries++;
		if (this.tries >= PAIRING_MAX_TRIES) {
			this.cancel(
				`The pairing was called off after ${PAIRING_MAX_TRIES} messages that were not the code. Start it again to get a new code.`
			);
		}
		return 'wrong';
	}
}
