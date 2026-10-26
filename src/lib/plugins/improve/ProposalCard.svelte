<script lang="ts">
	import { ArrowUpRight, ChevronDown, FileSearch, Hand } from '@lucide/svelte';
	import type { ProposalItem } from './types';
	import { KIND_ICON, STATUS_CHIP, VIS_CHIP } from './visual';

	/**
	 * One improve proposal as a card: the kind of change, a short title and one
	 * line, then chips for where it stands and whose files it touches, and an
	 * evidence count. The rest (what it changes in full, its files, why, the
	 * evidence) opens under Details. Its title opens it in improve's own UI
	 * while that runs; a proposal filed as a decision links to its task.
	 */
	let {
		p,
		showDecisionLink = true,
		open = $bindable(false)
	}: { p: ProposalItem; showDecisionLink?: boolean; open?: boolean } = $props();

	const KindIcon = $derived(KIND_ICON[p.kind]);
	const vis = $derived(p.visibility ? VIS_CHIP[p.visibility] : null);
	const VisIcon = $derived(vis?.icon);
	const detailId = $derived(`detail-${p.file}`);
	const evidence = $derived(
		`${p.evidence.length} ${p.evidence.length === 1 ? 'piece' : 'pieces'} of evidence`
	);
</script>

<article
	id={p.file}
	class="flex h-full scroll-mt-24 flex-col rounded-lg border bg-card p-4 transition-colors duration-200 hover:border-foreground/25 {p.waiting
		? 'border-l-[3px] border-l-sea'
		: ''}"
>
	<div class="flex items-center gap-2">
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-full border border-hair bg-panel text-sea"
			aria-hidden="true"><KindIcon class="size-4" /></span
		>
		<span
			class="text-[0.95rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
			>{p.kindLabel}</span
		>
		<span
			class="ml-auto flex items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-xs text-muted-foreground"
			title={evidence}
			aria-label={evidence}
		>
			<FileSearch class="size-3.5" aria-hidden="true" /><span class="tabular font-medium"
				>{p.evidence.length}</span
			>
		</span>
	</div>

	<h3 class="mt-3 font-display text-[1.15rem] leading-snug font-medium">
		{#if p.openUrl}
			<a
				href={p.openUrl}
				target="_blank"
				rel="noreferrer"
				class="group rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
				title="Open in improve"
				>{p.title}<ArrowUpRight
					class="ml-1 inline size-3.5 align-baseline text-muted-foreground group-hover:text-foreground"
					aria-hidden="true"
				/></a
			>
		{:else}
			{p.title}
		{/if}
	</h3>
	{#if p.summary}
		<p class="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
	{/if}

	<div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
		<span class="rounded-full border px-2 py-0.5 font-semibold {STATUS_CHIP[p.group]}"
			>{p.statusShort}</span
		>
		<span
			class="flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium {vis?.cls ??
				'border-hair text-muted-foreground'}"
			title={p.visibilityLabel}
			>{#if VisIcon}<VisIcon class="size-3" aria-hidden="true" />{/if}{p.visibilityShort}</span
		>
		{#if p.decision}
			{#if showDecisionLink && p.decision.href}
				<a
					href={p.decision.href}
					class="flex items-center gap-1 rounded-full border border-sea/40 px-2 py-0.5 font-medium text-sea hover:bg-sea/10"
					title="Open the decision task"
					><Hand class="size-3" aria-hidden="true" />{p.decision.state}</a
				>
			{:else}
				<span
					class="flex items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-muted-foreground"
					><Hand class="size-3" aria-hidden="true" />{p.decision.state}</span
				>
			{/if}
		{:else if p.routing && p.waiting}
			<span
				class="rounded-full border border-dashed border-input px-2 py-0.5 text-muted-foreground"
				title={p.routing}>Not filed yet</span
			>
		{/if}
	</div>

	<div class="mt-auto pt-3">
		<button
			class="-mx-1 flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			aria-expanded={open}
			aria-controls={detailId}
			onclick={() => (open = !open)}
			>Details<ChevronDown
				class="size-3.5 transition-transform duration-200 {open ? 'rotate-180' : ''}"
				aria-hidden="true"
			/></button
		>
	</div>

	{#if open}
		<div id={detailId} class="mt-2 flex flex-col gap-3 border-t border-hair pt-3 text-sm">
			{#if p.changes}<p class="leading-relaxed">{p.changes}</p>{/if}
			{#if p.files.length}
				<div class="flex flex-wrap gap-1.5">
					{#each p.files as f (f)}
						<code class="rounded border border-hair bg-muted/60 px-1.5 py-0.5 font-mono text-xs"
							>{f}</code
						>
					{/each}
				</div>
			{/if}
			<p class="text-xs leading-relaxed text-muted-foreground">
				{#if p.surfaces.length}Changes {p.surfaces.join(', ')}.{/if}
				{p.deliveryLabel}
				{#if p.routing}{p.routing}{/if}
			</p>
			{#if p.why}
				<p class="text-xs leading-relaxed">
					<span class="font-semibold">Why:</span>
					{p.why}{#if p.confidence}<span class="text-muted-foreground">
							(confidence {p.confidence})</span
						>{/if}
				</p>
			{/if}
			{#if p.evidence.length}
				<ul class="flex flex-col divide-y divide-hair rounded-md border border-hair text-xs">
					{#each p.evidence as e, i (i)}
						<li class="flex gap-3 px-3 py-2">
							<span class="w-28 shrink-0 text-muted-foreground">{e.source}</span>
							<span class="min-w-0">{e.observation}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</article>
