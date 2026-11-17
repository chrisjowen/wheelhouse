/**
 * How far the captain has read in each of the chat's lanes (the experimental
 * `lanes` feature), remembered in this browser, for the lanes' counts of new
 * messages: by lane (`<topic>`) and by a lane's task (`<topic>/<task>`), the
 * newest message's time read there. A lane never opened counts from when
 * this browser first showed lanes, so turning them on starts with none new.
 */
const KEY = 'wheelhouse-chat-seen';

class ChatSeen {
	since = $state(0);
	seen = $state<Record<string, number>>({});
	private loaded = false;

	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
			const rec = v && typeof v === 'object' ? (v as { since?: unknown; seen?: unknown }) : null;
			if (rec && typeof rec.since === 'number') {
				this.since = rec.since;
				const seen = rec.seen && typeof rec.seen === 'object' ? rec.seen : {};
				this.seen = Object.fromEntries(
					Object.entries(seen).filter((e): e is [string, number] => typeof e[1] === 'number')
				);
				return;
			}
		} catch {
			// unreadable: start again from now
		}
		this.since = Date.now();
		this.save();
	}

	/** Read up to `at` (ms) in a lane or a lane's task. */
	read(key: string, at: number) {
		this.load();
		if ((this.seen[key] ?? 0) >= at) return;
		this.seen = { ...this.seen, [key]: at };
		this.save();
	}

	/** Messages after this time (ms) in the lane, or the lane's task, are new. */
	after(key: string): number {
		return Math.max(this.since, this.seen[key] ?? 0);
	}

	private save() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ since: this.since, seen: this.seen }));
		} catch {
			// storage unavailable; the counts last for this page only
		}
	}
}

export const chatSeen = new ChatSeen();
