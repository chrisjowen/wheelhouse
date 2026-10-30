<script lang="ts">
	import { onMount } from 'svelte';
	import { ago } from '$lib/format';
	import { PANELS, type Panel as PanelComponent } from '$lib/plugins/panels';
	import type { Block, SlotEntry } from '$lib/plugins/types';
	import AppFrame from './AppFrame.svelte';
	import Blocks from './Blocks.svelte';
	import PluginElement from './PluginElement.svelte';

	/**
	 * One plugin entry's content: built-in blocks, the plugin's own panel, an
	 * installed plugin's custom element or an MCP app, with where it came from. An entry whose
	 * provider failed says why. A panel or element mounts only in the browser; a panel inside an error boundary, so one that throws
	 * is contained here and does not break the page (Svelte's server rendering
	 * does not catch errors in a boundary), and an element whose bundle fails
	 * says so in its own place. With `fill`, it fills a full-height parent: a
	 * panel or element takes the height, blocks scroll in their own area, and
	 * where it came from sits along the bottom.
	 */
	let {
		entry,
		now = Date.now(),
		panels = PANELS,
		fill = false
	}: {
		entry: SlotEntry;
		now?: number;
		panels?: Record<string, PanelComponent>;
		fill?: boolean;
	} = $props();
	const Panel = $derived('component' in entry.render ? panels[entry.render.component] : undefined);
	const element = $derived('element' in entry.render);
	const app = $derived('app' in entry.render);
	// A new tool call is a new app: the frame is made again only when its arguments change.
	const appKey = $derived(
		app && entry.content.available ? `${entry.key} ${JSON.stringify(entry.content.value)}` : ''
	);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
</script>

{#snippet content(value: unknown)}
	{#if 'blocks' in entry.render}
		<Blocks blocks={value as Block[]} />
	{:else if (Panel || element || app) && !mounted}
		<p class="text-sm text-muted-foreground" aria-busy="true">Loading…</p>
	{:else if Panel}
		<svelte:boundary>
			<Panel data={value} {entry} />
			{#snippet failed()}
				<p class="text-sm text-muted-foreground">
					Not available. The {entry.pluginId} plugin’s panel could not be shown.
				</p>
			{/snippet}
		</svelte:boundary>
	{:else if element}
		<PluginElement {entry} data={value} />
	{:else if app}
		{#key appKey}
			<AppFrame {entry} {fill} />
		{/key}
	{:else if 'component' in entry.render}
		<p class="text-sm text-muted-foreground">
			Not available. This Wheelhouse does not include the “{entry.render.component}” panel.
		</p>
	{/if}
{/snippet}

{#if !entry.content.available}
	<p class="text-sm text-muted-foreground {fill ? 'px-4 py-10 sm:px-6' : ''}">
		Not available. {entry.content.reason}
	</p>
{:else}
	{#if !fill}
		{@render content(entry.content.value)}
	{:else if (Panel || element || app) && mounted}
		<div class="flex min-h-0 flex-1 flex-col">{@render content(entry.content.value)}</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
			{@render content(entry.content.value)}
		</div>
	{/if}
	<p
		class="text-xs text-muted-foreground {fill
			? 'shrink-0 border-t px-4 py-1.5 sm:px-6'
			: 'mt-1.5'}"
	>
		From {entry.content.source}{entry.content.observedAt
			? `, ${ago(entry.content.observedAt, now)}`
			: ''}.
	</p>
{/if}
