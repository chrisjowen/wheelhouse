<script lang="ts">
	import type { ChangeRequest, ChangeRequests } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { ago, clock } from '$lib/format';
	import { changesLine, changeWhere, SOURCE_LABEL, splitChanges, STATE_LABEL } from '$lib/changes';
	import { CircleCheck, Circle, ExternalLink } from '@lucide/svelte';

	/**
	 * The changes the captain asked for on a task's pull request, as a
	 * checklist: what is still to do, then what was resolved on GitHub or
	 * addressed by a newer ready report. The history stays after the work
	 * returns to the captain's review.
	 */
	let { changes }: { changes: ChangeRequests } = $props();

	const parts = $derived(splitChanges(changes.items));
	const line = $derived(changesLine(changes));
	let opened = $state<Record<string, boolean>>({});
	let showDone = $state(false);
	const LONG = 280;
</script>

{#snippet row(c: ChangeRequest)}
	{@const where = changeWhere(c)}
	{@const long = c.text.length > LONG}
	<li class="flex gap-2.5 py-2.5" data-change={c.state}>
		{#if c.state === 'open'}
			<Circle class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		{:else}
			<CircleCheck class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
		{/if}
		<div class="min-w-0 flex-1">
			<p class="text-xs text-muted-foreground">
				<span class="sr-only">{STATE_LABEL[c.state]}: </span>{SOURCE_LABEL[c.kind]}{c.author
					? ` · ${c.author}`
					: ''}{where ? ` · ` : ''}{#if where}<span class="font-mono [overflow-wrap:anywhere]"
						>{where}</span
					>{/if} ·
				<time datetime={c.at} title={clock(c.at)}>{ago(c.at, live.now)}</time>
			</p>
			<p
				class="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-line {c.state === 'open'
					? ''
					: 'text-muted-foreground'}"
			>
				{long && !opened[c.id] ? `${c.text.slice(0, LONG).trimEnd()}…` : c.text}
			</p>
			<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
				{#if long}
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground hover:underline"
						aria-expanded={!!opened[c.id]}
						onclick={() => (opened[c.id] = !opened[c.id])}
						>{opened[c.id] ? 'Show less' : 'Show all of it'}</button
					>
				{/if}
				{#if c.state !== 'open'}<span class="text-success">{STATE_LABEL[c.state]}</span>{/if}
				{#if c.url}
					<a
						href={c.url}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-sea hover:underline"
						>Open on GitHub<ExternalLink class="size-3" aria-hidden="true" /></a
					>
				{/if}
			</div>
		</div>
	</li>
{/snippet}

<section
	class="rounded-xl border p-4 {changes.active ? 'border-brass/60 bg-panel' : 'border-hair'}"
	aria-labelledby="changes-heading"
	data-changes={changes.active ? 'active' : 'history'}
>
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
		<h2 id="changes-heading" class="text-base font-medium">
			{changes.active ? 'Changes requested' : 'Requested changes'}
		</h2>
		{#if line}<p class="tabular text-xs text-muted-foreground">{line}</p>{/if}
	</div>
	{#if changes.active}
		<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
			{changes.basis} It is the worker’s turn{changes.since
				? ` (since ${ago(changes.since, live.now)})`
				: ''}; it comes back to your review when the worker reports the pull request ready again.
		</p>
	{/if}
	{#if parts.open.length}
		<ul class="mt-2 divide-y divide-hair" aria-label="To do">
			{#each parts.open as c (c.id)}{@render row(c)}{/each}
		</ul>
	{/if}
	{#if parts.done.length}
		{#if parts.open.length}
			<button
				type="button"
				class="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
				aria-expanded={showDone}
				onclick={() => (showDone = !showDone)}
				>{showDone ? 'Hide' : 'Show'} the {parts.done.length} done</button
			>
		{/if}
		{#if showDone || !parts.open.length}
			<ul class="mt-2 divide-y divide-hair" aria-label="Done">
				{#each parts.done as c (c.id)}{@render row(c)}{/each}
			</ul>
		{/if}
	{/if}
</section>
