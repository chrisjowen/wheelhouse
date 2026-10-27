<script lang="ts">
	import type { ChangeRequest, TaskRun } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { ago, clock } from '$lib/format';
	import { changesLine, changeWhere, SOURCE_LABEL, splitChanges, STATE_LABEL } from '$lib/changes';
	import { CircleCheck, Circle, ExternalLink } from '@lucide/svelte';

	/**
	 * The changes that started a run, as a checklist: what is still to do,
	 * then what was resolved on GitHub or addressed by a newer ready report.
	 * Each run keeps its own list, so earlier runs' requests stay visible.
	 */
	let { run }: { run: TaskRun } = $props();

	const active = $derived(run.outcome === 'building');
	const parts = $derived(splitChanges(run.changes));
	const line = $derived(changesLine(run.changes));
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
	class="rounded-xl border p-4 {active ? 'border-brass/60 bg-panel' : 'border-hair'}"
	aria-labelledby="changes-heading-{run.n}"
	data-changes={active ? 'active' : 'history'}
>
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
		<h2 id="changes-heading-{run.n}" class="text-base font-medium">
			Run {run.n} started with these changes
		</h2>
		{#if line}<p class="tabular text-xs text-muted-foreground">{line}</p>{/if}
	</div>
	{#if run.basis}
		<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
			{run.basis}{#if active}{` It is the worker’s turn${run.startedAt ? ` (since ${ago(run.startedAt, live.now)})` : ''}; it comes back to your review when the worker reports the pull request ready again.`}{/if}
		</p>
	{/if}
	{#if !run.changes.length}
		<p class="mt-2 text-sm text-muted-foreground">
			No written requests: nothing was asked on GitHub or from Wheelhouse for this run.
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
