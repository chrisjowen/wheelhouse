<script lang="ts">
	import { Popover } from 'bits-ui';
	import { Button } from '$lib/components/ui/button';
	import { Bell, BellOff, BellRing } from '@lucide/svelte';
	import { bell } from '$lib/client/bell.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import NotificationsBody from './NotificationsBody.svelte';

	/**
	 * The ship's bell in the header: the bell with its unread count, which opens the
	 * notifications pane. Nothing pops up over the page: a new alert ticks the count
	 * and pulses the bell's dot once. On a wide screen the pane is a popover under
	 * the bell; on a phone the bell opens the one sheet the layout holds
	 * (NotificationsSheet), which the menu drawer opens too.
	 */
	let view = $state<'list' | 'settings'>('list');
	const muted = $derived(Object.values(bell.settings.kinds).every((on) => !on));
	const unread = $derived(bell.unread);
	const waiting = $derived(bell.log.some((a) => bell.waiting(a)));

	function setOpen(open: boolean) {
		bell.open = open;
		if (!open) view = 'list';
	}
</script>

{#snippet trigger(props: Record<string, unknown>)}
	<Button
		{...props}
		variant="ghost"
		size="icon-sm"
		class="relative"
		aria-label={unread ? `Notifications: ${unread} unread` : 'Notifications'}
		onclick={phone.current ? () => setOpen(!bell.open) : undefined}
	>
		{#if muted}<BellOff />{:else if waiting}<BellRing />{:else}<Bell />{/if}
		{#if unread}
			<span
				class="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brass px-1 text-[0.6875rem] leading-4 font-semibold text-on-accent"
				aria-hidden="true">{unread}</span
			>
			{#key bell.pulse}
				{#if bell.pulse}
					<span
						class="pulse absolute -top-0.5 -right-0.5 size-4 rounded-full bg-brass"
						aria-hidden="true"
					></span>
				{/if}
			{/key}
		{/if}
	</Button>
{/snippet}

{#if phone.current}
	{@render trigger({ 'aria-haspopup': 'dialog', 'aria-expanded': bell.open })}
{:else}
	<Popover.Root open={bell.open} onOpenChange={setOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}{@render trigger(props)}{/snippet}
		</Popover.Trigger>
		<Popover.Portal>
			<Popover.Content
				align="end"
				sideOffset={6}
				collisionPadding={8}
				class="z-50 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[26rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
				aria-label="Notifications"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				onFocusOutside={(e) => e.preventDefault()}
			>
				<div class="px-4 pt-3 pb-1">
					<p class="font-display text-base font-semibold">
						{view === 'settings' ? 'Notification settings' : 'Notifications'}
					</p>
				</div>
				<NotificationsBody bind:view />
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}

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
