import { page } from '$app/state';
import { pushState, replaceState } from '$app/navigation';
import { SHEET_PARAM } from '$lib/tasksheet';

/**
 * The task open in the side panel, read from the address (`?task=`). Opening
 * one adds a history entry (shallow routing: the page underneath is not
 * reloaded), so Back closes it; switching to another task while one is open
 * replaces it, and closing goes back, or drops the parameter when the panel
 * came with the address itself (a reload or a shared link).
 */
export const taskSheet = {
	get id(): string | null {
		return page.url.searchParams.get(SHEET_PARAM);
	},
	open(id: string) {
		// A one-off address to hand to the router, not state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const url = new URL(page.url);
		url.searchParams.set(SHEET_PARAM, id);
		if (this.id) replaceState(url, page.state);
		else pushState(url, { taskSheet: true });
	},
	close() {
		if (!this.id) return;
		if (page.state.taskSheet) {
			history.back();
			return;
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const url = new URL(page.url);
		url.searchParams.delete(SHEET_PARAM);
		replaceState(url, {});
	}
};
