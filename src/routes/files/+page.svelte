<script lang="ts">
	import { ArrowLeft, FileText } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { renderDoc } from '$lib/chat/markdown';
	import DocSheet from '$lib/components/wh/DocSheet.svelte';

	let { data } = $props();
	const doc = $derived(data.doc);
	// The title is shown above; drop a matching first heading from the body.
	const body = $derived(
		doc
			? doc.markdown.replace(/^(?:---\n[\s\S]*?\n---\n)?\s*#\s+(.+)\n/, (m, h: string) =>
					h.trim() === doc.title ? '' : m
				)
			: ''
	);

	// Back to wherever the link was, else home.
	function back(e: MouseEvent) {
		if (history.length > 1) {
			e.preventDefault();
			history.back();
		}
	}
</script>

<svelte:head><title>{doc?.title ?? 'Document'} · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-20 sm:px-6 lg:px-10">
	<!-- The document is a sheet of paper; the page around it stays full width and left-aligned. -->
	<div class="surface overflow-hidden">
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hair bg-panel px-5 py-3 text-sm sm:px-8"
		>
			<a
				href="/"
				onclick={back}
				class="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
				><ArrowLeft class="size-4" aria-hidden="true" />Back</a
			>
			<span class="ml-auto text-xs text-muted-foreground">Read only</span>
		</div>

		{#if doc}
			<DocSheet html={browser ? renderDoc(body, doc.path) : null} text={body}>
				{#snippet header()}
					<p
						class="flex items-center gap-2 font-display text-[1.05rem] tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
					>
						<FileText class="size-4" aria-hidden="true" />Document
					</p>
					<h1 id="doc-title" class="mt-2 text-[2.4rem] leading-[1.15] text-balance">
						{doc.title}
					</h1>
					<p class="mt-3 font-mono text-xs break-all text-muted-foreground" data-doc-source>
						{doc.shown}
					</p>
				{/snippet}
				{#snippet footer()}
					{#if doc.truncated}<p class="mt-8 text-sm text-muted-foreground">
							This document is long, so only its start is shown here.
						</p>{/if}
				{/snippet}
			</DocSheet>
		{:else}
			<div class="max-w-[70ch] px-5 py-10 sm:px-8">
				<p class="font-medium">This document cannot be shown</p>
				<p class="mt-1 text-sm text-muted-foreground">{data.problem}</p>
				{#if data.requested}<p class="mt-3 font-mono text-xs break-all text-muted-foreground">
						{data.requested}
					</p>{/if}
			</div>
		{/if}
	</div>
</main>
