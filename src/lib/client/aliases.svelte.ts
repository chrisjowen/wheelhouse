import { parseAliases } from '$lib/projectnames';

/** Where this browser keeps the captain's friendly project names. */
export const ALIASES_KEY = 'wheelhouse-project-names';

/**
 * Friendly names for projects, kept in this browser only and used wherever a project
 * is listed. Another tab's change follows through the storage event.
 */
class Aliases {
	names = $state<Record<string, string>>({});
	private loaded = false;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		this.read();
		try {
			window.addEventListener('storage', (e) => {
				if (e.key === ALIASES_KEY) this.read();
			});
		} catch {
			// no window (server render)
		}
	}

	/** Sets a project's friendly name; a blank one clears it. */
	set(id: string, name: string) {
		const next = { ...this.names };
		if (name.trim()) next[id] = name.trim();
		else delete next[id];
		this.names = next;
		try {
			localStorage.setItem(ALIASES_KEY, JSON.stringify(next));
		} catch {
			// storage unavailable; the name lasts for this page only
		}
	}

	private read() {
		try {
			this.names = parseAliases(localStorage.getItem(ALIASES_KEY));
		} catch {
			this.names = {};
		}
	}
}

export const aliases = new Aliases();
