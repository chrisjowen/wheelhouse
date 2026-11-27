<script lang="ts">
	/**
	 * A merge call led by its answer: Firstmate's recommendation first, then the
	 * answer (`answer`, the card's own form), then what it rests on, each from
	 * Wheelhouse's own records: why (what the captain asked for, from the task's
	 * brief), what changed (Firstmate's note and the biggest files), before and
	 * after (pictures the worker named so, else its latest ones; none is said
	 * plainly), a recording when the worker made one (never required), and the
	 * checks, the review's points and the change's size. `compact` (On deck)
	 * keeps the answer, small pictures and the checks and size, with a link to
	 * all of it on the Decisions page.
	 */
	import type { Snippet } from 'svelte';
	import { ArrowUpRight, CircleAlert, CircleCheck, Film } from '@lucide/svelte';
	import { currentFleet } from '$lib/client/live.svelte';
	import { taskFacts } from '$lib/client/taskfacts.svelte';
	import { reviewPoints } from '$lib/calls';
	import { cardHref, followKey, type InboxCard } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';

	let {
		card,
		compact = false,
		withNote = true,
		answer
	}: {
		card: InboxCard;
		compact?: boolean;
		/** Firstmate's note under What changed (the Decisions pane shows it whole elsewhere). */
		withNote?: boolean;
		/** The answer, drawn right under the recommendation. */
		answer?: Snippet;
	} = $props();

	const taskId = $derived(followKey(card));
	const facts = $derived(taskFacts.get(taskId));
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === taskId) ?? null);
	const review = $derived(reviewPoints(task));
	const ev = $derived(card.evidence);
	const pr = $derived(ev.pr);
	// Failing checks first; then the pull request's own, else CI as Wheelhouse last read it.
	const failing = $derived((facts?.checks?.failing ?? 0) > 0 || ev.checks === 'red');
	const checksText = $derived.by(() => {
		const c = facts?.checks;
		if (c)
			return c.failing
				? `${c.failing} of ${c.total} checks failing`
				: c.running
					? `${c.passed} of ${c.total} checks passed, ${c.running} still running`
					: `${c.passed} of ${c.total} checks passed`;
		return ev.checks === 'green'
			? 'Checks green'
			: ev.checks === 'red'
				? 'Checks failing'
				: ev.checks === 'pending'
					? 'Checks still running'
					: null;
	});
	const reviewText = $derived(
		review
			? review.raised
				? `The review raised ${review.raised} ${review.raised === 1 ? 'point' : 'points'}${review.fixed ? `; ${review.fixed} fixed` : ''}`
				: 'The review raised nothing'
			: null
	);
	const lines = $derived(
		facts && facts.additions !== null && facts.deletions !== null
			? { plus: facts.additions, minus: facts.deletions }
			: null
	);
	// Five blocks, added against removed, as a diff stat draws them.
	const bar = $derived.by(() => {
		if (!lines || lines.plus + lines.minus === 0) return null;
		const p = Math.round((lines.plus / (lines.plus + lines.minus)) * 5);
		return { plus: p, minus: 5 - p };
	});
	const pictures = $derived(
		facts?.before && facts.after
			? [
					{ ...facts.before, label: 'Before' },
					{ ...facts.after, label: 'After' }
				]
			: (facts?.shots ?? []).map((s, i) => ({ ...s, label: i === 0 ? 'Latest' : 'Earlier' }))
	);
	const gallery = $derived([...pictures, ...(facts?.recording ? [facts.recording] : [])]);
	let zoom = $state<number | null>(null);
	// Firstmate's note on it, without the heading the card already shows.
	const note = $derived((withNote && ev.text?.replace(/\s+/g, ' ').trim()) || null);
	const number = (n: number) => n.toLocaleString();
</script>

