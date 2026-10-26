<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { markdown } from '$lib/chat/markdown';

	/**
	 * The assembled spec as a document, or as the message Firstmate receives.
	 * The section being edited is marked and scrolled into view when the
	 * preview has its own scroll. Rendered only in the browser, where the
	 * Markdown is sanitised.
	 */
	let {
		text,
		sent,
		focus
	}: {
		/** The spec as Markdown, with pictures the page can show. */
		text: string;
		/** The message as sent (pictures named, not shown). */
		sent: string;
		/** The heading of the section being edited; null for the top. */
		focus: string | null;
	} = $props();

	let mode = $state<'document' | 'sent'>('document');
	let mounted = $state(false);
	let scroller: HTMLDivElement | undefined = $state();
	let scrolledTo = '';
	onMount(() => (mounted = true));

	const html = $derived(mounted ? markdown(text) : '');

	$effect(() => {
		void html;
		void mode;
		const want = focus;
		void tick().then(() => {
			if (!scroller) return;
			let target: HTMLElement | null = null;
			for (const h of scroller.querySelectorAll<HTMLElement>('h2')) {
				const on = !!want && h.textContent?.trim() === want;
				h.classList.toggle('is-current', on);
				if (on) target = h;
			}
			// Scroll when the section (or whether it shows yet) changes, not on every keystroke.
			const key = `${want}:${!!target}`;
			if (key === scrolledTo || scroller.scrollHeight <= scroller.clientHeight) return;
			scrolledTo = key;
			scroller.scrollTo({ top: target ? target.offsetTop - 16 : 0, behavior: 'smooth' });
		});
	});
</script>

<div class="flex items-center gap-1" role="radiogroup" aria-label="Preview as">
	{#each [['document', 'Document'], ['sent', 'As sent']] as const as [m, label] (m)}
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

<div
	bind:this={scroller}
	class="relative mt-3 rounded-lg border bg-card px-6 py-5 shadow-xs xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto"
>
	{#if mode === 'sent'}
		<p class="mb-3 text-xs text-muted-foreground">
			The one message Firstmate receives. Screenshots go with it as files it can open.
		</p>
		<pre
			class="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{sent}</pre>
	{:else if mounted}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
		<div class="chat-md spec-md text-sm">{@html html}</div>
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
		transition: border-color 200ms ease-out;
	}
	.spec-md :global(h2.is-current) {
		border-bottom-color: var(--brass);
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
		max-height: 20rem;
		object-fit: contain;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
	}
</style>
