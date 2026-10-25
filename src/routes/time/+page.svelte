<script lang="ts">
	import { dayLabel, duration, median, SEGMENTS, sumSplits, total } from '$lib/insights';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import TimeLegend from '$lib/components/wh/insights/TimeLegend.svelte';
	import type { TimeView } from '$lib/types';

	let { data } = $props();

	type Row = TimeView['tasks'][number];
	const RANGES = [
		{ key: 'today', label: 'Today' },
		{ key: 'week', label: 'Last 7 days' },
		{ key: 'month', label: 'Last 30 days' }
	] as const;
	let range = $state<'today' | 'week' | 'month'>('week');
	const now = Date.now();
	const since = (r: typeof range) => {
		if (r === 'today') return new Date(new Date(now).toDateString()).getTime();
		return now - (r === 'week' ? 7 : 30) * 86400_000;
	};

	const rows = $derived(data.view.tasks.filter((t) => Date.parse(t.startedAt) >= since(range)));
	const all = $derived(sumSplits(rows));
	const allTotal = $derived(total(all));
	const biggest = $derived(
		SEGMENTS.map((s) => ({ ...s, v: all[s.key] })).sort((a, b) => b.v - a.v)[0]
	);
	const pct = (v: number) => (allTotal ? Math.round((v / allTotal) * 100) : 0);
	const longest = $derived(Math.max(1, ...rows.map((r) => r.total)));
	const projects = $derived.by(() => {
		const g: Record<string, Row[]> = {};
		for (const r of rows) (g[r.projectId] ??= []).push(r);
		return Object.entries(g)
			.map(([name, list]) => {
				const ready = list.filter((r) => r.kind === 'ship' && r.readyAfter !== null);
				return {
					name,
					list,
					s: sumSplits(list),
					usual: ready.length ? median(ready.map((r) => r.readyAfter!)) : null
				};
			})
			.sort((a, b) => total(b.s) - total(a.s));
	});
</script>

<svelte:head><title>Where time went · Wheelhouse</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
	<InsightsNav />
	<div class="mt-6 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">Where time went</h1>
			<p class="mt-1 max-w-prose text-sm text-muted-foreground">
				How long each piece of work spent being built, in automated review and fixes, in CI, and
				waiting on you.
			</p>
		</div>
		<div class="flex rounded-lg border p-0.5 text-sm" role="radiogroup" aria-label="Range">
			{#each RANGES as r (r.key)}
				<button
					role="radio"
					aria-checked={range === r.key}
					onclick={() => (range = r.key)}
					class="rounded-md px-3 py-1 {range === r.key
						? 'bg-accent font-medium'
						: 'text-muted-foreground hover:text-foreground'}">{r.label}</button
				>
			{/each}
		</div>
	</div>

	{#if !data.view.available}
		<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			{data.view.reason}
		</p>
	{:else if rows.length === 0}
		<p class="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
			No work started in this range.
		</p>
	{:else}
		<section class="mt-8 rounded-xl border bg-card p-5">
			<p class="text-base">
				<span class="font-semibold">{duration(allTotal)}</span> across {rows.length}
				{rows.length === 1 ? 'task' : 'tasks'}.
				<span class="text-muted-foreground"
					>Most of it went to {biggest.label.toLowerCase()} ({pct(biggest.v)}%); you were the wait
					for {pct(all.captain)}%.</span
				>
			</p>
			<div class="mt-4"><TimeBar seconds={all} height="h-4" label="All work" /></div>
			<div class="mt-3"><TimeLegend seconds={all} /></div>
		</section>

		{#each projects as p (p.name)}
			<section class="mt-10">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-base font-semibold">{p.name}</h2>
					<p class="text-sm text-muted-foreground">
						{duration(total(p.s))} on {p.list.length}
						{p.list.length === 1
							? 'task'
							: 'tasks'}{#if p.usual !== null}{` · usually ${duration(p.usual)} from start to ready for you`}{/if}
					</p>
				</div>
				<div class="mt-3"><TimeBar seconds={p.s} label={p.name} /></div>
				<ul class="mt-4 divide-y rounded-lg border bg-card">
					{#each p.list as r (r.taskId)}
						<li>
							<a
								href="/tasks/{encodeURIComponent(r.taskId)}"
								class="grid gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-accent/40 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_4.5rem] sm:items-center"
							>
								<div class="min-w-0">
									<p class="truncate text-sm">{r.title}</p>
									<p class="text-xs text-muted-foreground">
										{dayLabel(r.startedAt, now)}{r.ongoing ? ' · still going' : ''}
									</p>
								</div>
								<TimeBar seconds={r.seconds} scale={longest} label={r.title} />
								<p class="text-sm tabular-nums sm:text-right">{duration(r.total)}</p>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		<p class="mt-10 text-xs leading-relaxed text-muted-foreground">
			Bars share one scale, so a longer bar took longer. Times come from the crew’s status updates
			and the automated review’s step logs.{#each data.view.notes as n (n)}{` ${n}`}{/each}
		</p>
	{/if}
</main>
