<script lang="ts">
	import { tick } from 'svelte';
	import { Plus, X } from '@lucide/svelte';
	import { Textarea } from '$lib/components/ui/textarea';

	/**
	 * A list the captain builds one entry at a time (journeys, requirements,
	 * links, open questions). Enter in the last entry adds another; an entry
	 * left empty is dropped from the spec.
	 */
	let {
		items = $bindable(),
		label,
		addLabel,
		placeholder,
		numbered = false,
		checkbox = false,
		multiline = false
	}: {
		items: string[];
		label: string;
		addLabel: string;
		placeholder: string;
		numbered?: boolean;
		checkbox?: boolean;
		multiline?: boolean;
	} = $props();

	let list: HTMLOListElement | undefined = $state();

	async function add(at = items.length) {
		items = [...items.slice(0, at), '', ...items.slice(at)];
		await tick();
		list?.querySelectorAll<HTMLElement>('[data-entry]')[at]?.focus();
	}

	function remove(i: number) {
		items = items.filter((_, j) => j !== i);
	}

	function onkeydown(e: KeyboardEvent, i: number) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (!multiline || e.metaKey)) {
			e.preventDefault();
			void add(i + 1);
		} else if (e.key === 'Backspace' && !items[i] && items.length > 0) {
			e.preventDefault();
			remove(i);
			void tick().then(() =>
				list?.querySelectorAll<HTMLElement>('[data-entry]')[Math.max(0, i - 1)]?.focus()
			);
		}
	}
</script>

<fieldset class="min-w-0">
	<legend class="text-sm font-medium">{label}</legend>
	{#if items.length}
		<ol bind:this={list} class="mt-2 space-y-2">
			{#each items as _, i (i)}
				<li class="flex items-start gap-2">
					<span
						class="tabular mt-2 w-6 shrink-0 text-right text-sm text-muted-foreground"
						aria-hidden="true"
					>
						{#if checkbox}<span
								class="mt-1 inline-block size-3.5 rounded-[3px] border border-foreground/40"
							></span>{:else if numbered}{i + 1}.{:else}•{/if}
					</span>
					{#if multiline}
						<Textarea
							data-entry
							bind:value={items[i]}
							rows={2}
							{placeholder}
							aria-label="{label} {i + 1}"
							class="min-h-10 bg-card"
							onkeydown={(e) => onkeydown(e, i)}
						/>
					{:else}
						<input
							data-entry
							bind:value={items[i]}
							{placeholder}
							aria-label="{label} {i + 1}"
							class="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
							onkeydown={(e) => onkeydown(e, i)}
						/>
					{/if}
					<button
						type="button"
						class="mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Remove {label.toLowerCase()} {i + 1}"
						onclick={() => remove(i)}><X class="size-4" /></button
					>
				</li>
			{/each}
		</ol>
	{/if}
	<button
		type="button"
		onclick={() => add()}
		class="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-sea hover:bg-muted"
	>
		<Plus class="size-4" aria-hidden="true" />{addLabel}
	</button>
</fieldset>
