<script lang="ts">
	import { ArrowRight, TriangleAlert } from '@lucide/svelte';
	import type { JoinLink, WatersData } from './types';
	import { MARKS, relLabel } from './words';

	/**
	 * "Waters this passage crosses": what the task's changed files touch on the
	 * project's chart, what sits one step away, and the restrictions and
	 * decisions that apply there.
	 */
	let { data }: { data: unknown } = $props();
	const value = $derived(data as WatersData);
	const w = $derived(value.state === 'waters' ? value : null);
	const title = (id: string) => w?.exhibits[id]?.title ?? id;
	const mark = (l: JoinLink) =>
		MARKS[l.mark].short ? ` (${MARKS[l.mark].short})` : l.mark === 'charted' ? '' : ' (unsurveyed)';
</script>

{#if value.state === 'unreadable'}
	<p class="text-sm text-muted-foreground">The chart could not be read. {value.reason}</p>
{:else if w}
	{@const j = w.join}
	{#if !j.touched.length}
		<p class="text-sm text-muted-foreground">
			None of this passage’s {j.coverage.files} changed {j.coverage.files === 1 ? 'file' : 'files'}
			appear in the docket’s evidence, so the chart cannot place it. The docket records
			{j.coverage.evidencePaths} file {j.coverage.evidencePaths === 1 ? 'path' : 'paths'}.
		</p>
	{:else}
		<div class="space-y-4 text-sm">
			{#if j.restricted.some((r) => r.direct)}
				<p
					class="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-warning"
				>
					<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span
						>This passage is in restricted waters: {j.restricted
							.filter((r) => r.direct)
							.map((r) => title(r.id))
							.join('; ')}.</span
					>
				</p>
			{/if}

			<section>
				<h3 class="mb-1.5 text-xs font-medium text-muted-foreground">Touches</h3>
				<ul class="space-y-1.5">
					{#each j.touched as t (t.id)}
						<li>
							<span class="font-medium">{title(t.id)}</span>
							<span class="text-muted-foreground"
								>· {t.files.length} {t.files.length === 1 ? 'file' : 'files'}</span
							>
							<p class="font-mono text-xs break-words text-muted-foreground">
								{t.files.join(', ')}
							</p>
						</li>
					{/each}
				</ul>
			</section>

			{#if j.restricted.length || j.notices.length}
				<section class="grid gap-4 sm:grid-cols-2">
					{#if j.restricted.length}
						<div>
							<h3 class="mb-1.5 text-xs font-medium text-muted-foreground">Restricted waters</h3>
							<ul class="space-y-1">
								{#each j.restricted as r (r.id)}
									<li>
										<span class={r.direct ? 'text-warning' : ''}>{title(r.id)}</span>
										<span class="text-xs text-muted-foreground"
											>· applies to {r.appliesTo.map(title).join(', ')}</span
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if j.notices.length}
						<div>
							<h3 class="mb-1.5 text-xs font-medium text-muted-foreground">Notices to mariners</h3>
							<ul class="space-y-1">
								{#each j.notices as n (n.id)}
									<li>
										<span class={n.superseded ? 'text-muted-foreground line-through' : ''}
											>{title(n.id)}</span
										>
										<span class="text-xs text-muted-foreground"
											>{n.superseded
												? '· superseded'
												: `· applies to ${n.appliesTo.map(title).join(', ')}`}</span
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</section>
			{/if}

			{#if j.nearby.length || j.dependents.length}
				<section class="grid gap-4 sm:grid-cols-2">
					{#if j.nearby.length}
						<div>
							<h3 class="mb-1.5 text-xs font-medium text-muted-foreground">One step away</h3>
							<ul class="space-y-1">
								{#each j.nearby as l, i (i)}
									<li class="text-muted-foreground">
										{title(l.source)}
										{relLabel(l.rel)}
										<span class="text-foreground">{title(l.target)}</span><span class="text-xs"
											>{mark(l)}</span
										>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if j.dependents.length}
						<div>
							<h3 class="mb-1.5 text-xs font-medium text-muted-foreground">Who relies on it</h3>
							<ul class="space-y-1">
								{#each j.dependents as l, i (i)}
									<li class="text-muted-foreground">
										<span class="text-foreground">{title(l.source)}</span>
										{relLabel(l.rel)}
										{title(l.target)}<span class="text-xs">{mark(l)}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</section>
			{/if}

			<div
				class="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground"
			>
				<span
					>{j.coverage.matched} of {j.coverage.files} changed {j.coverage.files === 1
						? 'file'
						: 'files'} matched the docket’s evidence.</span
				>
				<a href={w.chartHref} class="inline-flex items-center gap-1 text-sea hover:underline"
					>See it on the chart<ArrowRight class="size-3.5" aria-hidden="true" /></a
				>
			</div>
		</div>
	{/if}
{/if}
