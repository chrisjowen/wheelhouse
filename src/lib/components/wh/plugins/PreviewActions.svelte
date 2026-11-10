<script lang="ts">
	import { page } from '$app/state';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { PreviewContext, SlotView } from '$lib/plugins/types';
	import PluginElement from './PluginElement.svelte';

	/**
	 * Plugins' buttons on one live preview (preview.action entries, such as the
	 * Shared review plugin's Share for review), each its plugin's own element
	 * given the preview it acts on. Only plugins that are on, and whose
	 * provider answered, show one; with none, nothing is drawn. The entries are
	 * the fleet's, which the layout keeps fresh on every page.
	 */
	let { preview }: { preview: PreviewContext } = $props();

	const pageSlots = $derived(page.data.slots as Record<SlotKey, SlotView> | undefined);
	const at = $derived(
		pageSlots?.[slotKey.fleet] ? ((page.data.slotsAt as number | undefined) ?? 0) : 0
	);
	const entries = $derived(
		slots
			.entries(slotKey.fleet, pageSlots, at)
			.filter((e) => e.slot === 'preview.action' && e.content.available)
	);
</script>

{#each entries as entry (entry.key)}
	{#if entry.content.available}
		<span class="contents" data-slot="preview.action">
			<PluginElement {entry} data={entry.content.value} {preview} quiet />
		</span>
	{/if}
{/each}
