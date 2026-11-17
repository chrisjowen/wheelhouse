import { poll, type Visibility } from '$lib/console';
import type { RailInsights } from '$lib/types';

const REFRESH_MS = 60_000;

/**
 * The rail's insights in the browser: seeded by the page load, then re-read
 * from /api/insights each minute while the home page is open and shown (a
 * hidden tab reads nothing, and reads at once when it is shown again).
 */
class Insights {
	value = $state<RailInsights | null>(null);

	seed(v: RailInsights | null | undefined) {
		if (v) this.value = v;
	}

	connect(doc: Visibility = document): () => void {
		return poll({
			load: async () => {
				const r = await fetch('/api/insights');
				return r.ok ? ((await r.json()) as RailInsights) : null;
			},
			intervalMs: REFRESH_MS,
			immediate: false,
			onresult: (v) => {
				if (v) this.value = v;
			},
			// keep the last view; the next read may work
			onerror: () => {},
			doc
		});
	}
}

export const railInsights = new Insights();
