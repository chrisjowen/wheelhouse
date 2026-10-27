import { parsePins } from '$lib/picker';

/** Where this browser keeps the captain's pinned projects. */
export const PINS_KEY = 'wheelhouse-pinned-projects';

/**
 * The captain's pinned projects, kept in this browser only and shared by the left
 * panel and the header's picker. Another tab's change follows through the storage event.
 */
class Pins {
	ids = $state<string[]>([]);
	private loaded = false;

	/** Read the pins once, in the browser. */
	load() {
		if (this.loaded) return;
		this.loaded = true;
		this.read();
		try {
			window.addEventListener('storage', (e) => {
				if (e.key === PINS_KEY) this.read();
			});
		} catch {
			// no window (server render)
		}
	}

	has(id: string): boolean {
		return this.ids.includes(id);
	}

	toggle(id: string) {
		this.ids = this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id];
		try {
			localStorage.setItem(PINS_KEY, JSON.stringify(this.ids));
		} catch {
			// storage unavailable; the pin lasts for this page only
		}
	}

	private read() {
		try {
			this.ids = parsePins(localStorage.getItem(PINS_KEY));
		} catch {
			this.ids = [];
		}
	}
}

export const pins = new Pins();
