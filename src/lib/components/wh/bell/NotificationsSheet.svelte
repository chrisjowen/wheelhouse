<script lang="ts">
	import { onMount } from 'svelte';
	import { bell } from '$lib/client/bell.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import Sheet from '../Sheet.svelte';
	import NotificationsBody from './NotificationsBody.svelte';

	/**
	 * Starts the ship's bell for the page, and on a phone holds the notifications pane
	 * as one full-width sheet from the bottom of the screen, opened by the header's
	 * bell or the menu drawer's Notifications row. It lives in the layout, not the
	 * header, because a phone's home page leaves the header out.
	 */
	let view = $state<'list' | 'settings'>('list');
	onMount(() => bell.start());
</script>

{#if phone.current}
	<Sheet
		bind:open={
			() => bell.open,
			(open) => {
				bell.open = open;
				if (!open) view = 'list';
			}
		}
		title={view === 'settings' ? 'Notification settings' : 'Notifications'}
		onOpenAutoFocus={(e) => e.preventDefault()}
	>
		<NotificationsBody bind:view />
	</Sheet>
{/if}
