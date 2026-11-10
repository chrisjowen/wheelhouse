/**
 * The captain's 👍 on Firstmate's messages, by message id, remembered in this
 * browser so the mark stays after a reload. The newest are kept.
 */
const KEY = 'wheelhouse-chat-reactions';
const MAX = 1000;

class Reactions {
	liked = $state<string[]>([]);
	private loaded = false;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
			if (Array.isArray(v)) this.liked = v.filter((x): x is string => typeof x === 'string');
		} catch {
			this.liked = [];
		}
	}

	has(id: string): boolean {
		return this.liked.includes(id);
	}

	/** Marks or unmarks a message; returns whether it is now marked. */
	toggle(id: string): boolean {
		this.load();
		const on = !this.liked.includes(id);
		this.liked = on ? [...this.liked, id].slice(-MAX) : this.liked.filter((x) => x !== id);
		try {
			localStorage.setItem(KEY, JSON.stringify(this.liked));
		} catch {
			// storage unavailable; the mark lasts for this page only
		}
		return on;
	}

	/** Forgets what was loaded, as a fresh page does (for tests). */
	reset() {
		this.loaded = false;
		this.liked = [];
	}
}

export const reactions = new Reactions();
