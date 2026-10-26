<script lang="ts">
	import { ArrowRight, GitPullRequest, Hand, Info, Lock, MessageSquareText } from '@lucide/svelte';
	import EvidenceBar from './EvidenceBar.svelte';
	import ReviewBadge from './ReviewBadge.svelte';
	import type { HarnessView } from './types';
	import { chipText } from './visual';
	import { since } from './words';

	/**
	 * Harness health, on the home page's rail, at a glance: the review as a
	 * badge, the number of proposals waiting (private and shared), what improve
	 * read as one bar, and the patterns that repeat most as chips. Everything
	 * else is on the Improvements page.
	 */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as HarnessView);
	const now = Date.now();
	const waiting = $derived(v.proposals.filter((p) => p.waiting));
	const priv = $derived(waiting.filter((p) => p.visibility === 'captain-private').length);
	const shared = $derived(waiting.filter((p) => p.visibility === 'shared-tracked').length);
</script>

<div class="rounded-lg border bg-card p-3">
	<div class="flex items-center justify-between gap-2">
		<ReviewBadge review={v.review} />
		<span class="text-xs text-muted-foreground"
			>{v.review.lastReviewedAt
				? `Last ${since(v.review.lastReviewedAt, now)}`
				: 'No review yet'}</span
		>
	</div>

	<a
		href="/plugins/improve/improvements"
		class="-mx-1 mt-3 flex items-end gap-3 rounded-md px-1 py-1 hover:bg-muted/60"
	>
		<span class="tabular font-display text-[2.4rem] leading-none font-medium">{v.waiting}</span>
		<span class="pb-0.5 text-sm leading-tight"
			>{v.waiting === 1 ? 'proposal waits' : 'proposals wait'}<br /><span
				class="text-muted-foreground">for your call</span
			></span
		>
		{#if v.waiting}
			<span class="ml-auto flex flex-col items-end gap-0.5 pb-0.5 text-xs text-muted-foreground">
				<span class="flex items-center gap-1"
					><Lock class="size-3" aria-hidden="true" />{priv} private</span
				>
				<span class="flex items-center gap-1"
					><GitPullRequest class="size-3 text-sea" aria-hidden="true" />{shared} shared</span
				>
			</span>
		{/if}
	</a>

	{#if v.evidence.mix.length}
		<div class="mt-3"><EvidenceBar mix={v.evidence.mix} compact /></div>
	{/if}

	{#if v.evidence.patterns.length}
		<ul class="mt-3 flex flex-col gap-1.5">
			{#each v.evidence.patterns.slice(0, 3) as p, i (i)}
				{@const Icon = p.kind === 'review' ? MessageSquareText : Hand}
				<li
					class="flex items-center gap-1.5 rounded-full border border-hair px-2 py-0.5 text-xs"
					title={p.sentence}
				>
					<Icon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="min-w-0 flex-1 truncate">{chipText(p.example, 64)}</span>
					<span class="tabular shrink-0 font-semibold text-sea" aria-label="{p.count} times"
						>×{p.count}</span
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if v.problems.length}
		<p class="mt-2 flex gap-1.5 text-xs text-warning">
			<Info class="mt-px size-3.5 shrink-0" aria-hidden="true" /><span class="line-clamp-2"
				>{v.problems[0]}</span
			>
		</p>
	{/if}
	<a
		href="/plugins/improve/improvements"
		class="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
		>Open Improvements<ArrowRight class="size-3.5" aria-hidden="true" /></a
	>
</div>
