<script lang="ts">
	import { page } from '$app/state';
	import {
		ChevronDown,
		Clock,
		Hammer,
		MessageSquare,
		Scale,
		Shield,
		Split,
		ThumbsDown
	} from '@lucide/svelte';
	import { clock } from '$lib/format';
	import { byDay, duration } from '$lib/insights';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';
	import type { DecisionView, Verdict } from '$lib/types';

	let { data } = $props();

	const ICON = {
		'Fix it': Hammer,
		'Keep as is': Shield,
		Defer: Clock,
		Mixed: Split,
		Decided: Scale
	};
	const FILTERS = ['All', 'Fix it', 'Keep as is', 'Defer'] as const;
	let filter = $state<(typeof FILTERS)[number]>('All');

	const all = $derived(data.view.decisions);
	const matches = (d: DecisionView, f: Verdict | 'All') =>
		f === 'All' || d.verdict === f || d.calls.some((c) => c.verdict === f);
	const shown = $derived(all.filter((d) => matches(d, filter)));
	const groups = $derived(byDay(shown, (d) => d.decidedAt, Date.now()));
	const hash = $derived(page.url.hash.slice(1));

	const where = (step: string) =>
		step === 'test' ? 'automated tests' : step === 'ci' ? 'CI' : 'automated review';
	const short = (s: string) => (s.length > 90 ? s.slice(0, 87).trimEnd() + '…' : s);
	// Both actions open the Firstmate chat with the task mentioned; nothing is sent until you send it.
	const thread = (d: DecisionView, draft: string) =>
		`/?chat=${encodeURIComponent(d.taskId)}${draft ? `&draft=${encodeURIComponent(draft)}` : ''}`;
	const waitedFor = (d: DecisionView) => {
		const s = (Date.parse(d.decidedAt) - Date.parse(d.askedAt)) / 1000;
		return s < 60 ? 'within a minute' : `${duration(s)} later`;
	};
</script>

<svelte:head><title>Decided for you · Wheelhouse</title></svelte:head>

<main class="px-4 py-8 sm:px-6 lg:px-10">
	<InsightsNav />
	<h1 class="mt-6 text-2xl">Decided for you</h1>
	<p class="mt-1 max-w-prose text-sm text-muted-foreground">
		Questions the automated review raised that Firstmate answered on your behalf, so the work did
		not wait. If you would have called one differently, say so and Firstmate will look at it again.
	</p>

	{#if !data.view.available}
		<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			{data.view.reason}
		</p>
	{:else if all.length === 0}
		<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			Firstmate has not had to answer a review question for you yet.
		</p>
	{:else}
		<div class="mt-6 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Filter">
			{#each FILTERS as f (f)}
				<button
					role="radio"
					aria-checked={filter === f}
					onclick={() => (filter = f)}
					class="rounded-full border px-3 py-1 text-sm {filter === f
						? 'border-foreground/30 bg-accent font-medium'
						: 'text-muted-foreground hover:text-foreground'}">{f}</button
				>
			{/each}
			<span class="ml-auto text-xs text-muted-foreground">{shown.length} of {all.length}</span>
		</div>

		{#each groups as [label, items] (label)}
			<h2 class="mt-8 mb-3 text-xs font-medium text-muted-foreground">{label}</h2>
			<ol class="space-y-3">
				{#each items as d (d.id)}
					{@const Icon = ICON[d.verdict]}
					<li id={d.id} class="scroll-mt-20">
						<details class="group rounded-lg border bg-card open:shadow-sm" open={hash === d.id}>
							<summary
								class="flex cursor-pointer list-none gap-3 p-4 [&::-webkit-details-marker]:hidden"
							>
								<span
									class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground/70"
									aria-hidden="true"><Icon class="size-3.5" /></span
								>
								<div class="min-w-0 flex-1">
									<p class="flex flex-wrap items-baseline gap-x-2 text-sm">
										<span class="font-medium whitespace-nowrap">{d.verdict}</span>
										<span class="text-muted-foreground">·</span>
										<span class="min-w-0 truncate">{d.taskTitle}</span>
										{#if d.projectId}<span
												class="rounded border px-1.5 text-xs text-muted-foreground"
												>{d.projectId}</span
											>{/if}
									</p>
									<p class="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
										{d.calls[0].question}{#if d.calls.length > 1}<span class="text-muted-foreground"
												>{` and ${d.calls.length - 1} more`}</span
											>{/if}
									</p>
								</div>
								<div class="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
									<span class="tabular-nums">{clock(d.decidedAt)}</span>
									<span class={d.landed ? '' : 'text-sea'}
										>{d.landed ? 'Landed' : 'Not landed'}</span
									>
								</div>
								<ChevronDown
									class="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
									aria-hidden="true"
								/>
							</summary>

							<div class="border-t px-4 pt-3 pb-4 sm:pl-14">
								<ol class="space-y-5">
									{#each d.calls as c, i (i)}
										<li>
											<p class="text-xs text-muted-foreground">
												Raised in {where(d.step)}{c.serious ? ' · marked serious' : ''}
											</p>
											<p class="mt-1 text-sm leading-relaxed font-medium">{c.question}</p>
											<div class="mt-2.5 border-l-2 border-sea/60 pl-3">
												<p class="text-xs text-muted-foreground">
													Firstmate decided: <span class="font-medium text-foreground"
														>{c.verdict}</span
													>
												</p>
												<p class="mt-1 text-sm leading-relaxed whitespace-pre-line">
													{c.reason || 'No reason was recorded.'}<span class="text-muted-foreground"
														>{d.answerCut ? ' (the rest of the answer was not kept)' : ''}</span
													>
												</p>
											</div>
											{#if c.detail && c.detail !== c.question}
												<details class="mt-2 text-xs text-muted-foreground">
													<summary class="cursor-pointer hover:text-foreground"
														>The reviewer’s full note</summary
													>
													<p class="mt-1.5 leading-relaxed">{c.detail}</p>
													{#if c.file}<p class="mt-1 font-mono text-xs">{c.file}</p>{/if}
												</details>
											{/if}
											<div class="mt-2 flex flex-wrap gap-2">
												<a
													href={thread(
														d,
														`I'd decide differently on "${short(c.question)}" (Firstmate's call: ${c.verdict}). `
													)}
													class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
													><ThumbsDown class="size-3.5" aria-hidden="true" />I'd decide differently</a
												>
												<a
													href={thread(d, '')}
													class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
													><MessageSquare class="size-3.5" aria-hidden="true" />Chat about this</a
												>
											</div>
										</li>
									{/each}
								</ol>
								<p class="mt-4 text-xs text-muted-foreground">
									Asked {clock(d.askedAt)}, decided {waitedFor(d)}.
									{d.landed
										? 'This has landed, so a different call would be a follow-up change.'
										: 'The work has not landed, so a different call can still go into it.'}
								</p>
							</div>
						</details>
					</li>
				{/each}
			</ol>
		{/each}
	{/if}
</main>
