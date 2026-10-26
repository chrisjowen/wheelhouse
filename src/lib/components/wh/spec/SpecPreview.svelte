<script lang="ts">
	import { onMount } from 'svelte';
	import { markdown } from '$lib/chat/markdown';

	/**
	 * The assembled spec as it reads, or as the plain text Firstmate receives.
	 * Rendered only in the browser, where the Markdown is sanitised.
	 */
	let { text }: { text: string } = $props();

	let mode = $state<'document' | 'plain'>('document');
	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

<div class="flex items-center gap-1" role="radiogroup" aria-label="Preview as">
	{#each [['document', 'Document'], ['plain', 'Plain text']] as const as [m, label] (m)}
		<button
			role="radio"
			aria-checked={mode === m}
			onclick={() => (mode = m)}
			class="rounded-full border px-3 py-0.5 text-xs {mode === m
				? 'border-foreground/30 bg-accent font-medium'
				: 'border-transparent text-muted-foreground hover:text-foreground'}">{label}</button
		>
	{/each}
</div>

<div class="mt-3 rounded-lg border bg-card px-6 py-5 shadow-xs">
	{#if mode === 'plain'}
		<pre
			class="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{text}</pre>
	{:else if mounted}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
		<div class="chat-md spec-md text-sm">{@html markdown(text)}</div>
	{/if}
</div>

<style>
	.spec-md :global(h1) {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 500;
		margin-top: 0;
	}
	.spec-md :global(h2) {
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 500;
		margin-top: 1.5em;
		padding-bottom: 0.2em;
		border-bottom: 1px solid var(--hair);
	}
	.spec-md :global(ul:has(input[type='checkbox'])) {
		list-style: none;
		padding-left: 0.2em;
	}
	.spec-md :global(input[type='checkbox']) {
		margin-right: 0.5em;
		accent-color: var(--sea);
	}
	.spec-md :global(img) {
		max-width: 100%;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
	}
</style>
