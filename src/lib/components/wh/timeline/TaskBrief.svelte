<script lang="ts">
	import { browser } from '$app/environment';
	import { ChevronRight } from '@lucide/svelte';
	import { briefSize, type TaskBrief } from '$lib/brief';
	import { markdown } from '$lib/chat/markdown';
	import { docHref } from '$lib/docpath';
	import type { Available } from '$lib/types';

	/**
	 * The instructions the worker was given, as the timeline's first stage: the
	 * captain's intent in the captain's own words, Firstmate's spec, and the
	 * rest of the brief (setup, rules, definition of done) folded away.
	 */
	let { brief, taskId }: { brief: Available<TaskBrief>; taskId: string } = $props();

	let toggled = $state<Record<string, boolean>>({});
	const open = (part: 'spec' | 'rest') => toggled[`${taskId} ${part}`] ?? part === 'spec';
	const flip = (part: 'spec' | 'rest') => (toggled[`${taskId} ${part}`] = !open(part));
</script>

{#snippet md(text: string)}
	{#if browser}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
		<div class="chat-md text-sm leading-relaxed">{@html markdown(text, { docLinks: true })}</div>
	{:else}
		<p class="text-sm leading-relaxed whitespace-pre-line">{text}</p>
	{/if}
{/snippet}

{#snippet fold(part: 'spec' | 'rest', label: string)}
	<button
		type="button"
		class="touch-target flex w-full items-center gap-1.5 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
		aria-expanded={open(part)}
		aria-controls="brief-{part}"
		onclick={() => flip(part)}
		>{label}<ChevronRight
			class="size-3.5 transition-transform {open(part) ? 'rotate-90' : ''}"
			aria-hidden="true"
		/></button
	>
{/snippet}

{#if !brief.available}
	<p class="text-sm text-muted-foreground" data-brief="none">{brief.reason}</p>
{:else}
	{@const b = brief.value}
	<div class="max-w-[90ch] overflow-hidden rounded-xl border bg-panel" data-brief>
		{#if b.intent}
			<div class="border-b px-5 py-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Captain’s intent
				</p>
				<blockquote
					class="mt-2 border-l-2 border-brass pl-4 font-reading text-lg leading-relaxed whitespace-pre-line"
				>
					{b.intent}
				</blockquote>
			</div>
		{/if}
		{#if b.spec}
			<div class="border-b px-5 py-4">
				{@render fold('spec', 'Firstmate’s spec')}
				{#if open('spec')}<div id="brief-spec" class="mt-3">{@render md(b.spec)}</div>{/if}
			</div>
		{/if}
		{#if b.rest}
			<div class="px-5 py-3">
				{@render fold(
					'rest',
					b.intent || b.spec ? 'The rest of the brief' : 'The brief, as the worker got it'
				)}
				{#if open('rest')}
					<div id="brief-rest" class="mt-3 max-h-[32rem] overflow-y-auto">{@render md(b.rest)}</div>
				{/if}
			</div>
		{/if}
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-5 py-2 text-xs text-muted-foreground"
		>
			{#if b.mate}
				<span class="font-mono">{b.path}</span>
			{:else}
				<a
					href={docHref(b.path)}
					class="touch-target font-mono text-sea hover:underline"
					data-doc-link>{b.path}</a
				>
			{/if}
			<span>{briefSize(b.bytes)}{b.truncated ? ', only its start shown here' : ''}</span>
			{#if b.mate}<span
					>from second mate {b.mate}’s home{b.remote ? ', read over SSH' : ''}, read-only</span
				>{/if}
		</div>
	</div>
{/if}
