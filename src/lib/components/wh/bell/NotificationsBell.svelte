<script lang="ts">
	import { Bell, BellOff, BellRing } from '@lucide/svelte';
	import { bell } from '$lib/client/bell.svelte';

	/**
	 * A phone's bell, beside the menu button at the top left of the header (or of the
	 * chat's own bar): a round button with the unread count that opens the
	 * notifications sheet (NotificationsSheet). A new alert ticks the count and pulses
	 * its dot once. Phones only; a wide screen has the header's bell (NotificationsPane).
	 */
	const muted = $derived(Object.values(bell.settings.kinds).every((on) => !on));
	const unread = $derived(bell.unread);
	const waiting = $derived(bell.log.some((a) => bell.waiting(a)));
</script>

<button
	type="button"
	class="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border bg-card/60 text-foreground transition-colors hover:bg-muted md:hidden"
	aria-label={unread ? `Notifications: ${unread} unread` : 'Notifications'}
	aria-haspopup="dialog"
	aria-expanded={bell.open}
	data-notifications-bell
	onclick={() => (bell.open = true)}
>
	{#if muted}<BellOff
			class="size-5"
			strokeWidth={1.75}
			aria-hidden="true"
		/>{:else if waiting}<BellRing
			class="size-5"
			strokeWidth={1.75}
			aria-hidden="true"
		/>{:else}<Bell class="size-5" strokeWidth={1.75} aria-hidden="true" />{/if}
	{#if unread}
		<span
			class="tabular absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brass px-1 text-[0.68rem] leading-none font-semibold text-on-accent ring-2 ring-header"
			aria-hidden="true">{unread > 99 ? '99+' : unread}</span
		>
		{#key bell.pulse}
			{#if bell.pulse}
				<span
					class="pulse absolute -top-1 -right-1 size-[18px] rounded-full bg-brass"
					aria-hidden="true"
				></span>
			{/if}
		{/key}
	{/if}
</button>

<style>
	/* One soft pulse of the count's dot when something new arrives. */
	.pulse {
		animation: pulse 1.4s ease-out 1 forwards;
		pointer-events: none;
	}
	@keyframes pulse {
		from {
			opacity: 0.7;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(2.2);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse {
			display: none;
		}
	}
</style>
