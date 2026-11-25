import { onStreamLost } from './stream';

/**
 * A page that came through Wheelhouse Cloud, coming back to its remote
 * session in place (the gateway's protocol §6.6). When one of its streams is
 * lost, or any request is answered 401 with `X-WHC-Session: ended`, it asks
 * the gateway, at `/__whc/session` on the relay's own origin, whether the
 * session is still live:
 *
 * - live and the machine online: nothing to do here (Wheelhouse itself may be
 *   down, which the notice strip already says);
 * - live and the machine offline: it says so and asks again until the machine
 *   is back (relay sessions outlast half an hour offline, and the streams
 *   reopen by themselves);
 * - ended: it says so, with Sign in again, which goes to the gateway's resume
 *   page for this machine and comes straight back to this page.
 *
 * A page served on this computer directly never asks.
 */

export type RemoteSessionState = 'live' | 'offline' | 'ended';

/** The gateway's answer about this page's relay session, on the relay's origin. */
export const SESSION_PATH = '/__whc/session';
/** Where the gateway signs in again by itself when it named no resume page. */
export const RESUME_PATH = '/__whc/resume';
/** The header the gateway marks a request of an ended session with, on its 401. */
export const SESSION_HEADER = 'x-whc-session';
/** How often to ask again while the machine is offline, and at most how often a lost stream asks. */
export const RECHECK_MS = 10_000;

/** The gateway's answer read, or null when it is not one (an older gateway, say). */
export function readSessionAnswer(
	v: unknown
): { state: RemoteSessionState; resume: string | null } | null {
	if (typeof v !== 'object' || v === null) return null;
	const a = v as Record<string, unknown>;
	const resume = typeof a.resume === 'string' && /^https?:\/\//.test(a.resume) ? a.resume : null;
	if (a.live === false) return { state: 'ended', resume };
	if (a.live !== true) return null;
	return { state: a.machine === 'offline' ? 'offline' : 'live', resume };
}

/** Where Sign in again goes, coming back to `at` (this page's path and query). */
export function resumeHref(resume: string | null, at: { pathname: string; search: string }) {
	const next = `?next=${encodeURIComponent(at.pathname + at.search)}`;
	return resume ? `${resume}${next}` : `${RESUME_PATH}${next}`;
}

export class RemoteSession {
	state = $state<RemoteSessionState>('live');
	/** The gateway's resume page for this machine, once it named one. */
	resume = $state<string | null>(null);
	private relayed = false;
	private asking: Promise<void> | null = null;
	private askedAt = -Infinity;
	private recheck: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Watch this page's remote session while it came through Wheelhouse Cloud
	 * (`relayed`); returns the way to stop. A page served here gets nothing.
	 */
	start(relayed: boolean): () => void {
		if (!relayed || this.relayed) return () => {};
		this.relayed = true;
		const unlisten = onStreamLost(() => void this.check());
		const original = globalThis.fetch;
		const watched: typeof fetch = async (input, init) => {
			const res = await original(input, init);
			if (res.status === 401 && res.headers.get(SESSION_HEADER) === 'ended') this.ended();
			return res;
		};
		globalThis.fetch = watched;
		this.fetch = original;
		return () => {
			unlisten();
			if (globalThis.fetch === watched) globalThis.fetch = original;
			if (this.recheck) clearTimeout(this.recheck);
			this.recheck = null;
			this.relayed = false;
		};
	}

	/** A request was answered as from an ended session: say so, and learn where to sign in again. */
	ended(): void {
		if (!this.relayed || this.state === 'ended') return;
		this.state = 'ended';
		void this.check(true);
	}

	/**
	 * Ask the gateway whether this page's session is live; at most every
	 * RECHECK_MS unless `now`, and never once it has ended.
	 */
	check(now = false): Promise<void> {
		if (!this.relayed) return Promise.resolve();
		if (this.asking) return this.asking;
		if (!now && (this.state === 'ended' || Date.now() - this.askedAt < RECHECK_MS)) {
			return Promise.resolve();
		}
		this.askedAt = Date.now();
		this.asking = this.ask().finally(() => (this.asking = null));
		return this.asking;
	}

	/** Go to the gateway to sign in again, coming back to this page. */
	signIn(): void {
		const href = resumeHref(this.resume, location);
		if (!this.resume) {
			location.href = href;
			return;
		}
		// The installed Fleetyard app frames the relay's host: the press lets this frame move the top.
		try {
			window.top!.location.href = href;
		} catch {
			location.href = href;
		}
	}

	private fetch: typeof fetch = (...a) => globalThis.fetch(...a);

	private async ask(): Promise<void> {
		let answer: ReturnType<typeof readSessionAnswer> = null;
		try {
			const res = await this.fetch(SESSION_PATH, {
				cache: 'no-store',
				headers: { accept: 'application/json' }
			});
			if (res.ok) answer = readSessionAnswer(await res.json());
		} catch {
			// Not answered: nothing is known, so nothing changes.
		}
		if (!this.relayed) return;
		if (answer?.resume) this.resume = answer.resume;
		// An ended session stays ended, whatever a later answer says.
		if (answer && this.state !== 'ended') this.state = answer.state;
		if (this.recheck) clearTimeout(this.recheck);
		this.recheck = null;
		if (this.state === 'offline') {
			this.recheck = setTimeout(() => void this.check(true), RECHECK_MS);
		}
	}
}

/** This tab's remote session. */
export const remoteSession = new RemoteSession();
