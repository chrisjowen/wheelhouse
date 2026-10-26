<script lang="ts">
	import { ArrowRight, CalendarClock, Hand, Info } from '@lucide/svelte';
	import type { HarnessView } from './types';
	import { since } from './words';

	/**
	 * Harness health, on the home page's rail: whether a harness review is due
	 * and why, the proposals waiting, when the last review ran, what improve has
	 * read and the patterns that repeat most. It opens the Improvements page.
	 */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as HarnessView);
	const now = Date.now();
</script>

<div class="rounded-lg border bg-card px-3 py-2.5 text-xs leading-snug">
	<p class="flex gap-1.5 text-sm">
		<CalendarClock
			class="mt-0.5 size-3.5 shrink-0 {v.review.due ? 'text-sea' : 'text-muted-foreground'}"
			aria-hidden="true"
		/><span>{v.review.headline}</span>
	</p>
	<p class="mt-1.5 flex gap-1.5">
		<Hand class="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
		{#if v.waiting}
			<a href="/plugins/improve/improvements" class="font-medium text-sea hover:underline"
				>{v.waiting} {v.waiting === 1 ? 'proposal waits' : 'proposals wait'} for your call</a
			>
		{:else}
			<span class="text-muted-foreground">No proposal waits for you.</span>
		{/if}
	</p>
	<p class="mt-1.5 text-muted-foreground">
		{v.review.lastReviewedAt
			? `Last review ${since(v.review.lastReviewedAt, now)}.`
			: 'No harness review yet.'}
		{v.evidence.summary ?? ''}
	</p>
	{#if v.evidence.patterns.length}
		<ul class="mt-2 flex flex-col gap-1 border-t border-hair pt-2 text-muted-foreground">
			{#each v.evidence.patterns.slice(0, 2) as p, i (i)}
				<li class="line-clamp-2">{p.sentence}</li>
			{/each}
		</ul>
	{/if}
	{#if v.problems.length}
		<p class="mt-2 flex gap-1.5 text-warning">
			<Info class="mt-px size-3.5 shrink-0" aria-hidden="true" /><span class="line-clamp-2"
				>{v.problems[0]}</span
			>
		</p>
	{/if}
	<a
		href="/plugins/improve/improvements"
		class="mt-2 flex items-center gap-1 text-muted-foreground hover:text-foreground"
		>See the improvements<ArrowRight class="size-3.5" /></a
	>
</div>
