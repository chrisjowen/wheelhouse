<script lang="ts">
	/**
	 * A document set like a long read: one centred column of serif text on the page's paper,
	 * the header the page passes in, the rendered body, and for a long document an outline of
	 * its sections (in the margin when there is room, folded above the text otherwise). Before
	 * the browser renders the Markdown (`html` is null), the text reads as written.
	 */
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { OUTLINE_MIN, outline, type OutlineEntry } from '$lib/doc';

	let {
		html,
		text,
		header,
		footer
	}: { html: string | null; text: string; header: Snippet; footer?: Snippet } = $props();

	// The outline is read from the rendered headings, which get ids to link to.
	let sheet = $state<HTMLDivElement | null>(null);
	let sections = $state<OutlineEntry[]>([]);
	let current = $state<string | null>(null);
	$effect(() => {
		void html;
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
		// The current section is the last heading scrolled past the bar at the top of the view,
		// read from where the headings are now so a jump of many sections lands right too.
		let frame = 0;
		const mark = () => {
			frame = 0;
			const past = hs.filter((h) => h.getBoundingClientRect().top < 140);
			current = past.length ? past[past.length - 1].id : o[0].id;
		};
		const onScroll = () => (frame ||= requestAnimationFrame(mark));
		mark();
		addEventListener('scroll', onScroll, { passive: true });
		return () => {
			removeEventListener('scroll', onScroll);
			cancelAnimationFrame(frame);
		};
	});
	const showOutline = $derived(sections.length >= OUTLINE_MIN);
</script>

