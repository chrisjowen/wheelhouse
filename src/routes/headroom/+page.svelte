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

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<!-- The page reads on one solid sheet; the graph paper shows only in the gutter. -->
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<InsightsNav />
		<h1 class="mt-6 text-2xl">Headroom</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Provider quotas, remaining balances, reset times and availability, alongside Claude account
			use.
		</p>

		<section class="mt-6" aria-labelledby="provider-headroom-title">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="provider-headroom-title" class="text-base font-semibold">Providers</h2>
				<p class="text-xs text-muted-foreground">
					Read from quota-axi and Firstmate’s local provider status.
				</p>
			</div>
			{#if v.providers.length === 0}
				<p class="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
					Provider quotas are not available yet.
				</p>
			{:else}
				<ul class="mt-3 grid gap-3 sm:grid-cols-2">
					{#each v.providers as p (p.provider)}
						{@const lowCredits =
							!p.notSetUp &&
							((p.credits?.unit === 'usd' &&
								p.credits.remaining !== null &&
								p.credits.remaining <= 1) ||
								p.windows.some((w) => w.percentRemaining !== null && w.percentRemaining <= 5))}
						{@const activeOut = p.outUntil !== null && Date.parse(p.outUntil) > now}
						{@const capReached =
							p.spendTodayUsd !== null && p.capUsd !== null && p.spendTodayUsd >= p.capUsd}
						{@const spendWarning =
							p.provider === 'claude-api' && p.spendTodayUsd !== null && p.spendTodayUsd >= 75}
						{@const stateLabel =
							activeOut || capReached
								? 'Out'
								: spendWarning
									? 'Spend warning'
									: p.notSetUp
										? 'Not configured'
										: p.state === 'auth_required'
											? 'Sign-in needed'
											: p.state === 'unavailable'
												? 'Unavailable'
												: lowCredits
													? 'Low credits'
													: p.stale
														? 'Stale data'
														: p.state === 'fresh'
															? 'Available'
															: (p.state ?? 'Status unknown')}
						<li class="rounded-xl border bg-card p-4">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<h3 class="font-medium">{p.label}</h3>
									<p class="mt-0.5 text-xs text-muted-foreground">{p.provider}</p>
								</div>
								<span
									class="shrink-0 rounded-full border px-2 py-0.5 text-xs {activeOut ||
									capReached ||
									spendWarning
										? 'border-warning/50 bg-warning/10 text-warning'
										: lowCredits || p.state === 'auth_required' || p.state === 'unavailable'
											? 'border-warning/40 bg-warning/5 text-warning'
											: 'text-muted-foreground'}">{stateLabel}</span
								>
							</div>
							<dl class="mt-3 space-y-2 text-sm">
								{#if p.credits && (p.credits.remaining !== null || p.credits.unlimited)}
									<div class="flex justify-between gap-3">
										<dt class="text-muted-foreground">Credits remaining</dt>
										<dd class="text-right tabular-nums">
											{#if p.credits.unlimited}Unlimited{:else if p.credits.unit === 'usd' && p.credits.remaining !== null}
												{new Intl.NumberFormat(undefined, {
													style: 'currency',
													currency: 'USD',
													minimumFractionDigits: 2
												}).format(p.credits.remaining)}
											{:else}{p.credits.remaining ?? '—'}{#if p.credits.unit}
													{p.credits.unit}{/if}{/if}
										</dd>
									</div>
								{/if}
								{#each p.windows as w (`${p.provider}:${w.id}`)}
									<div class="flex justify-between gap-3">
										<dt class="text-muted-foreground">{w.label ?? w.id} remaining</dt>
										<dd class="text-right tabular-nums">
											{#if w.spentUsd !== null && w.limitUsd !== null}
												{new Intl.NumberFormat(undefined, {
													style: 'currency',
													currency: 'USD',
													minimumFractionDigits: 2
												}).format(Math.max(0, w.limitUsd - w.spentUsd))} of {new Intl.NumberFormat(
													undefined,
													{ style: 'currency', currency: 'USD', minimumFractionDigits: 2 }
												).format(w.limitUsd)}
												{#if w.percentRemaining !== null}
													· {Math.round(w.percentRemaining)}%{/if}
											{:else if w.percentRemaining !== null}{Math.round(w.percentRemaining)}%{/if}
										</dd>
									</div>
									{#if w.resetsAt || w.resetText}
										<div class="flex justify-between gap-3 text-xs">
											<dt class="text-muted-foreground">Resets</dt>
											<dd>{w.resetsAt ? clock(w.resetsAt) || w.resetsAt : w.resetText}</dd>
										</div>
									{/if}
								{/each}
								<div class="flex justify-between gap-3">
									<dt class="text-muted-foreground">Provider out state</dt>
									<dd class="text-right">
										{#if activeOut}Out until {clock(p.outUntil) || p.outUntil}{:else if p.outUntil}
											Not out · reset {clock(p.outUntil) || p.outUntil}
										{:else}Not marked out{/if}
									</dd>
								</div>
								{#if p.spendTodayUsd !== null}
									<div class="flex justify-between gap-3">
										<dt class="text-muted-foreground">Spend today</dt>
										<dd class="text-right tabular-nums">
											{new Intl.NumberFormat(undefined, {
												style: 'currency',
												currency: 'USD',
												minimumFractionDigits: 2
											}).format(p.spendTodayUsd)}{#if p.capUsd !== null}
												/ {new Intl.NumberFormat(undefined, {
													style: 'currency',
													currency: 'USD',
													minimumFractionDigits: 2
												}).format(p.capUsd)}{:else}
												today{/if}
										</dd>
									</div>
									{#if p.provider === 'claude-api' && p.spendTodayUsd >= 75}
										<p class="text-xs text-warning">
											{#if capReached}Daily cap reached; this provider should not be used until
												reset.{:else}Warning: Claude API spend has reached $75 today.{/if}
										</p>
									{/if}
								{:else if p.provider === 'claude-api' && p.capUsd !== null}
									<div class="flex justify-between gap-3">
										<dt class="text-muted-foreground">Spend estimate / daily cap</dt>
										<dd class="text-right">Unavailable / $100.00</dd>
									</div>
									<p class="text-xs text-muted-foreground">
										No authoritative token-price data is available, so Wheelhouse cannot apply the
										$75 warning or $100 daily cap estimate.
									</p>
								{/if}
								{#if p.estimateRemainingPercent !== null}
									<div class="flex justify-between gap-3">
										<dt class="text-muted-foreground">Estimated remaining</dt>
										<dd class="text-right tabular-nums">
											~{Math.round(p.estimateRemainingPercent)}%
										</dd>
									</div>
								{/if}
							</dl>
							{#if p.statusReason || p.reason}
								<p class="mt-3 border-t pt-2 text-xs text-muted-foreground">
									{p.statusReason ?? p.reason}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

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
						Wheelhouse never asks for that approval itself. Who is using Claude, below, works
						without it.
					</p>
				</div>
			</section>
		{:else if a.state === 'unavailable'}
			<p class="mt-6 flex gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
				<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{a.reason}
			</p>
		{:else}
			{#if risk}
				<section
					class="mt-6 flex gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4"
					aria-live="polite"
				>
					<TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
					<div class="min-w-0">
						<p class="text-sm font-medium">
							{#if short}{risk.label} may run out around {clock(risk.runsOutAt)}, {minutes(short)} before
								it resets{:else}{risk.label} may run out before it resets{/if}
						</p>
						<p class="mt-1 text-sm text-muted-foreground">
							{#if busiest}{busiest.label} is the busiest right now.{/if} Work stops if the allowance
							runs out, and picks up again when it resets at {clock(risk.resetsAt)}.
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
				<div class="mt-1 flex justify-between text-xs text-muted-foreground">
					<span>{clock(new Date(now - 23 * 3600_000).toISOString())}</span>
					<span>{clock(new Date(now - 12 * 3600_000).toISOString())}</span><span>now</span>
				</div>
			{/if}
		</section>
	</div>
</main>
