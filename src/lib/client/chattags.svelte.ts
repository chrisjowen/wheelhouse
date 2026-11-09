/**
 * The captain's own thread choices in the chat, remembered in this browser:
 * the messages and cards moved to another thread (by message key, see
 * lib/chat/topics.ts), the newest kept, and whether a thread's view folds the
 * other threads to one line per run rather than leaving them out.
 */
const KEY = 'wheelhouse-chat-tags';
const FOLD_KEY = 'wheelhouse-chat-fold';
const MAX = 1000;

class ChatTags {
	retags = $state<Record<string, string>>({});
	fold = $state(false);
	private loaded = false;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
			if (v && typeof v === 'object' && !Array.isArray(v))
				this.retags = Object.fromEntries(
					Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')
				);
			this.fold = localStorage.getItem(FOLD_KEY) === '1';
		} catch {
			this.retags = {};
		}
	}

	/** Moves a message or card to a thread. */
	move(key: string, topic: string) {
		this.load();
		const next = { ...this.retags };
		delete next[key];
		next[key] = topic;
		const keys = Object.keys(next);
		for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete next[k];
		this.retags = next;
		try {
			localStorage.setItem(KEY, JSON.stringify(next));
		} catch {
			// storage unavailable; the move lasts for this page only
		}
	}

	setFold(on: boolean) {
		this.fold = on;
		try {
			localStorage.setItem(FOLD_KEY, on ? '1' : '0');
		} catch {
			// storage unavailable
		}
	}
}

export const chatTags = new ChatTags();
