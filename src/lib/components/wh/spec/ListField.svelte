<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Plus, X } from '@lucide/svelte';
	import DictateTextarea from '$lib/components/wh/DictateTextarea.svelte';

	/**
	 * A list the captain builds one entry at a time (journeys, requirements,
	 * links, open questions). It opens with one empty entry to type into; Enter
	 * (⌘Enter in a multi-line entry) adds another, and Backspace in an empty one
	 * removes it. An entry left empty is dropped from the spec.
	 */
	let {
		items = $bindable(),
		label,
		item,
		addLabel,
		placeholder,
		numbered = false,
		multiline = false
	}: {
		items: string[];
		/** The list's name, e.g. "Requirements". */
		label: string;
		/** One entry's name, e.g. "Requirement". */
		item: string;
		addLabel: string;
		placeholder: string;
		numbered?: boolean;
		multiline?: boolean;
	} = $props();

	let list: HTMLOListElement | undefined = $state();

	onMount(() => {
		if (!items.length) items = [''];
	});

	const entry = (i: number) => list?.querySelectorAll<HTMLElement>('[data-entry]')[i];

	async function add(at = items.length) {
		items = [...items.slice(0, at), '', ...items.slice(at)];
		await tick();
		entry(at)?.focus();
	}

	async function remove(i: number) {
		items = items.filter((_, j) => j !== i);
		await tick();
		entry(Math.min(i, items.length - 1))?.focus();
	}

	function onkeydown(e: KeyboardEvent, i: number) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (!multiline || e.metaKey)) {
			e.preventDefault();
			void add(i + 1);
		} else if (e.key === 'Backspace' && !items[i] && items.length > 1) {
			e.preventDefault();
			void remove(i).then(() => entry(Math.max(0, i - 1))?.focus());
		}
	}
</script>

<fieldset class="min-w-0">
	<legend class="text-sm font-medium">{label}</legend>
	<p class="mt-0.5 text-xs text-muted-foreground">
		{multiline ? '⌘ Enter' : 'Enter'} adds another; an empty one is left out.
	</p>
	<ol bind:this={list} class="mt-2 space-y-2">
		{#each items as _, i (i)}
			<li class="flex items-start gap-2">
				<span
					class="tabular mt-2 w-6 shrink-0 text-right text-sm text-muted-foreground"
					aria-hidden="true">{numbered ? `${i + 1}.` : '•'}</span
				>
				{#if multiline}
					<DictateTextarea
						data-entry
						bind:value={items[i]}
						rows={2}
						{placeholder}
						aria-label="{item} {i + 1}"
						class="min-h-10 bg-card"
						onkeydown={(e) => onkeydown(e, i)}
					/>
				{:else}
					<input
						data-entry
						bind:value={items[i]}
						{placeholder}
						aria-label="{item} {i + 1}"
						class="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						onkeydown={(e) => onkeydown(e, i)}
					/>
				{/if}
				<button
					type="button"
					class="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Remove {item.toLowerCase()} {i + 1}"
					onclick={() => remove(i)}><X class="size-4" /></button
				>
			</li>
		{/each}
	</ol>
	<button
		type="button"
		onclick={() => add()}
		class="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-sea hover:bg-muted"
	>
		<Plus class="size-4" aria-hidden="true" />{addLabel}
	</button>
</fieldset>
