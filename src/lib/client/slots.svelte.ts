import { slotsUrl, type SlotKey } from '$lib/plugins/keys';
import type { SlotEntry, SlotView } from '$lib/plugins/types';

/**
 * Plugin entries in the browser: what the page's server load filled first,
 * then a refetch from /api/slots at most every 15 s per key while the fleet
 * changes. Providers cache their own results, so a refetch is cheap.
 */
const MIN_INTERVAL_MS = 15_000;

class Slots {
	private fetched = $state<Record<SlotKey, { at: number; view: SlotView }>>({});
	private last = new Map<SlotKey, number>();

	/** The newer of the page's own load (made at `loadedAt`) and the last refetch. */
	entries(
		key: SlotKey,
		initial: Record<SlotKey, SlotView> | undefined,
		loadedAt: number
	): SlotEntry[] {
		const f = this.fetched[key];
		return (f && f.at > loadedAt ? f.view : initial?.[key])?.entries ?? [];
	}

	/** Refetch, unless this key was loaded or refetched within the last 15 s. */
	refresh(key: SlotKey, loadedAt: number): void {
		const now = Date.now();
		const last = Math.max(this.last.get(key) ?? 0, loadedAt);
		if (now - last < MIN_INTERVAL_MS) return;
		this.last.set(key, now);
		fetch(slotsUrl(key))
			.then((r) => (r.ok ? r.json() : null))
			.then((v: SlotView | null) => {
				if (v?.schema === 'wheelhouse-slots.v1') this.fetched[key] = { at: now, view: v };
			})
			.catch(() => {});
	}
}

export const slots = new Slots();
