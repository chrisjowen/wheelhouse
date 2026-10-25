<script lang="ts">
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { Anchor, Check, Copy, ExternalLink, Flag, Sailboat, TriangleAlert } from '@lucide/svelte';
	import ResizableRail from '$lib/components/wh/ResizableRail.svelte';
	import ChartMap from './ChartMap.svelte';
	import Inspector from './Inspector.svelte';
	import { FOLLOW } from './join';
	import { layoutChart } from './layout';
	import type { ChartData, NoDocket } from './types';
	import { DASH, MARKS } from './words';

	/**
	 * The docket plugin's Chart tab: a read-only map of the project's system,
	 * full width and fitted to the view, with the details on the right (the
	 * vessels under way and a key, or the inspector for what is selected) in a
	 * resizable rail, as on the home page. On a narrow screen the details sit
	 * below the chart. Nothing here edits the docket; "Open in docket" links out
	 * to docket's own UI.
	 */
	let { data }: { data: unknown } = $props();
	const value = $derived(data as ChartData | NoDocket);

	let selected = $state<string | null>(null);
	let vessel = $state<string | null>(null);
	let restriction = $state<string | null>(null);
	let now = $state(Date.now());
	let copied = $state(false);

	onMount(() => {
		now = Date.now();
	});

	const wide = new MediaQuery('min-width: 1024px', false);
	// Fit the whole chart to the space it has, but never so small its labels stop being legible
	// (the chart then scrolls within its own area) nor blown up past half again its size.
	const MIN_SCALE = 0.85;
	const MAX_SCALE = 1.5;
	const PAD = 32;
	let viewW = $state(0);
	let viewH = $state(0);

	const chart = $derived(value.state === 'chart' ? value : null);
	const layout = $derived(chart ? layoutChart(chart.graph) : null);
	const scale = $derived(
		layout && viewW > PAD && viewH > PAD
			? Math.min(
					Math.max(
						Math.min((viewW - PAD) / layout.width, (viewH - PAD) / layout.height),
						MIN_SCALE
					),
					MAX_SCALE
				)
			: 1
	);
	const icons = $derived(
		Object.fromEntries((chart?.graph.types ?? []).map((t) => [t.name, t.icon]))
	);
	const focused = $derived(chart?.vessels.find((v) => v.taskId === vessel) ?? null);
	const highlight = $derived.by(() => {
		if (!chart || !layout) return new Set<string>();
		if (focused) {
			// What the task touches, and one step out along what it relies on and where it runs.
			const touched = new Set(focused.touched);
			const out = chart.graph.links
				.filter((l) => touched.has(l.source) && FOLLOW.has(l.rel))
				.map((l) => l.target);
			return new Set([...touched, ...out]);
		}
		const r = layout.restrictions.find((x) => x.id === restriction);
		if (r) return new Set(r.targets);
		if (selected) {
			const near = chart.graph.links
				.filter((l) => l.source === selected || l.target === selected)
				.flatMap((l) => [l.source, l.target]);
			return new Set([selected, ...near]);
		}
		return new Set<string>();
	});
	const hazards = $derived(chart?.vessels.filter((v) => v.hazards.length) ?? []);
	const restrictionTitle = (id: string) =>
		layout?.restrictions.find((r) => r.id === id)?.title ?? id;
	const titleOf = (id: string) => chart?.graph.exhibits.find((x) => x.id === id)?.title ?? id;
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	async function copyCommand(command: string) {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}

	function select(id: string | null) {
		selected = id;
		vessel = null;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			selected = null;
			vessel = null;
		}
	}}
/>

