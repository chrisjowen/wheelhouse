<script lang="ts">
	import { ArrowLeft, ExternalLink, FileText, Scale } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { markdown } from '$lib/chat/markdown';
	import { DOC_KIND_LABEL } from '$lib/buildlog';
	import DocSheet from '$lib/components/wh/DocSheet.svelte';

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

<main class="px-4 pt-6 pb-20 sm:px-6 lg:px-10">
	<!-- The document is a sheet of paper; the page around it stays full width and left-aligned. -->
	<div class="surface overflow-hidden">
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hair bg-panel px-5 py-3 text-sm sm:px-8"
		>
			<a
				href={back}
				class="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
				><ArrowLeft class="size-4" aria-hidden="true" />{data.task?.title ?? 'Back to the task'}</a
			>
			{#if doc?.github}<a
					href={doc.github}
					target="_blank"
					rel="noreferrer"
					class="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sea hover:bg-accent"
					>Open on GitHub<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>{/if}
		</div>

		{#if doc}
			<DocSheet html={browser ? markdown(body) : null} text={body}>
				{#snippet header()}
					<p
						class="flex items-center gap-2 font-display text-[1.05rem] tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
					>
						{#if doc.kind === 'decision'}<Scale class="size-4" aria-hidden="true" />{:else}<FileText
								class="size-4"
								aria-hidden="true"
							/>{/if}
						{DOC_KIND_LABEL[doc.kind]}
					</p>
					<h1 id="doc-title" class="mt-2 text-[2.4rem] leading-[1.15] text-balance">
						{doc.title}
					</h1>
					<p class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
						<span class="font-mono text-xs" data-doc-source>{doc.name}</span>
						<span aria-hidden="true">·</span>
						<span class={doc.changed ? 'text-foreground/80' : ''}
							>{doc.changed ? 'Changed in this task' : 'Read by the worker for this task'}</span
						>
					</p>
				{/snippet}
				{#snippet footer()}
					{#if doc.truncated}<p class="mt-8 text-sm text-muted-foreground">
							This document is long, so only its start is shown here.
						</p>{/if}
					{#if data.doc?.available}<p
							class="mt-12 border-t border-hair pt-4 text-xs text-muted-foreground"
						>
							From {data.doc.source}.
						</p>{/if}
				{/snippet}
			</DocSheet>
		{:else}
			<div class="max-w-[70ch] px-5 py-10 sm:px-8">
				<p class="font-medium">This document cannot be shown</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{data.doc && !data.doc.available ? data.doc.reason : data.problem}
				</p>
			</div>
		{/if}
	</div>
</main>
