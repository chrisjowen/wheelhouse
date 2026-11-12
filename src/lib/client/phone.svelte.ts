import { MediaQuery } from 'svelte/reactivity';

/**
 * Whether the screen is phone-sized: below `md` (48rem), where the sidebar
 * gives way to the tab bar. For choices markup alone cannot make, such as a
 * picker opening as a sheet instead of a popover; for looks, use `max-md:`.
 * On the server, and until the page runs, it says no.
 */
export const phone = new MediaQuery('(width < 48rem)', false);

/**
 * Whether the main pointer is a finger (a phone or tablet), where there may be
 * no hardware keyboard: the terminal shows its key bar then. On the server,
 * and until the page runs, it says no.
 */
export const touch = new MediaQuery('(pointer: coarse)', false);
