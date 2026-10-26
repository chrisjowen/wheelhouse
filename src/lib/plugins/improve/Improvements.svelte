<script lang="ts">
	import {
		ArrowUpRight,
		ChevronDown,
		GitPullRequest,
		Hand,
		Info,
		Lock,
		MessageSquareText
	} from '@lucide/svelte';
	import EvidenceBar from './EvidenceBar.svelte';
	import ProposalCard from './ProposalCard.svelte';
	import ReviewBadge from './ReviewBadge.svelte';
	import StartUi from './StartUi.svelte';
	import type { HarnessView } from './types';
	import { chipText } from './visual';
	import { GROUPS, since } from './words';

	/**
	 * The Improvements page, visual first: three tiles (the review, what waits
	 * for you, what improve read), then the proposals as cards grouped by where
	 * they stand, beside the patterns that repeat and the harness's size. Detail
	 * opens on a card's Details, or in improve's own UI from its title.
	 */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as HarnessView);
	const now = Date.now();
	const groups = $derived(
		GROUPS.map((g) => ({ ...g, items: v.proposals.filter((p) => p.group === g.id) })).filter(
			(g) => g.items.length
		)
	);
	const waiting = $derived(v.proposals.filter((p) => p.waiting));
	const privateWaiting = $derived(waiting.filter((p) => p.visibility === 'captain-private').length);
	const sharedWaiting = $derived(waiting.filter((p) => p.visibility === 'shared-tracked').length);
	const tasksRead = $derived(v.evidence.counts.find((c) => c.label === 'Tasks')?.value ?? null);
	let showStart = $state(false);
</script>

<p class="-mt-3 mb-6 max-w-prose text-sm text-muted-foreground">
	Changes improve proposes to Firstmate’s harness from what it has seen go wrong. Nothing changes
	until you approve.
</p>

