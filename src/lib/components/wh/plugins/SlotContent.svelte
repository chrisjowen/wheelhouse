<script lang="ts">
	import { onMount } from 'svelte';
	import { ago } from '$lib/format';
	import { PANELS, type Panel as PanelComponent } from '$lib/plugins/panels';
	import type { Block, SlotEntry } from '$lib/plugins/types';
	import Blocks from './Blocks.svelte';

	/**
	 * One plugin entry's content: built-in blocks or the plugin's own panel,
	 * with where it came from. An entry whose provider failed says why. A panel
	 * mounts only in the browser, inside an error boundary, so one that throws
	 * is contained here and does not break the page (Svelte's server rendering
	 * does not catch errors in a boundary).
	 */
	let {
		entry,
		now = Date.now(),
		panels = PANELS
	}: { entry: SlotEntry; now?: number; panels?: Record<string, PanelComponent> } = $props();
	const Panel = $derived('component' in entry.render ? panels[entry.render.component] : undefined);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
</script>

{#if !entry.content.available}
	<p class="text-sm text-muted-foreground">Not available. {entry.content.reason}</p>
{:else}
	{#if 'blocks' in entry.render}
		<Blocks blocks={entry.content.value as Block[]} />
	{:else if Panel && !mounted}
		<p class="text-sm text-muted-foreground" aria-busy="true">Loading…</p>
	{:else if Panel}
		<svelte:boundary>
			<Panel data={entry.content.value} {entry} />
			{#snippet failed()}
				<p class="text-sm text-muted-foreground">
					Not available. The {entry.pluginId} plugin’s panel could not be shown.
				</p>
			{/snippet}
		</svelte:boundary>
	{:else}
		<p class="text-sm text-muted-foreground">
			Not available. This Wheelhouse does not include the “{entry.render.component}” panel.
		</p>
	{/if}
	<p class="mt-1.5 text-xs text-muted-foreground">
		From {entry.content.source}{entry.content.observedAt
			? `, ${ago(entry.content.observedAt, now)}`
			: ''}.
	</p>
{/if}
