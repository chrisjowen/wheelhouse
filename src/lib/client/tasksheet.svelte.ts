import { page } from '$app/state';
import { pushState, replaceState } from '$app/navigation';
import { SHEET_PARAM } from '$lib/tasksheet';

/**
 * The task open in the side panel. Opening one is shallow routing: the
 * address gains `?task=<id>` and a history entry of its own, so Back closes
 * it, without reloading the page underneath. SvelteKit keeps such a change in
 * `page.state` (`page.url` stays the address the page loaded with), so the
 * panel reads the state first and the address only when the page was loaded
 * with a task in it (a reload or a shared link). Switching to another task
 * while one is open replaces it; closing goes back, or drops the parameter
 * when the panel came with the address.
 */
export const taskSheet = {
	get id(): string | null {
		const s = page.state.taskSheet;
		return s !== undefined ? s : page.url.searchParams.get(SHEET_PARAM);
	},
	open(id: string) {
		const url = address(id);
		if (this.id) replaceState(url, { ...page.state, taskSheet: id });
		else pushState(url, { taskSheet: id, taskSheetPushed: true });
	},
	close() {
		if (!this.id) return;
		if (page.state.taskSheetPushed) history.back();
		else replaceState(address(null), { taskSheet: null });
	}
};

/** The address as it is now (shallow changes included), with the panel's task set or dropped. */
function address(id: string | null): URL {
	const url = new URL(location.href);
	if (id) url.searchParams.set(SHEET_PARAM, id);
	else url.searchParams.delete(SHEET_PARAM);
	return url;
}
