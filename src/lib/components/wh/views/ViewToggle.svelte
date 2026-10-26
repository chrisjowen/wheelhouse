<script lang="ts" generics="T extends string">
	import type { Component } from 'svelte';

	let {
		options,
		value,
		onchange,
		label
	}: {
		options: { value: T; label: string; icon: Component<{ class?: string }> }[];
		value: T;
		onchange: (v: T) => void;
		label: string;
	} = $props();
</script>

<!-- A segmented control: each layout is a labelled button, the current one pressed. -->
<div class="flex rounded-md border bg-card p-0.5 text-sm" role="group" aria-label={label}>
	{#each options as o (o.value)}
		<button
			type="button"
			aria-pressed={value === o.value}
			onclick={() => onchange(o.value)}
			class="inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 whitespace-nowrap transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none {value ===
			o.value
				? 'bg-primary font-medium text-primary-foreground'
				: 'text-muted-foreground hover:text-foreground'}"><o.icon class="size-4" />{o.label}</button
		>
	{/each}
</div>
