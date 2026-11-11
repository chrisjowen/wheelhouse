import { MediaQuery } from 'svelte/reactivity';

/**
 * Whether the screen is phone-sized: below `md` (48rem), where the sidebar
 * gives way to the tab bar. For choices markup alone cannot make, such as a
 * picker opening as a sheet instead of a popover; for looks, use `max-md:`.
 * On the server, and until the page runs, it says no.
 */
export const phone = new MediaQuery('(width < 48rem)', false);
