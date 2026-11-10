import { SESSION_HEADER } from './messages';

const ENDPOINT = '/api/firstmate/reactions';

const ids = (v: unknown): string[] | null =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

/**
 * The captain's 👍 on Firstmate's messages, by message id, kept by the
 * Wheelhouse server (`/api/firstmate/reactions`) so every device shows them.
 * The server's answer to the newest request is what shows.
 */
class Reactions {
	liked = $state<string[]>([]);
	private seq = 0;

	/** Reads the marks from the server again. */
	async refresh() {
		const n = ++this.seq;
		try {
			const res = await fetch(ENDPOINT);
			const v = res.ok ? ids(((await res.json()) as { liked?: unknown }).liked) : null;
			if (v && n === this.seq) this.liked = v;
		} catch {
			// the server could not be reached; the marks shown stay
		}
	}

	has(id: string): boolean {
		return this.liked.includes(id);
	}

	/**
	 * Marks or unmarks a message at once and has the server keep it; a refused
	 * change is undone. True only when the server newly marked it.
	 */
	async set(id: string, on: boolean, token: string): Promise<boolean> {
		this.mark(id, on);
		const n = ++this.seq;
		try {
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ id, on })
			});
			if (res.ok) {
				const data = (await res.json().catch(() => null)) as {
					liked?: unknown;
					changed?: unknown;
				} | null;
				const v = ids(data?.liked);
				if (v && n === this.seq) this.liked = v;
				return on && data?.changed === true;
			}
		} catch {
			// the server could not be reached
		}
		if (n === this.seq) this.mark(id, !on);
		return false;
	}

	private mark(id: string, on: boolean) {
		const rest = this.liked.filter((x) => x !== id);
		this.liked = on ? [...rest, id] : rest;
	}

	/** Forgets the marks shown, as a fresh page does (for tests). */
	reset() {
		this.seq++;
		this.liked = [];
	}
}

export const reactions = new Reactions();
