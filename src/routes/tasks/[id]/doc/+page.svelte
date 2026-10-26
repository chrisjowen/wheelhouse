<script lang="ts">
	import { ArrowLeft, ExternalLink, FileText, Scale } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { markdown } from '$lib/chat/markdown';
	import { DOC_KIND_LABEL } from '$lib/buildlog';

	let { data } = $props();
	const back = $derived(`/tasks/${encodeURIComponent(data.id)}?tab=docs`);
	const doc = $derived(data.doc?.available ? data.doc.value : null);
	// The title is shown above; drop a matching first heading from the body.
	const body = $derived(
		doc
			? doc.markdown.replace(/^(?:---\n[\s\S]*?\n---\n)?\s*#\s+(.+)\n/, (m, h: string) =>
					h.trim() === doc.title ? '' : m
				)
			: ''
	);
</script>

<svelte:head><title>{doc?.title ?? 'Document'} · Wheelhouse</title></svelte:head>

<main class="px-4 pt-4 pb-20 sm:px-6 lg:px-10">
	<a
		href={back}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" aria-hidden="true" />{data.task?.title ?? 'Back to the task'}</a
	>
	{#if doc}
		<article class="mt-6 max-w-[72ch]">
			<p class="flex items-center gap-2 text-sm text-muted-foreground">
				{#if doc.kind === 'decision'}<Scale class="size-4" aria-hidden="true" />{:else}<FileText
						class="size-4"
						aria-hidden="true"
					/>{/if}
				{DOC_KIND_LABEL[doc.kind]}
			</p>
			<h1 class="mt-1 text-[2rem] leading-tight text-balance">{doc.title}</h1>
			<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				<span>{doc.name}</span>
				{#if doc.github}<a
						href={doc.github}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-sea hover:underline"
						>Open on GitHub<ExternalLink class="size-3.5" aria-hidden="true" /></a
					>{/if}
			</p>
			<div class="doc-md chat-md mt-8 border-t border-hair pt-6 leading-relaxed">
				{#if browser}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
					{@html markdown(body)}
				{:else}
					<!-- DOMPurify needs the browser's DOM; until then the text reads as written. -->
					<div class="whitespace-pre-wrap">{body}</div>
				{/if}
			</div>
			{#if doc.truncated}<p class="mt-6 text-sm text-muted-foreground">
					This document is long, so only its start is shown here.
				</p>{/if}
			{#if data.doc?.available}<p class="mt-8 text-xs text-muted-foreground">
					From {data.doc.source}.
				</p>{/if}
		</article>
	{:else}
		<div class="mt-8 max-w-[72ch] rounded-lg border border-dashed p-6">
			<p class="font-medium">This document cannot be shown</p>
			<p class="mt-1 text-sm text-muted-foreground">
				{data.doc && !data.doc.available ? data.doc.reason : data.problem}
			</p>
		</div>
	{/if}
</main>

<style>
	/* A document reads like a page of the log: serif headings, generous rhythm. */
	.doc-md :global(:is(h1, h2, h3)) {
		font-family: var(--font-display);
		font-weight: 500;
		margin-top: 1.6em;
	}
	.doc-md :global(h1) {
		font-size: 1.6rem;
	}
	.doc-md :global(h2) {
		font-size: 1.35rem;
	}
	.doc-md :global(h3) {
		font-size: 1.15rem;
	}
	.doc-md :global(p),
	.doc-md :global(li) {
		line-height: 1.7;
	}
</style>
