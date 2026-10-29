<script lang="ts">
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import InstallPlugin from '$lib/components/wh/plugins/InstallPlugin.svelte';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';

	/**
	 * A plugin's own top-level page (a nav.page entry, such as Improvements), an
	 * item in the left-hand menu after Firstmate, Harbour, Spec and the Logbook.
	 * It reads on one solid sheet, as the Logbook pages do.
	 */
	let { data } = $props();

	const key = $derived(`${page.params.plugin}/${page.params.page}`);
	const entry = $derived(
		slots
			.entries(slotKey.fleet, data.slots, data.slotsAt)
			.find((e) => e.slot === 'nav.page' && `${e.pluginId}/${e.contributionId}` === key) ?? null
	);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, data.slotsAt);
	});
</script>

<svelte:head><title>{entry ? `${entry.title} · ` : ''}Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		{#if entry}
			<h1 class="text-2xl">{entry.title}</h1>
			<section class="mt-6" aria-label={entry.title} data-slot="nav.page">
				<SlotContent {entry} now={live.now} />
			</section>
		{:else if data.suggested}
			<InstallPlugin plugin={data.suggested} />
		{:else}
			<p class="text-muted-foreground">
				Wheelhouse has no “{key}” page. It may belong to a plugin that is off.
			</p>
		{/if}
	</div>
</main>
