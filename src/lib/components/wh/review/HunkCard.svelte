<script lang="ts">
	import {
		BOILERPLATE_LABEL,
		KIND_LABEL,
		type GuideItem,
		type RecordRef,
		type ReviewHunk,
		type ReviewRun
	} from '$lib/prreview';
	import AskBox from './AskBox.svelte';
	import RunView from './RunView.svelte';
	import { ChevronRight, MessageSquareText } from '@lucide/svelte';

	/**
	 * One hunk of the pull request: what the guide says about it (what it does,
	 * and why it was done this way, with the records that say so), its diff, and
	 * the questions and reviews asked about it.
	 */
	let {
		hunk,
		item = null,
		rank = null,
		records,
		runs,
		open: startOpen = true,
		agentProblem = null,
		busy = false,
		onask,
		onreview,
		onchange,
		onstop
	}: {
		hunk: ReviewHunk;
		item?: GuideItem | null;
		/** Its place in the guide's reading order. */
		rank?: number | null;
		records: Map<string, RecordRef>;
		runs: ReviewRun[];
		open?: boolean;
		agentProblem?: string | null;
		busy?: boolean;
		onask: (hunk: ReviewHunk, question: string) => Promise<string | null>;
		onreview: (hunk: ReviewHunk) => Promise<string | null>;
		onchange: (
			hunk: ReviewHunk,
			text: string
		) => Promise<{ ok: boolean; error?: string; pending?: boolean }>;
		onstop: (run: ReviewRun) => void;
	} = $props();

	let open = $state<boolean | null>(null);
	const shown = $derived(open ?? startOpen);
	let asking = $state(false);
	const talking = $derived(asking || runs.length > 0);

	const lineClass = (l: string) =>
		l.startsWith('+')
			? 'bg-success/10 text-success'
			: l.startsWith('-')
				? 'bg-danger/10 text-danger'
				: l.startsWith('\\')
					? 'text-muted-foreground italic'
					: '';
	const IMPORTANCE = { key: 'Read first', notable: 'Worth a look', routine: 'Routine' };
</script>

<section
	id="hunk-{hunk.id}"
	class="scroll-mt-20 overflow-hidden rounded-lg border bg-card"
	data-hunk={hunk.id}
	data-importance={item?.importance ?? (hunk.boilerplate ? 'boilerplate' : 'unranked')}
>
	<header
		class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-[var(--panel)] px-4 py-2.5"
	>
		{#if rank !== null}
			<span
				class="grid size-6 shrink-0 place-items-center self-center rounded-full border border-[var(--brass)] text-xs font-medium tabular-nums"
				aria-label="Number {rank} in the reading order">{rank}</span
			>
		{/if}
		<div class="min-w-0 flex-1">
			{#if item}
				<p class="font-display text-base leading-snug">{item.title}</p>
			{/if}
			<p class="truncate font-mono text-xs text-muted-foreground" title={hunk.path}>
				{hunk.path}<span class="text-muted-foreground/80">&nbsp;· line {hunk.newStart}</span>
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			{#if item && item.importance !== 'routine'}
				<span
					class="rounded border px-1.5 py-0.5 {item.importance === 'key'
						? 'border-sea/50 text-sea'
						: 'text-muted-foreground'}">{IMPORTANCE[item.importance]}</span
				>
			{/if}
			{#if item && item.kind !== 'other'}
				<span class="rounded border px-1.5 py-0.5 text-muted-foreground"
					>{KIND_LABEL[item.kind]}</span
				>
			{/if}
			{#if hunk.boilerplate}
				<span class="rounded border px-1.5 py-0.5 text-muted-foreground"
					>{BOILERPLATE_LABEL[hunk.boilerplate]}</span
				>
			{/if}
			<span class="tabular-nums"
				><span class="text-success">+{hunk.additions}</span>
				<span class="text-danger">−{hunk.deletions}</span></span
			>
		</div>
	</header>

	{#if item && (item.what || item.importance !== 'routine')}
		<div class="space-y-2 px-4 pt-3 text-sm leading-relaxed">
			{#if item.what}<p>{item.what}</p>{/if}
			{#if item.importance !== 'routine'}
				<div
					class="border-l-2 pl-3 {item.basis === 'recorded'
						? 'border-sea/60'
						: 'border-[var(--hair)]'}"
					data-basis={item.basis}
				>
					<p class="text-xs font-medium text-muted-foreground">
						{item.basis === 'recorded'
							? 'Why, from the task’s records'
							: item.basis === 'inferred'
								? 'Why: not recorded'
								: 'Why'}
					</p>
					{#if item.basis === 'none'}
						<p class="mt-0.5">No recorded reason.</p>
					{:else}
						<p class="mt-0.5 {item.basis === 'inferred' ? 'text-muted-foreground' : ''}">
							{item.why}
						</p>
					{/if}
					{#if item.sources.length}
						<ul class="mt-1.5 flex flex-wrap gap-1.5" aria-label="Records this rests on">
							{#each item.sources as s (s)}
								{@const r = records.get(s)}
								<li>
									<span
										class="inline-block max-w-72 truncate rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
										title={r ? `${r.name}: ${r.excerpt}` : s}>{s} · {r?.name ?? 'record'}</span
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if hunk.unseen}
		<p class="px-4 pt-3 text-xs text-warning">
			The diff was too large for the guide to read this hunk; ask about it directly.
		</p>
	{/if}

	<div class="px-4 pt-3">
		<button
			type="button"
			class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			aria-expanded={shown}
			aria-controls="diff-{hunk.id}"
			onclick={() => (open = !shown)}
		>
			<ChevronRight
				class="size-3.5 transition-transform {shown ? 'rotate-90' : ''}"
				aria-hidden="true"
			/>
			{shown ? 'Hide the diff' : `Show the diff (${hunk.lines.length} lines)`}
		</button>
	</div>
	{#if shown}
		<div id="diff-{hunk.id}" class="mx-4 mt-2 overflow-x-auto rounded-md border bg-background">
			<div
				class="min-w-max py-1.5 font-mono text-xs leading-relaxed whitespace-pre"
				role="presentation"
			>
				<div class="bg-sea/10 px-3 text-sea">{hunk.header}</div>
				{#each hunk.lines as l, i (i)}<div class="px-3 {lineClass(l)}">{l || ' '}</div>{/each}
			</div>
		</div>
	{/if}

	<div class="px-4 pt-3 pb-3">
		{#if talking}
			<div class="space-y-3 border-t pt-3">
				{#each runs as r (r.id)}
					<RunView run={r} {onstop} />
				{/each}
				<AskBox
					scope="this hunk"
					{agentProblem}
					{busy}
					onask={(q) => onask(hunk, q)}
					onreview={() => onreview(hunk)}
					onchange={(t) => onchange(hunk, t)}
				/>
			</div>
		{:else}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 text-xs text-sea hover:underline"
				onclick={() => (asking = true)}
				data-ask-hunk
				><MessageSquareText class="size-3.5" aria-hidden="true" />Ask, review or request a change
				here</button
			>
		{/if}
	</div>
</section>
