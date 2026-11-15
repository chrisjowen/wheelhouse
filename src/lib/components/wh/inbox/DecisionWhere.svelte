<script lang="ts">
	/**
	 * Where a question's work can be seen, always on show (not behind
	 * Evidence): the task's latest preview and review board, from its own status
	 * lines (InboxEvidence), never from the question's words. A preview opens
	 * here full size (with the preview helper when the task has a worker to
	 * send feedback to) or in a new tab; a board opens in a new tab. A sign-off
	 * card (a preview waiting on the captain) also shows the preview itself,
	 * live and scaled down, so it is plain what is being signed off. Each is
	 * checked before it is linked, and one that has stopped says so. While a
	 * review-surface plugin is on, the board is left out: the plugin stands in
	 * for it. Every other card shows the preview as a small thumbnail, beside
	 * thumbnails of the task's screenshots; each opens enlarged over the page
	 * (X, Esc or a click outside closes it).
	 */
	import { ExternalLink, LayoutDashboard, MonitorOff, MonitorPlay } from '@lucide/svelte';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';
	import { previewChecks, urlKey } from '$lib/client/previewchecks.svelte';
	import { reviewSurface } from '$lib/client/reviewsurface';
	import type { InboxCard } from '$lib/inbox';
	import type { Box } from '$lib/motion';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';

	let { card }: { card: InboxCard } = $props();

	const ev = $derived(card.evidence);
	const board = $derived(reviewSurface() ? null : ev.board);
	// A task's preview is checked as the task's (a remote one through its forward); else by its address.
	const key = $derived(ev.previewTask ?? (ev.preview ? urlKey(ev.preview) : null));
	const boardKey = $derived(board ? urlKey(board) : null);
	$effect(() => {
		if (key) return previewChecks.watch(key);
	});
	$effect(() => {
		if (boardKey) return previewChecks.watch(boardKey);
	});
	const check = $derived(key ? previewChecks.checks[key] : undefined);
	const boardCheck = $derived(boardKey ? previewChecks.checks[boardKey] : undefined);
	const stopped = $derived(check?.state === 'down');
	const boardStopped = $derived(boardCheck?.state === 'down');
	// Where it opens: the address as checked (a remote preview's forward here), else as written.
	const shown = $derived(check?.url ?? ev.preview);
	const host = (u: string | null) => (u ? (URL.parse(u)?.host ?? u) : '');
	const signOff = $derived(card.kind === 'preview' && !!ev.preview);
	const shots = $derived(ev.screenshots ?? []);
	const thumb = $derived(!signOff && !!key && !stopped);
	let studio = $state<{ from: Box | null } | null>(null);
	let shot = $state<number | null>(null);
	const open = (e: MouseEvent) =>
		(studio = { from: (e.currentTarget as HTMLElement).getBoundingClientRect() });
</script>

{#if ev.preview || board}
	<div class="mt-2.5 rounded-md border bg-background/60 text-xs" data-decision-where>
		{#if signOff && key}
			<div class="overflow-hidden rounded-t-md border-b">
				{#if ev.previewTask}
					<LivePreview
						taskId={ev.previewTask}
						compact
						toolbar={false}
						onopen={() => (studio = { from: null })}
					/>
				{:else}
					<LivePreview
						url={ev.preview}
						compact
						toolbar={false}
						onopen={() => (studio = { from: null })}
					/>
				{/if}
			</div>
		{/if}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
			<span class="text-muted-foreground">Where it is</span>
			{#if ev.preview}
				{#if stopped}
					<span
						class="inline-flex items-center gap-1 text-muted-foreground"
						data-where-preview="down"
						><MonitorOff class="size-3.5 shrink-0" aria-hidden="true" />Preview stopped</span
					>
				{:else}
					<button
						type="button"
						class="inline-flex cursor-pointer items-center gap-1 font-medium text-sea hover:underline max-md:min-h-11"
						aria-haspopup="dialog"
						onclick={open}
						data-where-preview
						><MonitorPlay class="size-3.5 shrink-0" aria-hidden="true" />Open the preview</button
					>
					{#if shown}
						<a
							href={shown}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline max-md:min-h-11"
							title={shown}
							>{host(ev.preview)}<ExternalLink class="size-3.5 shrink-0" aria-hidden="true" /></a
						>
					{/if}
				{/if}
			{/if}
			{#if board}
				{#if boardStopped}
					<span class="inline-flex items-center gap-1 text-muted-foreground" data-where-board="down"
						><MonitorOff class="size-3.5 shrink-0" aria-hidden="true" />Board stopped</span
					>
				{:else}
					<a
						href={board}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 font-medium text-sea hover:underline max-md:min-h-11"
						title={board}
						data-where-board
						><LayoutDashboard class="size-3.5 shrink-0" aria-hidden="true" />Open the board<ExternalLink
							class="size-3.5 shrink-0"
							aria-hidden="true"
						/></a
					>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if thumb || shots.length}
	<ul class="mt-2.5 flex flex-wrap gap-2" aria-label="Thumbnails" data-decision-thumbs>
		{#if thumb}
			<li
				class="w-48 max-w-full overflow-hidden rounded-md border bg-background"
				data-thumb-preview
			>
				{#if ev.previewTask}
					<LivePreview
						taskId={ev.previewTask}
						compact
						toolbar={false}
						onopen={() => (studio = { from: null })}
					/>
				{:else}
					<LivePreview
						url={ev.preview}
						compact
						toolbar={false}
						onopen={() => (studio = { from: null })}
					/>
				{/if}
				<p class="flex items-center gap-1 border-t px-2 py-1 text-[0.7rem] text-muted-foreground">
					<MonitorPlay class="size-3 shrink-0" aria-hidden="true" /><span class="truncate"
						>Preview · {host(ev.preview)}</span
					>
				</p>
			</li>
		{/if}
		{#each shots as s, i (s.url)}
			<li>
				<button
					type="button"
					class="block cursor-zoom-in overflow-hidden rounded-md border bg-background"
					aria-haspopup="dialog"
					title="Enlarge {s.name}"
					onclick={() => (shot = i)}
					data-thumb-shot
					><img
						src={s.url}
						alt={s.name}
						class="h-20 w-32 object-cover object-top sm:h-24 sm:w-36"
						loading="lazy"
					/></button
				>
			</li>
		{/each}
	</ul>
{/if}

<Lightbox {shots} bind:index={shot} />

{#if studio && ev.preview}
	<PreviewStudio
		taskId={ev.previewTask}
		title={card.taskTitle}
		url={ev.preview}
		from={studio.from}
		onclose={() => (studio = null)}
	/>
{/if}
