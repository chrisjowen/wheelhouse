<script lang="ts">
	import { Menu } from '@lucide/svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { live } from '$lib/client/live.svelte';
	import { navDrawer } from '$lib/client/navdrawer.svelte';
	import { bell } from '$lib/client/bell.svelte';

	/**
	 * A phone's menu button, at the top left of the header (or of the chat's own bar):
	 * a round button that opens the menu drawer (NavDrawer), carrying the count of
	 * questions waiting on the captain so nothing hides behind it, else a small dot for
	 * unread notifications (the drawer's Notifications row). Phones only.
	 */
	const waiting = $derived(inbox.open(live.now));
</script>

<button
	type="button"
	class="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border bg-card/60 text-foreground transition-colors hover:bg-muted md:hidden"
	aria-label={waiting
		? `Menu, ${waiting} waiting on you`
		: bell.unread
			? `Menu, ${bell.unread} unread notifications`
			: 'Menu'}
	aria-haspopup="dialog"
	aria-expanded={navDrawer.open}
	data-menu-button
	onclick={() => navDrawer.show()}
>
	<Menu class="size-5" strokeWidth={1.75} aria-hidden="true" />
	{#if waiting}<span
			class="tabular absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sea px-1 text-[0.68rem] leading-none font-semibold text-on-accent ring-2 ring-header"
			aria-hidden="true">{waiting > 9 ? '9+' : waiting}</span
		>{:else if bell.unread}<span
			class="absolute top-0 right-0 size-2.5 rounded-full bg-brass ring-2 ring-header"
			aria-hidden="true"
		></span>{/if}
</button>
