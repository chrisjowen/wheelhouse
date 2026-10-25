import type { RailInsights } from '$lib/types';

const REFRESH_MS = 60_000;

/**
 * The rail's insights in the browser: seeded by the page load, then re-read
 * from /api/insights each minute while the home page is open.
 */
class Insights {
	value = $state<RailInsights | null>(null);

	seed(v: RailInsights | null | undefined) {
		if (v) this.value = v;
	}

	connect(): () => void {
		let stopped = false;
		const read = async () => {
			try {
				const r = await fetch('/api/insights');
				if (r.ok && !stopped) this.value = (await r.json()) as RailInsights;
			} catch {
				// keep the last view; the next read may work
			}
		};
		const timer = setInterval(read, REFRESH_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}
}

export const railInsights = new Insights();
