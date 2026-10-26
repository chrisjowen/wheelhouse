<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Check, LoaderCircle, MessageSquarePlus, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import DictateTextarea from '$lib/components/wh/DictateTextarea.svelte';
	import { markdown } from '$lib/chat/markdown';
	import {
		SPEC_SECTIONS,
		sectionFilled,
		sectionMarkdown,
		specTitle,
		type SpecDraft,
		type SpecImage,
		type SpecSectionId
	} from '$lib/spec';

	/**
	 * The spec as a document that fills in as the interview goes: every
	 * section, written or not yet, with the ones the last answer changed
	 * marked. Select words in a section (or use a section's comment button) to
	 * leave a comment; the interviewer addresses each one and marks it
	 * resolved. Rendered in the browser, where the Markdown is sanitised.
	 */
	let {
		draft,
		imageUrl,
		changed,
		busy,
		onComment,
		onRemoveComment
	}: {
		draft: SpecDraft;
		imageUrl: (img: SpecImage) => string;
		/** Sections the interviewer's last turn changed. */
		changed: SpecSectionId[];
		/** The interviewer is working. */
		busy: boolean;
		onComment: (c: { section: SpecSectionId; quote: string; text: string }) => Promise<boolean>;
		onRemoveComment: (id: string) => void;
	} = $props();

	let mounted = $state(false);
	onMount(() => (mounted = true));

	const sections = SPEC_SECTIONS.filter((s) => s.id !== 'project');
	const covered = $derived(SPEC_SECTIONS.filter((s) => sectionFilled(draft, s.id)).length);
	const html = (id: SpecSectionId) =>
		mounted ? markdown(sectionMarkdown(draft, id, imageUrl)) : '';
	const comments = (id: SpecSectionId) => draft.comments.filter((c) => c.section === id);
	const openCount = $derived(draft.comments.filter((c) => !c.resolvedAt).length);
	const changedTitles = $derived(
		SPEC_SECTIONS.filter((s) => changed.includes(s.id)).map((s) =>
			s.id === 'project' ? 'Title and summary' : s.title
		)
	);

	// The comment being written: on which section, about which words.
	let writing = $state<{ section: SpecSectionId; quote: string } | null>(null);
	let text = $state('');
	let posting = $state(false);
	// The "Comment" button that floats by a selection.
	let floating = $state<{
		section: SpecSectionId;
		quote: string;
		top: number;
		left: number;
	} | null>(null);
	let root: HTMLDivElement | undefined = $state();

	function readSelection() {
		const sel = window.getSelection();
		if (!root || !sel || sel.isCollapsed || !sel.rangeCount) {
			floating = null;
			return;
		}
		const range = sel.getRangeAt(0);
		const at = (n: Node | null) =>
			(n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-section]');
		const start = at(range.startContainer);
		const section = start?.dataset.section as SpecSectionId | undefined;
		const quote = sel.toString().replace(/\s+/g, ' ').trim();
		if (!start || !root.contains(start) || !section || !quote) {
			floating = null;
			return;
		}
		const box = range.getBoundingClientRect();
		const frame = root.getBoundingClientRect();
		floating = {
			section,
			quote: quote.length > 300 ? `${quote.slice(0, 297)}…` : quote,
			top: box.bottom - frame.top + 6,
			left: Math.max(0, Math.min(box.left - frame.left, frame.width - 120))
		};
	}

	async function startComment(section: SpecSectionId, quote = '') {
		floating = null;
		writing = { section, quote };
		text = '';
		await tick();
		root?.querySelector<HTMLTextAreaElement>(`[data-comment-box] textarea`)?.focus();
	}

	async function post() {
		if (!writing || !text.trim() || posting) return;
		posting = true;
		const ok = await onComment({ ...writing, text: text.trim() });
		posting = false;
		if (ok) {
			writing = null;
			text = '';
			window.getSelection()?.removeAllRanges();
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void post();
		} else if (e.key === 'Escape') {
			writing = null;
		}
	}
</script>

