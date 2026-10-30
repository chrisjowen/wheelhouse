<script lang="ts">
	import Switch from '$lib/components/wh/Switch.svelte';
	import { onState } from '$lib/plugins/words';
	import type { PluginPageView } from '$lib/plugins/types';

	/**
	 * A plugin's switch for every project, showing where it is on now: on, off,
	 * or mixed when that differs from project to project. Turning it on or off
	 * for every project replaces each project's own choice, so while there are
	 * any, or while it is mixed, that is a choice of its own, saying which
	 * choices it replaces.
	 */
	let {
		view,
		disabled = false,
		onchange
	}: { view: PluginPageView; disabled?: boolean; onchange: (on: boolean) => void } = $props();

	const now = $derived(onState(view));
	const picked = $derived(view.projects.filter((p) => p.enabled !== null));
	const replaces = $derived(
		picked.length === 0
			? null
			: picked.length <= 3
				? `This replaces ${picked.length === 1 ? 'the choice' : 'the choices'} for ${picked.map((p) => p.name).join(', ')}.`
				: `This replaces ${picked.length} projects’ own choices.`
	);
	let choosing = $state(false);
	const choose = (on: boolean) => {
		choosing = false;
		onchange(on);
	};
</script>

{#if choosing}
	<div
		class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
		role="group"
		aria-label="{view.plugin.name} for every project"
	>
		{#if replaces}<span class="text-muted-foreground" data-replaces>{replaces}</span>{/if}
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
		onchange={(on) => (now === 'mixed' || replaces ? (choosing = true) : onchange(on))}
	/>
{/if}
