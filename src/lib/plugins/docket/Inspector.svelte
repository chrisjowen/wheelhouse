<script lang="ts">
	import { Flag, Sailboat, X } from '@lucide/svelte';
	import type { ChartLayout } from './layout';
	import type { DocketGraph, Evidence, Vessel } from './types';
	import { confidenceWords, iconFor, MARKS, relLabel, surveyAge, typeLabel } from './words';

	/** What the docket records about one exhibit: links, evidence and what applies to it. */
	let {
		id,
		graph,
		layout,
		icons,
		vessels,
		now,
		onselect
	}: {
		id: string;
		graph: DocketGraph;
		layout: ChartLayout;
		icons: Record<string, string | null>;
		vessels: Vessel[];
		now: number;
		onselect: (id: string | null) => void;
	} = $props();

	const byId = $derived(new Map(graph.exhibits.map((x) => [x.id, x])));
	const x = $derived(byId.get(id) ?? null);
	const title = (i: string) => byId.get(i)?.title ?? i;
	const Icon = $derived(iconFor(icons[x?.type ?? '']));
	const out = $derived(
		graph.links.filter((l) => l.source === id && l.rel !== 'owned_by' && l.rel !== 'applies_to')
	);
	const into = $derived(
		graph.links.filter((l) => l.target === id && l.rel !== 'owned_by' && l.rel !== 'applies_to')
	);
	const routes = $derived([
		...out.map((l) => ({ l, other: l.target, dir: 'out' as const })),
		...into.map((l) => ({ l, other: l.source, dir: 'in' as const }))
	]);
	const restricted = $derived(layout.restrictions.filter((r) => r.targets.includes(id)));
	const notices = $derived(layout.notices.filter((n) => n.appliesTo.includes(id)));
	const here = $derived(vessels.filter((v) => v.touched.includes(id)));
	const evidence = $derived([
		...(x?.evidence ?? []).map((e) => ({ e, about: null as string | null })),
		...out.flatMap((l) =>
			l.evidence.map((e) => ({ e, about: `${relLabel(l.rel)} ${title(l.target)}` }))
		)
	]);
	const where = (e: Evidence) =>
		[e.path ? `${e.path}${e.lines ? `:${e.lines}` : ''}` : null, e.symbol, e.key]
			.filter(Boolean)
			.join(' · ');
</script>

<div class="space-y-5 text-sm">
	<div class="flex items-start gap-2.5">
		<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<div class="min-w-0 flex-1">
			<h3 class="leading-snug font-semibold">{x?.title ?? id}</h3>
			<p class="text-xs text-muted-foreground">
				{x ? typeLabel(x.type) : 'Unsurveyed: nothing in the docket describes it'}
				<span class="font-mono">· {id}</span>
			</p>
		</div>
		<button
			class="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			aria-label="Close"
			onclick={() => onselect(null)}><X class="size-4" /></button
		>
	</div>

	{#if x}
		{#if x.summary}<p class="text-muted-foreground">{x.summary}</p>{/if}
		<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
			{#if x.owner}
				<dt class="text-muted-foreground">Owner</dt>
				<dd class="inline-flex items-center gap-1">
					<Flag class="size-3 text-sea" aria-hidden="true" />{title(x.owner)}
				</dd>
			{/if}
			<dt class="text-muted-foreground">Confidence</dt>
			<dd>{confidenceWords(x.confidence, x.basis)}</dd>
			{#if x.surveyed}
				<dt class="text-muted-foreground">Surveyed</dt>
				<dd class={surveyAge(x.surveyed, now) === 'old' ? 'text-warning' : ''}>
					{x.surveyed}{surveyAge(x.surveyed, now) === 'old' ? ' (over six months ago)' : ''}
				</dd>
			{/if}
			{#each x.attributes as a (a.key)}
				<dt class="text-muted-foreground">{a.key}</dt>
				<dd class="break-words">{a.value}</dd>
			{/each}
			{#if x.tags.length}
				<dt class="text-muted-foreground">Tags</dt>
				<dd>{x.tags.join(', ')}</dd>
			{/if}
		</dl>
	{/if}

	{#if here.length}
		<section>
			<h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Under way here</h4>
			<ul class="space-y-1">
				{#each here as v (v.taskId)}
					<li class="flex items-start gap-1.5">
						<Sailboat class="mt-0.5 size-3.5 shrink-0 text-sea" aria-hidden="true" />
						<a class="hover:underline" href="/tasks/{encodeURIComponent(v.taskId)}">{v.title}</a>
						<span class="text-muted-foreground">· {v.step}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if restricted.length}
		<section>
			<h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Restricted waters</h4>
			<ul class="space-y-1">
				{#each restricted as r (r.id)}
					<li class="flex items-start gap-2">
						<span
							class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-warning/70 text-xs font-semibold text-warning"
							>{r.letter}</span
						>
						<button class="text-left hover:underline" onclick={() => onselect(r.id)}
							>{r.title}</button
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if notices.length}
		<section>
			<h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Notices to mariners</h4>
			<ul class="space-y-1">
				{#each notices as n (n.exhibit.id)}
					<li>
						<button
							class="text-left hover:underline {n.superseded
								? 'text-muted-foreground line-through'
								: ''}"
							onclick={() => onselect(n.exhibit.id)}>{n.exhibit.title}</button
						>{#if n.superseded}<span class="ml-1 text-xs text-muted-foreground">superseded</span
							>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if out.length || into.length}
		<section>
			<h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Routes</h4>
			<ul class="space-y-1">
				{#each routes as r, i (i)}
					<li class="flex flex-wrap items-baseline gap-x-1.5">
						{#if r.dir === 'out'}
							<span class="text-muted-foreground">{relLabel(r.l.rel)}</span>
							<button class="hover:underline" onclick={() => onselect(r.other)}
								>{title(r.other)}</button
							>
						{:else}
							<button class="hover:underline" onclick={() => onselect(r.other)}
								>{title(r.other)}</button
							>
							<span class="text-muted-foreground">{relLabel(r.l.rel)} this</span>
						{/if}
						<span class="text-xs text-muted-foreground" title={MARKS[r.l.mark].means}
							>{MARKS[r.l.mark].label.toLowerCase()}{MARKS[r.l.mark].short
								? ` (${MARKS[r.l.mark].short})`
								: ''}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section>
		<h4 class="mb-1.5 text-xs font-medium text-muted-foreground">Evidence</h4>
		{#if evidence.length}
			<ul class="space-y-2.5">
				{#each evidence as { e, about }, i (i)}
					<li class="text-xs">
						<p>
							<span class="font-medium">{typeLabel(e.source)}</span>{#if about}<span
									class="ml-1 text-muted-foreground">for “{about}”</span
								>{/if}
						</p>
						{#if where(e)}<p class="font-mono break-words text-muted-foreground">{where(e)}</p>{/if}
						{#if e.note}<p class="text-muted-foreground">{e.note}</p>{/if}
						{#if e.observedAt || e.observedBy}
							<p class="text-muted-foreground italic">
								surveyed{e.observedAt ? ` ${e.observedAt.slice(0, 10)}` : ''}{e.observedBy
									? ` by ${e.observedBy}`
									: ''}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-xs text-muted-foreground">
				No evidence recorded. The docket states this without an observation behind it.
			</p>
		{/if}
	</section>

	{#if x?.path}
		<p class="font-mono text-xs break-words text-muted-foreground">{x.path}</p>
	{/if}
</div>
