<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { launchAndOpen, serviceStatus } from '$lib/client/services';
	import {
		mountElement,
		pluginHost,
		type Importer,
		type PluginElement
	} from '$lib/plugins/elements';
	import type { SlotEntry } from '$lib/plugins/types';

	/**
	 * An installed plugin's custom element, mounted in the browser only. A bundle
	 * that fails to load, or never defines the tag, says why (or, `quiet`, shows
	 * nothing); a new provider value is handed to the same element. The element
	 * gets `host`, which starts its own plugin's companion services with the
	 * page's session token, so the element need not handle it.
	 */
	let {
		entry,
		data,
		quiet = false,
		importer
	}: { entry: SlotEntry; data: unknown; quiet?: boolean; importer?: Importer } = $props();

	// Only a new tag or bundle remounts; a refreshed entry with the same ones keeps its element.
	const tag = $derived('element' in entry.render ? entry.render.element : '');
	const ui = $derived(entry.ui ?? null);
	let host = $state<HTMLDivElement | null>(null);
	let el = $state<PluginElement | null>(null);
	let failure = $state<string | null>(null);

	$effect(() => {
		if (!host || !tag) return;
		const at = host;
		let gone = false;
		let made: PluginElement | null = null;
		failure = null;
		mountElement(at, {
			tag,
			ui,
			data: untrack(() => data),
			entry: untrack(() => entry),
			host: pluginHost(
				untrack(() => entry),
				{
					status: serviceStatus,
					launch: launchAndOpen,
					token: () => (page.data.sessionToken as string) ?? ''
				}
			),
			importer
		}).then(
			(e) => {
				made = e;
				if (gone) e.remove();
				else el = e;
			},
			(e: Error) => {
				if (!gone) failure = e.message;
			}
		);
		return () => {
			gone = true;
			made?.remove();
			el = null;
		};
	});

	$effect(() => {
		if (!el) return;
		el.entry = entry;
		el.data = data;
	});
</script>

<div bind:this={host} class="contents" data-plugin-element={tag}></div>
{#if failure && !quiet}
	<p class="text-sm text-muted-foreground">
		Not available. The {entry.pluginId} plugin’s element could not be shown: {failure}.
	</p>
{/if}
