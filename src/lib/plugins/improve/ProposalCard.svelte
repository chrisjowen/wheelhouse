<script lang="ts">
	import { ArrowUpRight, ChevronRight, GitPullRequest, Hand, Lock, Split } from '@lucide/svelte';
	import type { ProposalItem } from './types';

	/**
	 * One improve proposal, in plain words: what it changes, whose files those
	 * are, where it stands and the evidence behind it. Its title opens it in
	 * improve's own UI when that is running; a proposal filed as a decision links
	 * to its Firstmate task.
	 */
	let { p, showDecisionLink = true }: { p: ProposalItem; showDecisionLink?: boolean } = $props();
	let open = $state(false);

	const VIS = {
		'captain-private': { icon: Lock, cls: 'border-hair text-foreground' },
		'shared-tracked': { icon: GitPullRequest, cls: 'border-sea/40 text-sea' },
		mixed: { icon: Split, cls: 'border-warning/40 text-warning' }
	} as const;
	const vis = $derived(p.visibility ? VIS[p.visibility] : null);
	const VisIcon = $derived(vis?.icon);
</script>

<article
	id={p.file}
	class="scroll-mt-24 rounded-lg border border-l-[3px] bg-card px-4 py-3 {p.waiting
		? 'border-l-sea'
		: 'border-l-border'}"
>
	<div class="flex flex-wrap items-center gap-1.5 text-xs">
		<span
			class="rounded px-1.5 leading-[1.15rem] font-medium {p.waiting
				? 'bg-sea/10 text-sea'
				: 'bg-muted text-muted-foreground'}">{p.statusLabel}</span
		>
		<span
			class="flex items-center gap-1 rounded border px-1.5 leading-[1.15rem] {vis?.cls ??
				'text-muted-foreground'}"
			>{#if VisIcon}<VisIcon class="size-3" aria-hidden="true" />{/if}{p.visibilityLabel}</span
		>
		{#if p.evidence.length}
			<span class="text-muted-foreground"
				>{p.evidence.length} {p.evidence.length === 1 ? 'piece' : 'pieces'} of evidence</span
			>
		{/if}
		<span class="ml-auto font-mono text-[0.7rem] text-muted-foreground">{p.id}</span>
	</div>

	<h3 class="mt-1.5 text-[0.95rem] leading-snug font-medium">
		{#if p.openUrl}
			<a
				href={p.openUrl}
				target="_blank"
				rel="noreferrer"
				class="group inline-flex items-start gap-1 hover:underline"
				title="Open in improve"
				>{p.title}<ArrowUpRight
					class="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
					aria-hidden="true"
				/></a
			>
		{:else}
			{p.title}
		{/if}
	</h3>

	{#if p.changes}
		<p class="mt-1 text-sm leading-relaxed">{p.changes}</p>
	{/if}
	<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
		{#if p.surfaces.length}{`Changes ${p.surfaces.join(', ')}`}{#if p.files.length}&#32;(<span
					class="font-mono">{p.files.join(', ')}</span
				>){/if}.&#32;{/if}{p.deliveryLabel}
	</p>

	{#if p.decision}
		<p class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
			<Hand class="size-3.5 text-sea" aria-hidden="true" />
			<span class="font-medium">{p.decision.state}</span>
			{#if p.decision.changedSinceFiling}
				<span class="text-muted-foreground">· changed since it was filed</span>
			{/if}
			{#if showDecisionLink && p.decision.href}
				<a href={p.decision.href} class="text-sea hover:underline">Open the decision</a>
			{/if}
		</p>
	{:else if p.routing}
		<p class="mt-2 text-xs text-muted-foreground">{p.routing}</p>
	{/if}

	{#if p.evidence.length || p.why}
		<button
			class="mt-2 flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
			aria-expanded={open}
			onclick={() => (open = !open)}
			>Why and the evidence<ChevronRight
				class="size-3.5 transition-transform {open ? 'rotate-90' : ''}"
			/></button
		>
		{#if open}
			<div class="mt-1.5 border-t border-hair pt-2 text-xs leading-relaxed">
				{#if p.why}<p><span class="font-medium">Why:</span> {p.why}</p>{/if}
				{#if p.evidence.length}
					<ul class="mt-1.5 flex flex-col gap-1">
						{#each p.evidence as e, i (i)}
							<li>
								<span class="text-muted-foreground">{e.source}:</span>
								{e.observation}
							</li>
						{/each}
					</ul>
				{/if}
				{#if p.confidence}
					<p class="mt-1.5 text-muted-foreground">improve’s confidence: {p.confidence}.</p>
				{/if}
			</div>
		{/if}
	{/if}
</article>