{#snippet commentBox(section: SpecSectionId)}
	{#if writing?.section === section}
		<div class="mt-3 rounded-md border border-brass/50 bg-background p-3" data-comment-box>
			{#if writing.quote}
				<p class="mb-2 border-l-2 border-brass pl-2 text-xs text-muted-foreground italic">
					“{writing.quote}”
				</p>
			{/if}
			<DictateTextarea
				bind:value={text}
				rows={2}
				placeholder="What should change here?"
				aria-label="Your comment"
				{onkeydown}
			/>
			<div class="mt-2 flex items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (writing = null)}>Cancel</Button>
				<Button size="sm" onclick={post} disabled={!text.trim() || posting}>
					{#if posting}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
					Comment
				</Button>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet commentList(section: SpecSectionId)}
	{@const list = comments(section)}
	{#if list.length}
		<ul class="mt-3 space-y-2" aria-label="Comments">
			{#each list as c (c.id)}
				<li
					class="rounded-md border px-3 py-2 text-sm {c.resolvedAt
						? 'border-hair bg-muted/40 text-muted-foreground'
						: 'border-brass/50 bg-background'}"
				>
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							{#if c.quote}
								<p class="mb-1 border-l-2 border-brass/70 pl-2 text-xs italic">“{c.quote}”</p>
							{/if}
							<p class="break-words {c.resolvedAt ? '' : 'text-foreground'}">{c.text}</p>
							{#if c.resolvedAt}
								<p class="mt-1 flex items-start gap-1.5 text-xs">
									<Check class="mt-0.5 size-3.5 shrink-0 text-sea" aria-hidden="true" />
									<span><span class="sr-only">Resolved: </span>{c.reply || 'Addressed.'}</span>
								</p>
							{:else}
								<p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
									{#if busy}<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />The
										interviewer is on it{:else}Open: the interviewer addresses it next{/if}
								</p>
							{/if}
						</div>
						{#if !c.resolvedAt}
							<button
								class="-mt-0.5 -mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
								onclick={() => onRemoveComment(c.id)}
								aria-label="Remove this comment"
								title="Remove this comment"
							>
								<X class="size-3.5" aria-hidden="true" />
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet commentButton(section: SpecSectionId, label: string)}
	<button
		class="comment-btn ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
		onclick={() => startComment(section)}
		aria-label="Comment on {label}"
		title="Comment on {label}"
	>
		<MessageSquarePlus class="size-4" aria-hidden="true" />
	</button>
{/snippet}

<!-- Selected words are read when the pointer is released; every section also has its own comment button. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={root}
	class="spec-doc relative rounded-lg border border-hair bg-card px-5 py-5 sm:px-7 sm:py-6"
	onpointerup={() => setTimeout(readSelection)}
	onkeyup={(e) => e.shiftKey && readSelection()}
>
	<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
		<span class="tabular">{covered} of {SPEC_SECTIONS.length} sections covered</span>
		{#if openCount}<span class="text-brass"
				>{openCount} open comment{openCount === 1 ? '' : 's'}</span
			>{/if}
		{#if draft.interview.done}<span
				class="rounded-full border border-sea/50 px-2 py-0.5 font-medium text-sea"
				>Ready to build</span
			>{/if}
	</p>
	{#if changedTitles.length}
		<p class="mt-1 text-xs text-muted-foreground" aria-live="polite">
			Just changed: {changedTitles.join(', ')}.
		</p>
	{/if}

	<header
		data-section="project"
		class="doc-section mt-4 {changed.includes('project') ? 'is-updated' : ''}"
	>
		<div class="flex items-start gap-2">
			<h2 class="min-w-0 flex-1 font-display text-[1.7rem] leading-tight font-medium">
				{specTitle(draft)}
			</h2>
			{@render commentButton('project', 'the title and summary')}
		</div>
		{#if sectionMarkdown(draft, 'project')}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
			<div class="chat-md mt-2 text-[0.95rem]">{@html html('project')}</div>
		{:else}
			<p class="mt-2 text-sm text-muted-foreground italic">
				The project and a one-line summary appear here as the interview goes.
			</p>
		{/if}
		{@render commentList('project')}
		{@render commentBox('project')}
	</header>

	{#each sections as s (s.id)}
		{@const body = sectionMarkdown(draft, s.id)}
		<section
			data-section={s.id}
			class="doc-section mt-6 {changed.includes(s.id) ? 'is-updated' : ''}"
			aria-labelledby="doc-{s.id}"
		>
			<div class="flex items-center gap-2 border-b border-hair pb-1">
				<h3 id="doc-{s.id}" class="font-display text-[1.2rem] font-medium">{s.title}</h3>
				{#if changed.includes(s.id)}<span
						class="rounded-full bg-brass/15 px-2 py-0.5 text-[0.7rem] font-medium tracking-wide text-brass"
						>Updated</span
					>{/if}
				{@render commentButton(s.id, s.title)}
			</div>
			{#if body}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
				<div class="chat-md doc-md mt-2 text-[0.95rem]">{@html html(s.id)}</div>
			{:else}
				<p class="mt-2 text-sm text-muted-foreground italic">Not covered yet.</p>
			{/if}
			{@render commentList(s.id)}
			{@render commentBox(s.id)}
		</section>
	{/each}

	{#if floating}
		{@const f = floating}
		<button
			class="absolute z-10 flex items-center gap-1.5 rounded-md border border-brass bg-card px-2.5 py-1 text-xs font-medium shadow-md hover:bg-accent"
			style="top: {f.top}px; left: {f.left}px"
			onpointerup={(e) => e.stopPropagation()}
			onclick={() => startComment(f.section, f.quote)}
		>
			<MessageSquarePlus class="size-3.5" aria-hidden="true" />Comment
		</button>
	{/if}
</div>

<style>
	.doc-section {
		position: relative;
		transition: background-color 400ms ease-out;
	}
	/* What the last answer changed: a quiet brass rule in the margin. */
	.doc-section.is-updated::before {
		content: '';
		position: absolute;
		left: -0.9rem;
		top: 0.2rem;
		bottom: 0.2rem;
		width: 2px;
		border-radius: 2px;
		background: var(--brass);
	}
	@media (hover: hover) {
		.doc-section .comment-btn {
			opacity: 0.45;
		}
		.doc-section:hover .comment-btn,
		.comment-btn:focus-visible {
			opacity: 1;
		}
	}
	.doc-md :global(ul:has(input[type='checkbox'])) {
		list-style: none;
		padding-left: 0.2em;
	}
	.doc-md :global(li:has(> input[type='checkbox'])) {
		padding-left: 1.6em;
		text-indent: -1.6em;
	}
	.doc-md :global(input[type='checkbox']) {
		margin-right: 0.5em;
		accent-color: var(--sea);
	}
	.doc-md :global(img) {
		max-height: 18rem;
		object-fit: contain;
	}
</style>
