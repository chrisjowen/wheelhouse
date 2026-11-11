<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';

	/**
	 * A part of a page folded away on a phone: a row to open it, closed at
	 * first. From `md` up the row is not there and what it holds shows as it
	 * always has, so wide screens are unchanged.
	 */
	let {
		id,
		title,
		hint = '',
		icon: Icon,
		open = $bindable(false),
		children
	}: {
		/** Names the folded part for the row's aria-controls. */
		id: string;
		title: string;
		/** A few words after the title, such as how many there are. */
		hint?: string;
		icon: Component<{ class?: string; 'aria-hidden'?: 'true' }>;
		/** Whether it is open on a phone; closed at first. */
		open?: boolean;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	class="mt-4 flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-3.5 text-left md:hidden"
	aria-expanded={open}
	aria-controls={id}
	onclick={() => (open = !open)}
	data-phone-fold
>
	<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	<span class="min-w-0 flex-1 py-2.5 text-sm leading-snug"
		><span class="font-medium">{title}</span>{#if hint}<span class="text-muted-foreground"
				>{` · ${hint}`}</span
			>{/if}</span
	>
	<ChevronDown
		class="size-4 shrink-0 text-muted-foreground transition-transform {open ? 'rotate-180' : ''}"
		aria-hidden="true"
	/>
</button>
<div {id} class={open ? '' : 'max-md:hidden'}>{@render children()}</div>