{#snippet verdict()}
	<div
		class="mt-3 flex items-start gap-3 rounded-lg border px-3.5 py-2.5 {failing
			? 'border-danger/40 bg-danger/[0.06]'
			: 'border-success/40 bg-success/[0.07]'}"
		data-merge-verdict
	>
		<span
			class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full {failing
				? 'bg-danger text-background'
				: 'bg-success text-background'}"
			aria-hidden="true"
			>{#if failing}<CircleAlert class="size-4" />{:else}<CircleCheck class="size-4" />{/if}</span
		>
		<div class="min-w-0 text-sm leading-snug">
			<p class="font-semibold text-foreground">
				{#if card.recommendation}Firstmate recommends{card.recommendation.choice === 'approve'
						? ': merge it'
						: card.recommendation.choice === 'skip'
							? ': hold off'
							: card.recommendation.choice === 'fix'
								? ': ask for changes'
								: ''}{:else if failing}Checks are failing{:else}Ready for your word to merge{/if}
			</p>
			{#if card.recommendation?.text}
				<p class="mt-0.5 text-muted-foreground"><LinkedText text={card.recommendation.text} /></p>
			{:else if checksText}
				<p class="mt-0.5 text-muted-foreground">{checksText}.</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet heading(title: string)}
	<h4
		class="mt-4 mb-1.5 flex items-center gap-2 font-sans text-[0.68rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
	>
		{title}<span class="h-px flex-1 bg-hair" aria-hidden="true"></span>
	</h4>
{/snippet}

{#snippet sizeLine()}
	{#if pr || lines || facts?.files}
		<p
			class="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-xs tabular-nums"
			data-merge-size
		>
			{#if pr?.number}<span>#{pr.number}</span>{/if}
			{#if lines}<span class="text-success">+{number(lines.plus)}</span><span class="text-danger"
					>−{number(lines.minus)}</span
				>{/if}
			{#if facts?.files}<span class="text-muted-foreground"
					>· {facts.files} {facts.files === 1 ? 'file' : 'files'}</span
				>{/if}
			{#if bar}<span class="ml-1 inline-flex gap-px" aria-hidden="true"
					>{#each { length: bar.plus } as _, i (i)}<i class="size-2 bg-success"
						></i>{/each}{#each { length: bar.minus } as _, i (i)}<i class="size-2 bg-danger"
						></i>{/each}</span
				>{/if}
		</p>
	{/if}
{/snippet}

{#snippet checksLine()}
	{#if checksText || reviewText}
		<p class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm" data-merge-checks>
			{#if checksText}<span
					class="inline-flex items-center gap-1 font-medium {failing
						? 'text-danger'
						: 'text-success'}"
					>{#if failing}<CircleAlert class="size-3.5" aria-hidden="true" />{:else}<CircleCheck
							class="size-3.5"
							aria-hidden="true"
						/>{/if}{checksText}</span
				>{/if}
			{#if reviewText}<span class="text-muted-foreground">{reviewText}</span>{/if}
		</p>
	{/if}
{/snippet}

{#snippet picture(p: { name: string; url: string; label: string }, i: number, small: boolean)}
	<figure class="min-w-0">
		<figcaption class="mb-1 text-xs text-muted-foreground">
			<span class="font-medium text-foreground">{p.label}</span>{#if !small}
				· <span class="truncate">{p.name}</span>{/if}
		</figcaption>
		<button
			type="button"
			class="block w-full cursor-zoom-in overflow-hidden rounded-md border bg-background"
			aria-label="Enlarge {p.label.toLowerCase()}: {p.name}"
			onclick={() => (zoom = i)}
		>
			<img
				src={p.url}
				alt="{p.label}: {p.name}"
				loading="lazy"
				class="block w-full object-cover object-top {small ? 'aspect-[16/10]' : 'aspect-[16/10]'}"
			/>
		</button>
	</figure>
{/snippet}

<div data-merge-evidence={compact ? 'compact' : 'full'}>
	{@render verdict()}
	{@render answer?.()}

	{#if compact}
		{#if pictures.length}
			<div class="mt-3 grid grid-cols-2 gap-2">
				{#each pictures as p, i (p.url)}{@render picture(p, i, true)}{/each}
			</div>
		{/if}
		{@render checksLine()}
		{@render sizeLine()}
		<a
			href={cardHref(card.id)}
			class="mt-1.5 inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline max-md:min-h-11"
			data-all-evidence><ArrowUpRight class="size-3.5" aria-hidden="true" />All the evidence</a
		>
	{:else}
		{#if facts?.why}
			{@render heading('Why')}
			<p class="text-sm leading-relaxed" data-merge-why>
				You asked: <LinkedText text={facts.why} />
			</p>
		{/if}
		{#if note || facts?.biggest.length}
			{@render heading('What changed')}
			{#if note}<p class="line-clamp-4 text-sm leading-relaxed" data-merge-note>
					<LinkedText text={note} />
				</p>{/if}
			{#if facts?.biggest.length}
				<ul class="mt-1.5 grid gap-0.5 font-mono text-xs" data-merge-files>
					{#each facts.biggest as f (f.path)}
						<li class="flex min-w-0 gap-2">
							<span class="min-w-0 flex-1 truncate text-muted-foreground" title={f.path}
								>{f.path}</span
							>
							<span class="shrink-0 text-success">+{f.additions}</span><span
								class="shrink-0 text-danger">−{f.deletions}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
		{@render heading(facts?.before ? 'Before → after' : 'Pictures')}
		{#if pictures.length}
			<div class="grid grid-cols-2 gap-3 max-sm:grid-cols-1" data-merge-pictures>
				{#each pictures as p, i (p.url)}{@render picture(p, i, false)}{/each}
			</div>
		{:else}
			<p class="text-sm text-muted-foreground" data-merge-no-pictures>
				{facts
					? 'No pictures were taken for this change. The checks below are the evidence.'
					: 'Reading the change…'}
			</p>
		{/if}
		{#if facts?.recording}
			{@render heading('Recording')}
			<button
				type="button"
				class="flex w-full cursor-zoom-in items-center gap-2 overflow-hidden rounded-md border bg-background text-left"
				onclick={() => (zoom = pictures.length)}
				data-merge-recording
			>
				<img
					src={facts.recording.url}
					alt="Recording: {facts.recording.name}"
					loading="lazy"
					class="block aspect-[16/10] w-40 shrink-0 object-cover object-top"
				/>
				<span class="flex items-center gap-1.5 px-2 text-sm"
					><Film class="size-4 text-muted-foreground" aria-hidden="true" />{facts.recording
						.name}</span
				>
			</button>
		{/if}
		{@render heading('Checks and size')}
		{@render checksLine()}
		{@render sizeLine()}
		{#if !checksText && !reviewText && !pr && !lines}
			<p class="text-sm text-muted-foreground">Nothing read about its checks yet.</p>
		{/if}
	{/if}
</div>

<Lightbox shots={gallery} bind:index={zoom} />
