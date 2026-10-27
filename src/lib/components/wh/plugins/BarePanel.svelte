<script lang="ts">
	import { onMount } from 'svelte';
	import { PANELS } from '$lib/plugins/panels';
	import type { SlotEntry } from '$lib/plugins/types';
	import PluginElement from './PluginElement.svelte';

	/**
	 * A plugin panel with no frame around it, for small places such as the
	 * header: nothing while its provider has nothing to show, and nothing if the
	 * panel (or an installed plugin's element) is missing or throws. Like SlotContent, it mounts only in the browser
	 * inside an error boundary.
	 */
	let { entry }: { entry: SlotEntry } = $props();
	const Panel = $derived('component' in entry.render ? PANELS[entry.render.component] : undefined);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
</script>

{#if mounted && 'element' in entry.render && entry.content.available}
	<PluginElement {entry} data={entry.content.value} quiet />
{:else if mounted && Panel && entry.content.available}
	<svelte:boundary>
		<Panel data={entry.content.value} {entry} />
		{#snippet failed()}{/snippet}
	</svelte:boundary>
{/if}