{#if value.state === 'no-docket'}
	<div class="m-4 rounded-xl border border-dashed px-6 py-10 text-center sm:m-6">
		<p class="font-medium">This project keeps no docket</p>
		<p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
			A docket is a set of Markdown files under <span class="font-mono">.docket/</span> that
			describes the system: its services, data, owners and the rules that apply. Run
			<span class="font-mono">docket init</span> in the project to start one, and the Chart draws it here.
		</p>
	</div>
{:else if chart && layout}
	<div class="flex min-h-0 flex-1 {wide.current ? '' : 'flex-col overflow-y-auto'}">
		<div class="flex min-w-0 flex-1 flex-col {wide.current ? 'min-h-0' : ''}">
			<div class="shrink-0 border-b px-4 py-2 sm:px-6">
				<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
					<p class="text-sm text-muted-foreground">
						<span class="tabular"
							>{plural(chart.graph.exhibits.length, 'landmark', 'landmarks')}</span
						>
						· <span class="tabular">{plural(chart.graph.links.length, 'route', 'routes')}</span>
						·
						<span class="tabular"
							>{plural(chart.vessels.length, 'vessel', 'vessels')} under way</span
						>
						{#if hazards.length}
							· <span class="tabular text-warning"
								>{plural(hazards.length, 'hazard', 'hazards')} on a course</span
							>
						{/if}
						{#if chart.graph.surveyed}· surveyed {chart.graph.surveyed}{/if}
					</p>
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
						<span class="text-muted-foreground">Start docket’s viewer with</span>
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all select-all"
							>{chart.openCommand}</code
						>
						<button
							class="inline-flex items-center text-muted-foreground hover:text-foreground"
							aria-label={copied ? 'Copied' : 'Copy the command'}
							title={copied ? 'Copied' : 'Copy the command'}
							onclick={() => copyCommand(chart.openCommand)}
							>{#if copied}<Check class="size-3.5" aria-hidden="true" />{:else}<Copy
									class="size-3.5"
									aria-hidden="true"
								/>{/if}</button
						>
						<span class="text-muted-foreground">then</span>
						<a
							href="http://127.0.0.1:4380/"
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							>Open in docket<ExternalLink class="size-3.5" aria-hidden="true" /></a
						>
					</div>
				</div>
				{#if chart.configuredRoot}
					<p class="mt-1 text-xs text-muted-foreground">
						Drawn from <span class="font-mono break-words">{chart.configuredRoot}</span>, set in
						Wheelhouse’s plugins file, not from this project’s clone.
					</p>
				{/if}
			</div>
			<div
				class="bg-card/40 {wide.current ? 'min-h-0 flex-1' : 'h-[60vh] shrink-0'} overflow-auto"
				bind:clientWidth={viewW}
				bind:clientHeight={viewH}
			>
				<div class="flex min-h-full w-max min-w-full items-center justify-center p-4">
					<ChartMap
						{layout}
						{scale}
						{icons}
						vessels={chart.vessels}
						{selected}
						{highlight}
						{now}
						onselect={select}
					/>
				</div>
			</div>
		</div>

		{#snippet details()}
			<aside class="h-full overflow-y-auto px-4 py-4 sm:px-5" aria-label="Inspector">
				{#if selected}
					<Inspector
						id={selected}
						graph={chart.graph}
						{layout}
						{icons}
						vessels={chart.vessels}
						{now}
						onselect={select}
					/>
				{:else}
					<div class="space-y-5 text-sm">
						<p class="text-muted-foreground">
							Select a landmark to see what the docket records about it.
						</p>

						<section aria-label="Vessels under way">
							<h3 class="mb-2 text-xs font-medium text-muted-foreground">Vessels under way</h3>
							{#if chart.vessels.length}
								<ul class="space-y-2 text-sm">
									{#each chart.vessels as v (v.taskId)}
										<li class="flex flex-wrap items-baseline gap-x-1.5">
											<button
												class="inline-flex items-baseline gap-1.5 rounded text-left hover:underline {vessel ===
												v.taskId
													? 'font-medium text-sea'
													: ''}"
												aria-pressed={vessel === v.taskId}
												onclick={() => {
													vessel = vessel === v.taskId ? null : v.taskId;
													selected = null;
												}}
												><Sailboat
													class="size-3.5 shrink-0 self-center text-sea"
													aria-hidden="true"
												/>{v.title}</button
											>
											<span class="text-muted-foreground"
												>· {v.step} · touches {v.touched.map(titleOf).join(', ')}</span
											>
											{#if v.hazards.length}
												<span class="inline-flex items-baseline gap-1 text-warning"
													><TriangleAlert class="size-3.5 self-center" aria-hidden="true" />in
													restricted waters: {v.hazards.map(restrictionTitle).join('; ')}</span
												>
											{/if}
											<a
												class="text-xs text-muted-foreground hover:text-foreground hover:underline"
												href="/tasks/{encodeURIComponent(v.taskId)}">Open task</a
											>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="text-sm text-muted-foreground">
									No task under way touches anything on the chart.
								</p>
							{/if}
							{#if chart.unplaced && chart.vessels.length}
								<p class="mt-1.5 text-xs text-muted-foreground">
									{plural(chart.unplaced, 'other task', 'other tasks')} under way
									{chart.unplaced === 1 ? 'touches' : 'touch'} nothing the docket has evidence for.
								</p>
							{/if}
						</section>

						<section>
							<h3 class="mb-2 text-xs font-medium text-muted-foreground">Key</h3>
							<ul class="space-y-1.5 text-xs">
								{#each ['charted', 'approximate', 'doubtful'] as const as m (m)}
									<li class="flex items-center gap-2">
										<svg width="34" height="10" aria-hidden="true" class="shrink-0">
											<line
												x1="1"
												y1="5"
												x2="33"
												y2="5"
												class="stroke-muted-foreground"
												stroke-width="1.5"
												stroke-linecap="round"
												stroke-dasharray={DASH[m]}
											/>
										</svg>
										<span
											><span class="font-medium"
												>{MARKS[m].label}{MARKS[m].short ? ` (${MARKS[m].short})` : ''}</span
											>: {MARKS[m].means}</span
										>
									</li>
								{/each}
								<li class="flex items-center gap-2">
									<span
										class="h-3 w-[34px] shrink-0 rounded-sm border border-dashed border-muted-foreground/60"
									></span>
									<span
										><span class="font-medium">Unsurveyed</span>: named, but nothing describes it</span
									>
								</li>
								<li class="flex items-center gap-2">
									<Flag class="mx-[10px] size-3.5 shrink-0 text-sea" aria-hidden="true" />
									<span
										><span class="font-medium">Waters</span>: whose team owns what sits there</span
									>
								</li>
								<li class="flex items-center gap-2">
									<Anchor class="mx-[10px] size-3.5 shrink-0 text-sea" aria-hidden="true" />
									<span
										><span class="font-medium">Harbour</span>: an environment where code runs</span
									>
								</li>
								<li class="flex items-center gap-2">
									<Sailboat class="mx-[10px] size-3.5 shrink-0 text-sea" aria-hidden="true" />
									<span
										><span class="font-medium">Vessel</span>: a task under way that touches it</span
									>
								</li>
								<li class="flex items-center gap-2">
									<span class="w-[34px] shrink-0 text-right text-xs text-muted-foreground italic"
										>09-14</span
									>
									<span
										><span class="font-medium">Survey date</span>: when evidence was last observed;
										faded after six months</span
									>
								</li>
							</ul>
						</section>

						{#if layout.restrictions.length}
							<section>
								<h3 class="mb-2 text-xs font-medium text-muted-foreground">Restricted waters</h3>
								<ul class="space-y-1">
									{#each layout.restrictions as r (r.id)}
										<li class="flex items-start gap-2">
											<span
												class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-warning/70 text-xs font-semibold text-warning"
												>{r.letter}</span
											>
											<button
												class="text-left hover:underline"
												onmouseenter={() => (restriction = r.id)}
												onmouseleave={() => (restriction = null)}
												onfocus={() => (restriction = r.id)}
												onblur={() => (restriction = null)}
												onclick={() => select(r.id)}>{r.title}</button
											>
										</li>
									{/each}
								</ul>
							</section>
						{/if}

						{#if layout.notices.length}
							<section>
								<h3 class="mb-2 text-xs font-medium text-muted-foreground">Notices to mariners</h3>
								<ul class="space-y-1">
									{#each layout.notices as n (n.exhibit.id)}
										<li>
											<button
												class="text-left hover:underline {n.superseded
													? 'text-muted-foreground line-through'
													: ''}"
												onclick={() => select(n.exhibit.id)}>{n.exhibit.title}</button
											>{#if n.superseded}<span class="ml-1 text-xs text-muted-foreground"
													>superseded</span
												>{/if}
										</li>
									{/each}
								</ul>
							</section>
						{/if}

						{#if chart.graph.diagnostics.errors || chart.graph.trimmed.exhibits || chart.graph.trimmed.links}
							<section class="text-xs text-muted-foreground">
								{#if chart.graph.diagnostics.errors}
									<p>
										Docket reports {plural(chart.graph.diagnostics.errors, 'problem', 'problems')} in
										its files; what they describe is left off the chart.
									</p>
								{/if}
								{#if chart.graph.trimmed.exhibits || chart.graph.trimmed.links}
									<p>
										The chart shows the first {chart.graph.exhibits.length} landmarks; open docket to
										see them all.
									</p>
								{/if}
							</section>
						{/if}
					</div>
				{/if}
			</aside>
		{/snippet}
		{#if wide.current}
			<ResizableRail storageKey="wheelhouse-chart-details-width" label="Resize the details">
				{@render details()}
			</ResizableRail>
		{:else}
			<div class="border-t">{@render details()}</div>
		{/if}
	</div>
{/if}
