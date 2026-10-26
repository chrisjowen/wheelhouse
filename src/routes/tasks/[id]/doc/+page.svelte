<script lang="ts">
	import { ArrowLeft, ExternalLink, FileText, Scale } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { markdown } from '$lib/chat/markdown';
	import { DOC_KIND_LABEL } from '$lib/buildlog';
	import { OUTLINE_MIN, outline, type OutlineEntry } from '$lib/doc';

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

	// The outline is read from the rendered headings, which get ids to link to.
	let sheet = $state<HTMLDivElement | null>(null);
	let sections = $state<OutlineEntry[]>([]);
	let current = $state<string | null>(null);
	$effect(() => {
		void body;
		if (!sheet) return;
		const hs = [...sheet.querySelectorAll<HTMLHeadingElement>('h2, h3')];
		const taken = [...document.querySelectorAll('[id]')]
			.filter((e) => !hs.includes(e as HTMLHeadingElement))
			.map((e) => e.id);
		const o = outline(
			hs.map((h) => ({ text: h.textContent ?? '', level: h.tagName === 'H2' ? 2 : 3 })),
			taken
		);
		hs.forEach((h, i) => (h.id = o[i].id));
		sections = o;
		if (o.length < OUTLINE_MIN) return;
		// The current section is the last heading scrolled past the top of the view.
		const seen: Record<string, boolean> = {};
		const io = new IntersectionObserver(
			(es) => {
				for (const e of es) seen[e.target.id] = e.boundingClientRect.top < 120;
				const past = o.filter((s) => seen[s.id]);
				current = past.length ? past[past.length - 1].id : o[0].id;
			},
			{ rootMargin: '-120px 0px 0px 0px', threshold: [0, 1] }
		);
		hs.forEach((h) => io.observe(h));
		return () => io.disconnect();
	});
	const showOutline = $derived(sections.length >= OUTLINE_MIN);
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
			<div
				class="grid gap-x-10 px-5 py-10 sm:px-8 sm:py-14 {showOutline
					? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,70ch)_minmax(0,1fr)]'
					: ''}"
			>
				<article
					class="mx-auto w-full max-w-[70ch] min-w-0 xl:col-start-2"
					aria-labelledby="doc-title"
				>
					<header class="border-b border-hair pb-6">
						<p
							class="flex items-center gap-2 font-display text-[1.05rem] tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>
							{#if doc.kind === 'decision'}<Scale
									class="size-4"
									aria-hidden="true"
								/>{:else}<FileText class="size-4" aria-hidden="true" />{/if}
							{DOC_KIND_LABEL[doc.kind]}
						</p>
						<h1 id="doc-title" class="mt-2 text-[2.4rem] leading-[1.15] text-balance">
							{doc.title}
						</h1>
						<p
							class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
						>
							<span class="font-mono text-xs" data-doc-source>{doc.name}</span>
							<span aria-hidden="true">·</span>
							<span class={doc.changed ? 'text-foreground/80' : ''}
								>{doc.changed ? 'Changed in this task' : 'Read by the worker for this task'}</span
							>
						</p>
					</header>

					{#if showOutline}
						<!-- Below xl the outline sits at the top of the document instead of beside it. -->
						<nav
							class="mt-6 rounded-md border border-hair bg-panel px-4 py-3 xl:hidden"
							aria-label="Contents"
						>
							<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Contents
							</p>
							<ol class="mt-2 space-y-1 text-sm">
								{#each sections as s (s.id)}
									<li class={s.level === 3 ? 'pl-4' : ''}>
										<a
											href="#{s.id}"
											class="text-foreground/80 hover:text-foreground hover:underline">{s.text}</a
										>
									</li>
								{/each}
							</ol>
						</nav>
					{/if}

					<div class="doc-md mt-8" bind:this={sheet}>
						{#if browser}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
							{@html markdown(body)}
						{:else}
							<!-- DOMPurify needs the browser's DOM; until then the text reads as written. -->
							<div class="whitespace-pre-wrap">{body}</div>
						{/if}
					</div>
					{#if doc.truncated}<p class="mt-8 text-sm text-muted-foreground">
							This document is long, so only its start is shown here.
						</p>{/if}
					{#if data.doc?.available}<p
							class="mt-12 border-t border-hair pt-4 text-xs text-muted-foreground"
						>
							From {data.doc.source}.
						</p>{/if}
				</article>

				{#if showOutline}
					<nav class="hidden xl:block" aria-label="Contents">
						<div class="sticky top-8">
							<p class="section-label text-[1.05rem]">Contents</p>
							<ol class="mt-3 space-y-1.5 border-l border-hair text-sm">
								{#each sections as s (s.id)}
									<li>
										<a
											href="#{s.id}"
											aria-current={current === s.id ? 'location' : undefined}
											class="-ml-px block border-l py-0.5 transition-colors {s.level === 3
												? 'pl-7'
												: 'pl-4'} {current === s.id
												? 'border-brass text-foreground'
												: 'border-transparent text-muted-foreground hover:text-foreground'}"
											>{s.text}</a
										>
									</li>
								{/each}
							</ol>
						</div>
					</nav>
				{/if}
			</div>
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

<style>
	/* A document reads like a printed page: Newsreader headings, Inter body, an easy measure. */
	.doc-md {
		font-size: 1.0625rem;
		line-height: 1.75;
		overflow-wrap: break-word;
	}
	.doc-md > :global(* + *) {
		margin-top: 1.1em;
	}
	.doc-md :global(:is(h1, h2, h3, h4)) {
		font-family: var(--font-display);
		font-weight: 500;
		line-height: 1.25;
		scroll-margin-top: 5.5rem;
		text-wrap: balance;
	}
	.doc-md :global(h1) {
		font-size: 1.9rem;
		margin-top: 2em;
	}
	.doc-md :global(h2) {
		font-size: 1.6rem;
		margin-top: 2.2em;
		padding-bottom: 0.3em;
		border-bottom: 1px solid var(--hair);
	}
	.doc-md :global(h3) {
		font-size: 1.3rem;
		margin-top: 1.8em;
	}
	.doc-md :global(h4) {
		font-size: 1.1rem;
		margin-top: 1.5em;
	}
	.doc-md :global(:is(h2, h3, h4) + *) {
		margin-top: 0.6em;
	}
	.doc-md > :global(:first-child) {
		margin-top: 0;
	}
	.doc-md :global(a) {
		color: var(--sea);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.doc-md :global(strong) {
		font-weight: 600;
	}
	.doc-md :global(ul) {
		list-style: disc;
		padding-left: 1.5em;
	}
	.doc-md :global(ol) {
		list-style: decimal;
		padding-left: 1.5em;
	}
	.doc-md :global(li + li),
	.doc-md :global(li > :is(ul, ol)) {
		margin-top: 0.35em;
	}
	.doc-md :global(li::marker) {
		color: var(--muted-foreground);
	}
	.doc-md :global(:not(pre) > code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--muted);
		border-radius: 0.3rem;
		padding: 0.1em 0.35em;
	}
	.doc-md :global(pre) {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		line-height: 1.6;
		background: var(--panel);
		border: 1px solid var(--hair);
		border-radius: 0.5rem;
		padding: 0.9rem 1.1rem;
		overflow-x: auto;
	}
	.doc-md :global(blockquote) {
		border-left: 3px solid var(--brass);
		padding: 0.1em 0 0.1em 1.1em;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-style: italic;
		color: var(--muted-foreground);
	}
	.doc-md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 0.95rem;
		line-height: 1.5;
	}
	.doc-md :global(:is(th, td)) {
		border-bottom: 1px solid var(--hair);
		padding: 0.55em 1em 0.55em 0;
		text-align: left;
		vertical-align: top;
	}
	.doc-md :global(th) {
		font-weight: 600;
		border-bottom: 2px solid var(--hair);
		white-space: nowrap;
	}
	.doc-md :global(hr) {
		border: 0;
		border-top: 1px solid var(--hair);
		margin: 2.2em 0;
	}
	.doc-md :global(img) {
		max-width: 100%;
		border-radius: 0.4rem;
	}
</style>
