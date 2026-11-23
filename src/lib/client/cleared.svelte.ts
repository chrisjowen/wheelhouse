import { SESSION_HEADER } from './messages';

const ENDPOINT = '/api/firstmate/cleared';

const time = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * When the captain last cleared the chat's view, kept by the Wheelhouse server
 * (`/api/firstmate/cleared`) so every device shows the same cleared chat. The
 * server's answer to the newest request is what shows.
 */
class Cleared {
	at = $state<string | null>(null);
	private seq = 0;

	/** Reads when the view was cleared from the server again. */
	async refresh() {
		const n = ++this.seq;
		try {
			const res = await fetch(ENDPOINT);
			if (!res.ok) return;
			const data = (await res.json()) as { clearedAt?: unknown };
			if (n === this.seq) this.at = time(data.clearedAt);
		} catch {
			// the server could not be reached; the view stays as it is
		}
	}

	/** Clears the view as of now, or shows everything again; a refused change is undone. */
	async set(cleared: boolean, token: string): Promise<boolean> {
		const before = this.at;
		this.at = cleared ? new Date().toISOString() : null;
		const n = ++this.seq;
		try {
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ cleared })
			});
			if (res.ok) {
				const data = (await res.json().catch(() => null)) as { clearedAt?: unknown } | null;
				if (n === this.seq) this.at = time(data?.clearedAt);
				return true;
			}
		} catch {
			// the server could not be reached
		}
		if (n === this.seq) this.at = before;
		return false;
	}

	/** Forgets the cleared view, as a fresh page does (for tests). */
	reset() {
		this.seq++;
		this.at = null;
	}
}

export const cleared = new Cleared();
