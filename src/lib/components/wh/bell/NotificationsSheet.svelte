<script lang="ts">
	import { onMount } from 'svelte';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import { bell } from '$lib/client/bell.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import NotificationsBody from './NotificationsBody.svelte';

	/**
	 * Starts the ship's bell for the page, and on a phone holds the notifications pane
	 * as a full-screen panel, opened by the bell beside the menu button
	 * (NotificationsBell) or the menu drawer's Notifications row. Its list is the one
	 * thing that scrolls; the title and toolbar stay put, clear of the notch and the
	 * home bar. It lives in the layout, not the header, because a phone's home page
	 * leaves the header out.
	 */
	let view = $state<'list' | 'settings'>('list');
	onMount(() => bell.start());
</script>

{#if phone.current}
	<DialogPrimitive.Root
		open={bell.open}
		onOpenChange={(open) => {
			bell.open = open;
			if (!open) view = 'list';
		}}
	>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Content
				class="fixed inset-0 z-50 flex h-dvh flex-col bg-popover pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] text-popover-foreground duration-200 outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom"
				onOpenAutoFocus={(e) => e.preventDefault()}
				data-notifications-sheet
			>
				<div class="flex h-14 shrink-0 items-center gap-2 pr-1.5 pl-4">
					<DialogPrimitive.Title class="min-w-0 flex-1 truncate font-title text-2xl leading-tight"
						>{view === 'settings'
							? 'Notification settings'
							: 'Notifications'}</DialogPrimitive.Title
					>
					<DialogPrimitive.Close
						class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Close"><X class="size-5" aria-hidden="true" /></DialogPrimitive.Close
					>
				</div>
				<div class="flex min-h-0 flex-1 flex-col">
					<NotificationsBody bind:view />
				</div>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
{/if}
