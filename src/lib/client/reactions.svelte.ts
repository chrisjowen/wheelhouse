import { act } from './chat.svelte';

/**
 * The captain's 👍 on Firstmate's messages, by message id, kept by the
 * Wheelhouse server (`/api/firstmate/reactions`) so every device shows them.
 */
class Reactions {
	liked = $state<string[]>([]);
	private loaded = false;

	/** Reads the marks once per page. */
	async load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const res = await fetch('/api/firstmate/reactions');
			const v = res.ok ? ((await res.json()) as { liked?: unknown }).liked : null;
			if (Array.isArray(v)) this.liked = v.filter((x): x is string => typeof x === 'string');
		} catch {
			// the server could not be reached; no marks show
		}
	}

	has(id: string): boolean {
		return this.liked.includes(id);
	}

	/** Marks or unmarks a message at once, and has the server keep it; a refused change is undone. */
	async set(id: string, on: boolean, token: string) {
		this.mark(id, on);
		const r = await act('/api/firstmate/reactions', token, { id, on });
		if (!r.ok) this.mark(id, !on);
	}

	private mark(id: string, on: boolean) {
		const rest = this.liked.filter((x) => x !== id);
		this.liked = on ? [...rest, id] : rest;
	}

	/** Forgets what was loaded, as a fresh page does (for tests). */
	reset() {
		this.loaded = false;
		this.liked = [];
	}
}

export const reactions = new Reactions();