<div class="doc-layout">
	<article class="doc-column" aria-labelledby="doc-title">
		<header class="doc-head">
			{@render header()}
		</header>

		{#if showOutline}
			<!-- Without room in the margin, the outline folds up above the text. -->
			<details class="doc-contents group">
				<summary class="flex items-center gap-2 py-3 text-muted-foreground hover:text-foreground">
					<ChevronRight
						class="size-4 transition-transform group-open:rotate-90"
						aria-hidden="true"
					/>Contents
					<span class="text-xs">· {sections.length} sections</span>
				</summary>
				<ol class="space-y-1.5 pb-4 pl-6">
					{#each sections as s (s.id)}
						<li class={s.level === 3 ? 'pl-4' : ''}>
							<a href="#{s.id}" class="text-ink/80 hover:text-ink hover:underline">{s.text}</a>
						</li>
					{/each}
				</ol>
			</details>
		{/if}

		<div class="doc-md" bind:this={sheet}>
			{#if html !== null}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by the page's renderer (chat/markdown.ts) -->
				{@html html}
			{:else}
				<!-- DOMPurify needs the browser's DOM; until then the text reads as written. -->
				<div class="whitespace-pre-wrap">{text}</div>
			{/if}
		</div>
		<div class="doc-foot">{@render footer?.()}</div>
	</article>

	{#if showOutline}
		<nav class="doc-outline" aria-label="Contents">
			<div class="sticky top-36 max-h-[calc(100dvh-11rem)] overflow-y-auto overscroll-contain">
				<p class="mono-label">Contents</p>
				<ol class="mt-4 space-y-1 border-l border-hair">
					{#each sections as s (s.id)}
						<li>
							<a
								href="#{s.id}"
								aria-current={current === s.id ? 'location' : undefined}
								class="-ml-px block border-l py-1 leading-snug transition-colors {s.level === 3
									? 'pl-7'
									: 'pl-4'} {current === s.id
									? 'border-ink text-ink'
									: 'border-transparent text-muted-foreground hover:text-ink'}">{s.text}</a
							>
						</li>
					{/each}
				</ol>
			</div>
		</nav>
	{/if}
</div>

<style>
	/*
	 * The column sits in the middle of the page whatever is beside it: equal margins either
	 * side, at least 1.25rem on a phone. The outline, when there is one, lives in the right
	 * margin and never pushes the text off centre.
	 */
	.doc-layout {
		container-type: inline-size;
		display: grid;
		grid-template-columns: minmax(1.25rem, 1fr) minmax(0, 680px) minmax(1.25rem, 1fr);
		padding: 3.5rem 0 7rem;
	}
	.doc-column {
		grid-column: 2;
		min-width: 0;
	}
	.doc-outline {
		display: none;
		grid-column: 3;
		padding: 0 1.5rem 0 3.5rem;
		max-width: 20rem;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	.doc-contents {
		margin-top: 2rem;
		border-block: 1px solid var(--hair);
		font-size: 0.9375rem;
	}
	.doc-contents summary {
		list-style: none;
	}
	.doc-contents summary::-webkit-details-marker {
		display: none;
	}
	@container (min-width: 1180px) {
		.doc-outline {
			display: block;
		}
		.doc-contents {
			display: none;
		}
	}
	@media (max-width: 639px) {
		.doc-layout {
			padding: 2rem 0 5rem;
		}
	}

	.doc-head :global(h1) {
		font-family: var(--font-sans);
		font-weight: 700;
		font-size: 2.625rem;
		line-height: 1.15;
		letter-spacing: -0.022em;
		color: var(--foreground);
		text-wrap: balance;
	}
	@media (max-width: 639px) {
		.doc-head :global(h1) {
			font-size: 2rem;
		}
	}

	/* The body: Source Serif at 20px on a 1.6 line, the way a long read sets it. */
	.doc-md {
		margin-top: 2.75rem;
		font-family: var(--font-doc);
		font-size: 1.25rem;
		line-height: 1.6;
		letter-spacing: -0.003em;
		font-optical-sizing: auto;
		color: var(--ink);
		overflow-wrap: break-word;
		text-rendering: optimizeLegibility;
		font-kerning: normal;
	}
	@media (max-width: 639px) {
		.doc-md {
			margin-top: 2rem;
			font-size: 1.125rem;
			line-height: 1.6;
		}
	}
	.doc-md > :global(* + *) {
		margin-top: 1.45em;
	}
	.doc-md > :global(:first-child) {
		margin-top: 0;
	}

	/* Headings: the UI's sans, set bold and close, with room above to start a new part. */
	.doc-md :global(:is(h1, h2, h3, h4, h5, h6)) {
		font-family: var(--font-sans);
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: -0.016em;
		color: var(--foreground);
		scroll-margin-top: 8rem;
		text-wrap: balance;
	}
	.doc-md :global(h1) {
		font-size: 1.6em;
		margin-top: 2.2em;
	}
	.doc-md :global(h2) {
		font-size: 1.4em;
		margin-top: 2.1em;
	}
	.doc-md :global(h3) {
		font-size: 1.15em;
		margin-top: 1.9em;
	}
	.doc-md :global(:is(h4, h5, h6)) {
		font-size: 1em;
		margin-top: 1.8em;
	}
	.doc-md > :global(:is(h1, h2, h3, h4, h5, h6) + *) {
		margin-top: 0.5em;
	}
	.doc-md > :global(h2 + :is(h3, h4)) {
		margin-top: 1em;
	}
	.doc-md > :global(:is(h1, h2, h3, h4, h5, h6):first-child) {
		margin-top: 0;
	}

	.doc-md :global(a) {
		color: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-decoration-color: color-mix(in oklab, currentColor 45%, transparent);
		text-underline-offset: 0.18em;
		transition: text-decoration-color 120ms;
	}
	.doc-md :global(a:hover) {
		text-decoration-color: currentColor;
	}
	.doc-md :global(strong) {
		font-weight: 650;
		color: var(--foreground);
	}

	.doc-md :global(:is(ul, ol)) {
		padding-left: 1.6em;
	}
	.doc-md :global(ul) {
		list-style: disc;
	}
	.doc-md :global(ul ul) {
		list-style: circle;
	}
	.doc-md :global(ol) {
		list-style: decimal;
	}
	.doc-md :global(li) {
		padding-left: 0.25em;
	}
	.doc-md :global(li + li),
	.doc-md :global(li > :is(ul, ol, p + p)) {
		margin-top: 0.55em;
	}
	.doc-md :global(li::marker) {
		color: var(--muted-foreground);
	}
	.doc-md :global(li > input[type='checkbox']) {
		margin-right: 0.4em;
		accent-color: var(--ink);
	}

	/* Code: a quiet tint on the paper, mono a step smaller than the text around it. */
	.doc-md :global(:not(pre) > code) {
		font-family: var(--font-mono);
		font-size: 0.78em;
		background: color-mix(in oklab, var(--ink) 7%, var(--paper));
		border-radius: 0.25rem;
		padding: 0.15em 0.35em;
		overflow-wrap: anywhere;
	}
	.doc-md :global(pre) {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		line-height: 1.7;
		letter-spacing: 0;
		background: color-mix(in oklab, var(--ink) 4.5%, var(--paper));
		border: 1px solid color-mix(in oklab, var(--ink) 7%, var(--paper));
		border-radius: 0.375rem;
		padding: 1.1rem 1.35rem;
		overflow-x: auto;
		tab-size: 2;
		margin-top: 1.6em;
	}
	.doc-md :global(pre code) {
		font-size: inherit;
		background: none;
		padding: 0;
	}

	.doc-md :global(blockquote) {
		border-left: 3px solid var(--ink);
		padding-left: 1.2em;
		font-style: italic;
		color: color-mix(in oklab, var(--ink) 85%, var(--paper));
	}
	.doc-md :global(blockquote > * + *) {
		margin-top: 0.9em;
	}

	/* Tables read as data: the sans face, smaller, and a wide one scrolls inside the column. */
	.doc-md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-family: var(--font-sans);
		font-size: 0.8em;
		line-height: 1.5;
		letter-spacing: 0;
		font-variant-numeric: tabular-nums;
		margin-top: 1.8em;
	}
	.doc-md :global(:is(th, td)) {
		border-bottom: 1px solid var(--hair);
		padding: 0.65em 1.25em 0.65em 0;
		text-align: left;
		vertical-align: top;
	}
	.doc-md :global(:is(th, td):last-child) {
		padding-right: 0;
	}
	.doc-md :global(th) {
		font-weight: 600;
		color: var(--foreground);
		border-bottom: 1.5px solid color-mix(in oklab, var(--ink) 55%, var(--paper));
		white-space: nowrap;
	}
	.doc-md :global(td code) {
		overflow-wrap: normal;
	}

	/* A break between parts: three spaced dots, centred. */
	.doc-md :global(hr) {
		border: 0;
		height: auto;
		margin: 2.6em 0;
		text-align: center;
		overflow: visible;
	}
	.doc-md :global(hr::before) {
		content: '···';
		display: block;
		font-size: 1.5em;
		line-height: 1;
		letter-spacing: 0.9em;
		margin-right: -0.9em;
		color: var(--muted-foreground);
	}
	.doc-md > :global(hr + *) {
		margin-top: 0;
	}

	.doc-md :global(img) {
		display: block;
		max-width: 100%;
		height: auto;
		margin: 2em auto;
		border-radius: 0.25rem;
	}
	.doc-md :global(::selection) {
		background: color-mix(in oklab, var(--sea) 28%, transparent);
	}

	.doc-foot {
		font-size: 0.875rem;
		color: var(--muted-foreground);
	}
</style>
