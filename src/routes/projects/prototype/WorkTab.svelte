<!-- PROTOTYPE: a project's Work tab: what needs you, what is moving, what landed, and a
     narrow side column for its pulse, how it ships and its plugins' cards. -->
<script lang="ts">
	import {
		ago,
		heldUp,
		landedThisWeek,
		moving,
		queued,
		sum,
		waited,
		yourMove,
		type FakeProject
	} from './prototype-data';
	import Pulse from './Pulse.svelte';
	import Stage from './Stage.svelte';
	import { ArrowRight, Check } from '@lucide/svelte';

	let { project: p, aside = true }: { project: FakeProject; aside?: boolean } = $props();

	const moves = $derived(yourMove(p));
	const held = $derived(heldUp(p));
	const going = $derived(moving(p));
	const next = $derived(queued(p));
	const landed = $derived(p.tasks.filter((t) => t.state === 'landed'));
	const WHO: Record<string, string> = {
		'with-firstmate': 'Waiting on Firstmate',
		'with-reviewers': 'Waiting on reviewers'
	};
</script>

<div class="grid gap-6 {aside ? 'xl:grid-cols-[minmax(0,1fr)_21rem]' : ''}">
	<div class="min-w-0 space-y-6">
		{#if moves.length}
			<section class="surface p-5" aria-labelledby="w-move">
				<h2 id="w-move" class="section-label mb-4 text-sea">Your move</h2>
				<ul class="space-y-3">
					{#each moves as t (t.id)}
						<li
							class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-l-4 border-sea/40 border-l-sea bg-sea/5 px-4 py-3"
						>
							<div class="min-w-0 flex-1">
								<p class="font-medium">{t.title}</p>
								<p class="text-sm text-muted-foreground">{t.now}</p>
							</div>
							<span class="text-xs text-muted-foreground">waiting {waited(t.since)}</span>
							<a
								href="#top"
								class="inline-flex items-center gap-1.5 rounded-md bg-sea px-3 py-1.5 text-sm font-medium text-white dark:text-slate-950"
								>{t.state === 'needs-review' ? 'Review' : 'Answer'}<ArrowRight
									class="size-4"
									aria-hidden="true"
								/></a
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="surface p-5" aria-labelledby="w-under">
			<h2 id="w-under" class="section-label mb-2">Under way</h2>
			{#if held.length || going.length}
				<ul class="divide-y divide-hair">
					{#each [...held, ...going] as t (t.id)}
						<li class="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
							<div class="min-w-0">
								<a href="#top" class="font-medium hover:underline">{t.title}</a>
								<p class="text-sm {held.includes(t) ? 'text-danger' : 'text-muted-foreground'}">
									{WHO[t.state] ? `${WHO[t.state]}. ` : ''}{t.now}
								</p>
							</div>
							<div class="flex items-center gap-4 sm:justify-end">
								<Stage task={t} />
								<span class="w-20 text-right text-xs text-muted-foreground">{ago(t.since)}</span>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted-foreground">Nothing under way right now.</p>
			{/if}
			{#if next.length}
				<p class="mt-3 border-t border-hair pt-3 text-sm text-muted-foreground">
					Queued next: {next.map((t) => t.title).join(', ')}.
				</p>
			{/if}
		</section>

		<section class="surface p-5" aria-labelledby="w-landed">
			<h2 id="w-landed" class="section-label mb-2">Landed</h2>
			{#if landed.length}
				<ul class="divide-y divide-hair">
					{#each landed as t (t.id)}
						<li class="flex items-center gap-3 py-2.5">
							<Check class="size-4 shrink-0 text-success" aria-hidden="true" />
							<a href="#top" class="min-w-0 flex-1 hover:underline">{t.title}</a>
							<span class="text-xs text-muted-foreground">{ago(t.since)}</span>
						</li>
					{/each}
				</ul>
				<a
					href="#top"
					class="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline"
					>Everything that landed</a
				>
			{:else}
				<p class="text-sm text-muted-foreground">Nothing has landed yet.</p>
			{/if}
		</section>
	</div>

	{#if aside}
		<aside class="space-y-6">
			<section class="surface p-5" aria-labelledby="w-pulse">
				<h2 id="w-pulse" class="section-label mb-3">Two weeks</h2>
				<Pulse commits={p.commits} landed={p.pulse} width={280} height={56} />
				<p class="mt-2 text-sm text-muted-foreground">
					{sum(p.commits)} commits, {sum(p.pulse)} landed. {landedThisWeek(p).length} landed this week.
				</p>
			</section>
			<section class="surface p-5" aria-labelledby="w-ships">
				<h2 id="w-ships" class="section-label mb-2">How it ships</h2>
				<p class="text-sm">{p.ships}</p>
				{#if p.passageProblem}
					<p class="mt-2 text-sm text-danger">{p.passageProblem}</p>
				{/if}
				<p class="mt-2 text-sm text-muted-foreground">
					Main branch: {p.main === 'green'
						? 'checks green'
						: p.main === 'red'
							? 'checks failing'
							: 'no checks yet'}.
				</p>
			</section>
			{#if p.tabs.includes('Issues')}
				<section class="surface p-5" aria-labelledby="w-issues">
					<h2 id="w-issues" class="section-label mb-2">GitHub issues</h2>
					<p class="text-sm">3 watched issues, 1 new since yesterday. Firstmate has 2 in hand.</p>
				</section>
			{/if}
		</aside>
	{/if}
</div>
