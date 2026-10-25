<script lang="ts">
	import { Info, MessageSquare, TriangleAlert } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import { minutes } from '$lib/insights';
	import AllowanceMeter from '$lib/components/wh/insights/AllowanceMeter.svelte';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';

	let { data } = $props();
	const now = Date.now();
	const v = $derived(data.view);
	const a = $derived(v.allowance);

	let span = $state<'fiveHour' | 'week'>('fiveHour');
	const shares = $derived(
		v.usage.available
			? v.usage.value.shares.filter((s) => s[span] > 0).sort((x, y) => y[span] - x[span])
			: []
	);
	const sum = $derived(shares.reduce((t, s) => t + s[span], 0));
	const pct = (x: number) => (sum ? (x / sum) * 100 : 0);
	const hourly = $derived(v.usage.available ? v.usage.value.hourly : []);
	const peak = $derived(Math.max(1, ...hourly));
	const risk = $derived(v.atRisk);
	const busiest = $derived(
		v.usage.available ? [...v.usage.value.shares].sort((x, y) => y.fiveHour - x.fiveHour)[0] : null
	);
	const short = $derived(
		risk?.runsOutAt && risk.resetsAt
			? Math.max(1, Math.round((Date.parse(risk.resetsAt) - Date.parse(risk.runsOutAt)) / 60000))
			: null
	);
	const holdDraft = $derived(
		risk?.resetsAt
			? `Hold new work until the Claude allowance resets at ${clock(risk.resetsAt)}; let what is under way finish.`
			: ''
	);
</script>

<svelte:head><title>Headroom · Wheelhouse</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
	<InsightsNav />
	<h1 class="mt-6 text-xl font-semibold tracking-tight">Headroom</h1>
	<p class="mt-1 max-w-prose text-sm text-muted-foreground">
		How much of your Claude allowance is left, when it resets, and who is using it.
	</p>

	{#if a.state === 'connect'}
		<section class="mt-6 flex gap-3 rounded-xl border bg-card p-4">
			<Info class="mt-0.5 size-5 shrink-0 text-sea" aria-hidden="true" />
			<div class="min-w-0 text-sm">
				<p class="font-medium">Connect your Claude usage</p>
				<p class="mt-1 text-muted-foreground">
					To show how much of your allowance is left, quota-axi needs a one-time approval to read
					Claude’s sign-in from your Keychain. Run this once in a terminal and choose “Always
					Allow”:
				</p>
				<code class="mt-2 inline-block rounded-md bg-muted px-2 py-1 font-mono text-xs"
					>{a.command}</code
				>
				<p class="mt-2 text-xs text-muted-foreground">
					Wheelhouse never asks for that approval itself. Who is using Claude, below, works without
					it.
				</p>
			</div>
		</section>
	{:else if a.state === 'unavailable'}
		<p class="mt-6 flex gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
			<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{a.reason}
		</p>
	{:else}
		{#if risk && short}
			<section
				class="mt-6 flex gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4"
				aria-live="polite"
			>
				<TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
				<div class="min-w-0">
					<p class="text-sm font-medium">
						{risk.label} may run out around {clock(risk.runsOutAt)}, {minutes(short)} before it resets
					</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{#if busiest}{busiest.label} is the busiest right now.{/if} Work stops if the allowance runs
						out, and picks up again when it resets at {clock(risk.resetsAt)}.
					</p>
					<a
						href="/?draft={encodeURIComponent(holdDraft)}"
						class="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
						><MessageSquare class="size-3.5" aria-hidden="true" />Ask Firstmate to hold new work</a
					>
				</div>
			</section>
		{/if}
		<section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each a.windows as w (w.id)}
				<div class="rounded-xl border bg-card p-4"><AllowanceMeter {w} {now} /></div>
			{/each}
		</section>
		<p class="mt-2 text-xs text-muted-foreground">Read at {clock(a.readAt)} from quota-axi.</p>
	{/if}

	<section class="mt-10">
		<div class="flex flex-wrap items-baseline justify-between gap-3">
			<h2 class="text-base font-semibold">Who is using it</h2>
			<div class="flex rounded-lg border p-0.5 text-sm" role="radiogroup" aria-label="Span">
				{#each [['fiveHour', 'Last 5 hours'], ['week', 'Last 7 days']] as const as [k, label] (k)}
					<button
						role="radio"
						aria-checked={span === k}
						onclick={() => (span = k)}
						class="rounded-md px-3 py-1 {span === k
							? 'bg-accent font-medium'
							: 'text-muted-foreground hover:text-foreground'}">{label}</button
					>
				{/each}
			</div>
		</div>
		{#if !v.usage.available}
			<p class="mt-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{v.usage.reason}
			</p>
		{:else if shares.length === 0}
			<p class="mt-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				No Claude use in this span.
			</p>
		{:else}
			<p class="mt-1 text-xs text-muted-foreground">
				Shares of Claude use on this machine, from each session’s token counts, weighted by rough
				cost (writing counts more than re-reading).
			</p>
			<ul class="mt-4 divide-y rounded-lg border bg-card">
				{#each shares as s (s.key)}
					<li
						class="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3.5rem] sm:items-center"
					>
						<div class="min-w-0">
							{#if s.taskId}<a
									href="/tasks/{encodeURIComponent(s.taskId)}"
									class="block truncate text-sm hover:underline">{s.label}</a
								>{:else}<p class="truncate text-sm">{s.label}</p>{/if}
							<p class="truncate text-xs text-muted-foreground">
								{s.sub}{#if s.reviewShare > 0.05}{` · ${Math.round(s.reviewShare * 100)}% of it automated review`}{/if}
							</p>
						</div>
						<div class="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
							<div
								class="h-full rounded-full {s.taskId ? 'bg-sea' : 'bg-foreground/40'}"
								style="width: {pct(s[span])}%"
							></div>
						</div>
						<p class="text-sm tabular-nums sm:text-right">{Math.round(pct(s[span]))}%</p>
					</li>
				{/each}
			</ul>

			<h2 class="mt-10 text-base font-semibold">The last 24 hours</h2>
			<p class="mt-1 text-xs text-muted-foreground">Claude use per hour, everyone together.</p>
			<div
				class="mt-4 flex h-24 items-end gap-1"
				role="img"
				aria-label="Claude use per hour over the last 24 hours"
			>
				{#each hourly as x, i (i)}
					<div
						class="flex-1 rounded-t-sm {i === hourly.length - 1 ? 'bg-sea' : 'bg-sea/40'}"
						style="height: {Math.max(2, (x / peak) * 100)}%"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
				<span>{clock(new Date(now - 23 * 3600_000).toISOString())}</span>
				<span>{clock(new Date(now - 12 * 3600_000).toISOString())}</span><span>now</span>
			</div>
		{/if}
	</section>
</main>