<div class="grid gap-3 sm:grid-cols-3">
	<section class="rounded-lg border bg-card p-4" aria-label="Review">
		<h2 class="section-label text-[1rem]">Review</h2>
		<div class="mt-3"><ReviewBadge review={v.review} /></div>
		<p class="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
			{v.review.due ? (v.review.reasons[0] ?? v.review.headline) : v.review.headline}
		</p>
		<p class="mt-1 text-xs text-muted-foreground">
			{v.review.lastReviewedAt
				? `Last review ${since(v.review.lastReviewedAt, now)}`
				: 'No review yet'}
		</p>
	</section>

	<section class="rounded-lg border bg-card p-4" aria-label="Waiting for you">
		<h2 class="section-label text-[1rem]">Waiting for you</h2>
		<p class="mt-2 flex items-baseline gap-2">
			<span class="tabular font-display text-4xl leading-none font-medium">{v.waiting}</span>
			<span class="text-sm text-muted-foreground">{v.waiting === 1 ? 'proposal' : 'proposals'}</span
			>
		</p>
		{#if v.waiting}
			<p class="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
				<span class="flex items-center gap-1"
					><Lock class="size-3.5" aria-hidden="true" /><span
						class="tabular font-medium text-foreground">{privateWaiting}</span
					> private</span
				>
				<span class="flex items-center gap-1"
					><GitPullRequest class="size-3.5 text-sea" aria-hidden="true" /><span
						class="tabular font-medium text-foreground">{sharedWaiting}</span
					> shared</span
				>
			</p>
		{/if}
	</section>

	<section class="rounded-lg border bg-card p-4" aria-label="What improve read">
		<h2 class="section-label text-[1rem]">What improve read</h2>
		{#if tasksRead !== null}
			<p class="mt-2 flex items-baseline gap-2">
				<span class="tabular font-display text-4xl leading-none font-medium">{tasksRead}</span>
				<span class="text-sm text-muted-foreground">{tasksRead === 1 ? 'task' : 'tasks'}</span>
			</p>
			<div class="mt-3"><EvidenceBar mix={v.evidence.mix} compact /></div>
		{:else}
			<p class="mt-2 text-sm text-muted-foreground">improve’s import could not be read.</p>
		{/if}
	</section>
</div>

<div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
	{#if v.ui.running}
		<a
			href={v.ui.url}
			target="_blank"
			rel="noreferrer"
			class="flex items-center gap-1 rounded-full border border-sea/40 px-2.5 py-1 font-medium text-sea hover:bg-sea/10"
			>improve’s review UI is open<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
		>
		<span class="text-muted-foreground">A card’s title opens it there.</span>
	{:else}
		<button
			class="flex cursor-pointer items-center gap-1 rounded-full border border-hair px-2.5 py-1 text-muted-foreground hover:text-foreground"
			aria-expanded={showStart}
			onclick={() => (showStart = !showStart)}
			>improve’s review UI is not running<ChevronDown
				class="size-3.5 transition-transform duration-200 {showStart ? 'rotate-180' : ''}"
				aria-hidden="true"
			/></button
		>
	{/if}
</div>
{#if showStart && !v.ui.running}
	<div class="mt-2 max-w-3xl"><StartUi ui={v.ui} /></div>
{/if}

{#if v.problems.length}
	<ul
		class="mt-4 flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm"
	>
		{#each v.problems as p, i (i)}
			<li class="flex gap-2"><Info class="mt-0.5 size-4 shrink-0 text-warning" />{p}</li>
		{/each}
	</ul>
{/if}

<div class="mt-8 grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
	<div class="flex min-w-0 flex-col gap-8">
		{#each groups as g (g.id)}
			<section aria-label={g.label}>
				<h2 class="section-label mb-3">
					{g.label}<span
						class="tabular rounded-full border border-hair px-2 text-sm leading-5 tracking-normal [font-variant-caps:normal]"
						>{g.items.length}</span
					>
				</h2>
				<div class="grid gap-3 md:grid-cols-2">
					{#each g.items as p (p.file)}<ProposalCard {p} />{/each}
				</div>
			</section>
		{:else}
			<p class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				improve has not proposed anything yet. Run /improve propose in Firstmate’s session to draft
				a change.
			</p>
		{/each}
	</div>

	<aside class="flex min-w-0 flex-col gap-8">
		{#if v.evidence.patterns.length}
			<section>
				<h2 class="section-label mb-3">Repeated patterns</h2>
				<ul class="flex flex-col gap-2">
					{#each v.evidence.patterns as p, i (i)}
						{@const Icon = p.kind === 'review' ? MessageSquareText : Hand}
						<li>
							<details class="group rounded-lg border bg-card">
								<summary
									class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden"
									title={p.sentence}
								>
									<Icon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span class="min-w-0 flex-1 truncate">{chipText(p.example, 80)}</span>
									<span
										class="tabular shrink-0 rounded-full bg-sea/10 px-1.5 text-xs font-semibold text-sea"
										aria-label="{p.count} times">×{p.count}</span
									>
								</summary>
								<div class="border-t border-hair px-3 py-2 text-xs leading-relaxed">
									<p>{p.sentence}</p>
									{#if p.answers.length}
										<p class="mt-1 text-muted-foreground">Answered: {p.answers.join('; ')}</p>
									{/if}
								</div>
							</details>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if v.size}
			<section>
				<h2 class="section-label mb-3">Harness size</h2>
				<div class="rounded-lg border bg-card p-3 text-xs">
					<p class="flex items-baseline justify-between gap-2">
						<span class="font-medium">{v.size.contractFile}</span>
						<span class="tabular text-muted-foreground"
							>{v.size.contractTokens.toLocaleString('en')} tokens</span
						>
					</p>
					{#if v.size.budgetShare !== null}
						<div
							class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
							role="img"
							aria-label="{Math.round(v.size.budgetShare * 100)}% of the startup budget"
						>
							<span
								class="block h-full rounded-full {v.size.budgetShare > 0.8
									? 'bg-warning'
									: 'bg-sea'}"
								style="width: {Math.min(100, v.size.budgetShare * 100)}%"
							></span>
						</div>
						<p class="mt-1 text-muted-foreground">
							{Math.round(v.size.budgetShare * 100)}% of the startup budget
						</p>
					{/if}
					{#if v.size.skills !== null}
						<p class="mt-2 text-muted-foreground">
							<span class="tabular font-medium text-foreground">{v.size.skills}</span>
							{v.size.skills === 1 ? 'skill' : 'skills'}{v.size.largestSkill
								? `, the largest ${v.size.largestSkill}`
								: ''}
						</p>
					{/if}
				</div>
			</section>
		{/if}
	</aside>
</div>
