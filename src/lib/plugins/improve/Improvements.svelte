<script lang="ts">
	import { CalendarClock, Info } from '@lucide/svelte';
	import ProposalCard from './ProposalCard.svelte';
	import StartUi from './StartUi.svelte';
	import type { HarnessView } from './types';
	import { since } from './words';

	/**
	 * The Improvements page: every improve proposal for the Firstmate harness,
	 * waiting ones first, beside where the review schedule stands and what
	 * improve has read. Everything is shown here; a proposal's title also opens
	 * it in improve's own UI.
	 */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as HarnessView);
	const waiting = $derived(v.proposals.filter((p) => p.waiting));
	const rest = $derived(v.proposals.filter((p) => !p.waiting));
	const now = Date.now();
</script>

<p class="-mt-3 mb-8 max-w-prose text-sm text-muted-foreground">
	Changes improve proposes to Firstmate’s harness (its contract, skills and scripts, and your own
	home files) from what it has seen go wrong across tasks. Nothing changes until you approve it.
</p>

<div class="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
	<div class="min-w-0">
		{#if v.problems.length}
			<ul
				class="mb-6 flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm"
			>
				{#each v.problems as p, i (i)}
					<li class="flex gap-2"><Info class="mt-0.5 size-4 shrink-0 text-warning" />{p}</li>
				{/each}
			</ul>
		{/if}

		<h2 class="section-label mb-3">Waiting for your call · {waiting.length}</h2>
		{#if waiting.length}
			<div class="mb-8 flex flex-col gap-3">
				{#each waiting as p (p.file)}<ProposalCard {p} />{/each}
			</div>
		{:else}
			<p class="mb-8 text-sm text-muted-foreground">No proposal is waiting for you.</p>
		{/if}

		<h2 class="section-label mb-3">Everything else · {rest.length}</h2>
		{#if rest.length}
			<div class="flex flex-col gap-3">
				{#each rest as p (p.file)}<ProposalCard {p} />{/each}
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">
				{v.proposals.length
					? 'Nothing else.'
					: 'improve has not proposed anything yet. Run /improve propose in Firstmate’s session to draft a change.'}
			</p>
		{/if}
	</div>

	<aside class="flex min-w-0 flex-col gap-8">
		<section>
			<h2 class="section-label mb-2">Review</h2>
			<p class="flex gap-2 text-sm">
				<CalendarClock
					class="mt-0.5 size-4 shrink-0 {v.review.due ? 'text-sea' : 'text-muted-foreground'}"
					aria-hidden="true"
				/>{v.review.headline}
			</p>
			{#if v.review.reasons.length > 1}
				<ul class="mt-1 ml-6 list-disc text-xs text-muted-foreground">
					{#each v.review.reasons as r, i (i)}<li>{r}</li>{/each}
				</ul>
			{/if}
			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				{v.review.lastReviewedAt
					? `The last review was ${since(v.review.lastReviewedAt, now)}.`
					: 'No harness review has run yet.'}
				{v.review.periodic}
			</p>
		</section>

		<section>
			<h2 class="section-label mb-2">improve’s own UI</h2>
			<StartUi ui={v.ui} />
		</section>

		<section>
			<h2 class="section-label mb-2">What improve has read</h2>
			{#if v.evidence.summary}
				<p class="text-sm leading-relaxed">{v.evidence.summary}</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					improve’s import of this home could not be read.
				</p>
			{/if}
			{#if v.evidence.counts.length}
				<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
					{#each v.evidence.counts as c (c.label)}
						<dt class="text-muted-foreground">{c.label}</dt>
						<dd class="tabular text-right">{c.value}</dd>
					{/each}
				</dl>
			{/if}
			{#if v.inventory.length}
				<p class="mt-3 text-xs leading-relaxed text-muted-foreground">{v.inventory.join(' ')}</p>
			{/if}
		</section>

		{#if v.evidence.patterns.length}
			<section>
				<h2 class="section-label mb-2">Patterns it found</h2>
				<ul class="flex flex-col gap-2.5 text-sm leading-relaxed">
					{#each v.evidence.patterns as p, i (i)}
						<li>
							{p.sentence}
							{#if p.answers.length}
								<span class="mt-0.5 block text-xs text-muted-foreground"
									>Answered: {p.answers.join('; ')}</span
								>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</aside>
</div>
