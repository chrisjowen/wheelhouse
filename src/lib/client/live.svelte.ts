import { page } from '$app/state';
import type { FleetView, Health } from '$lib/types';

/**
 * Live fleet and health from the server's SSE stream (/api/events). Pages
 * render the server-loaded data first and switch to the live copy once the
 * stream delivers.
 */
class Live {
	fleet = $state<FleetView | null>(null);
	health = $state<Health | null>(null);
	/** Our own connection to the Wheelhouse server (not Firstmate's state). */
	connection = $state<'connecting' | 'open' | 'lost'>('connecting');
	/** Ticks every 15 s so relative times stay current. */
	now = $state(Date.now());
	/** Bumps on every fleet event, for pages that refetch detail. */
	revision = $state(0);

	private source: EventSource | null = null;
	private clock: ReturnType<typeof setInterval> | null = null;

	connect(): () => void {
		if (this.source) return () => {};
		const es = new EventSource('/api/events');
		this.source = es;
		es.addEventListener('open', () => (this.connection = 'open'));
		es.addEventListener('error', () => {
			this.connection = es.readyState === EventSource.CLOSED ? 'lost' : 'connecting';
		});
		es.addEventListener('fleet', (e) => {
			this.fleet = JSON.parse((e as MessageEvent).data);
			this.revision++;
			this.connection = 'open';
		});
		es.addEventListener('health', (e) => {
			this.health = JSON.parse((e as MessageEvent).data);
		});
		this.clock = setInterval(() => (this.now = Date.now()), 15_000);
		return () => {
			es.close();
			this.source = null;
			if (this.clock) clearInterval(this.clock);
		};
	}
}

export const live = new Live();

/** The freshest fleet view: live when connected, else what the server rendered. */
export function currentFleet(): FleetView | null {
	return live.fleet ?? (page.data.fleet as FleetView | undefined) ?? null;
}

export function currentHealth(): Health | null {
	return live.health ?? (page.data.health as Health | undefined) ?? null;
}
