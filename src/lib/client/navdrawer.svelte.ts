import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';

/**
 * The phone's menu drawer (NavDrawer), opened from the menu button (MenuButton).
 * Being open is a history entry of its own (shallow routing), so the back gesture
 * or button closes it, like a phone app's menu, and a link taken from it leaves it
 * closed behind: going back to that page does not open the menu again.
 */
export const navDrawer = {
	get open(): boolean {
		return page.state?.navDrawer === true;
	},
	show() {
		if (!this.open) pushState('', { ...page.state, navDrawer: true });
	},
	hide() {
		if (this.open) history.back();
	},
	/** Closes it for a link taken from it: this page's entry forgets it was open. */
	leave() {
		if (this.open) replaceState('', { ...page.state, navDrawer: false });
	}
};
