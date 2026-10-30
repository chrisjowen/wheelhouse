<script lang="ts">
	import Switch from '$lib/components/wh/Switch.svelte';
	import { onState } from '$lib/plugins/words';
	import type { PluginPageView } from '$lib/plugins/types';

	/**
	 * A plugin's switch for every project, showing where it is on now: on, off,
	 * or mixed when that differs from project to project. From mixed, turning
	 * it on or off for every project is a choice of its own.
	 */
	let {
		view,
		disabled = false,
		onchange
	}: { view: PluginPageView; disabled?: boolean; onchange: (on: boolean) => void } = $props();

	const now = $derived(onState(view));
	let choosing = $state(false);
	const choose = (on: boolean) => {
		choosing = false;
		onchange(on);
	};
</script>

{#if choosing && now === 'mixed'}
	<div
		class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
		role="group"
		aria-label="{view.plugin.name} for every project"
	>
		<button
			type="button"
			class="cursor-pointer text-sea hover:underline disabled:cursor-not-allowed"
			{disabled}
			onclick={() => choose(true)}>On for every project</button
		>
		<button
			type="button"
			class="cursor-pointer text-sea hover:underline disabled:cursor-not-allowed"
			{disabled}
			onclick={() => choose(false)}>Off for every project</button
		>
		<button
			type="button"
			class="cursor-pointer text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => (choosing = false)}>Cancel</button
		>
	</div>
{:else}
	<Switch
		checked={now === 'on'}
		mixed={now === 'mixed'}
		label="{view.plugin.name} on for every project"
		{disabled}
		onchange={(on) => (now === 'mixed' ? (choosing = true) : onchange(on))}
	/>
{/if}
