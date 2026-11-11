<script lang="ts">
	/**
	 * Where a question's work can be seen, always on show (not behind
	 * Evidence): the task's latest preview and review board, from its own status
	 * lines (InboxEvidence), never from the question's words. A preview opens
	 * here full size (with the preview helper when the task has a worker to
	 * send feedback to) or in a new tab; a board opens in a new tab. A sign-off
	 * card (a preview waiting on the captain) also shows the preview itself,
	 * live and scaled down, so it is plain what is being signed off. Each is
	 * checked before it is linked, and one that has stopped says so.
	 */
	import { ExternalLink, LayoutDashboard, MonitorOff, MonitorPlay } from '@lucide/svelte';
	import { previewChecks, urlKey } from '$lib/client/previewchecks.svelte';
	import type { InboxCard } from '$lib/inbox';
	import type { Box } from '$lib/motion';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';

	let { card }: { card: InboxCard } = $props();

	const ev = $derived(card.evidence);
	// A task's preview is checked as the task's (a remote one through its forward); else by its address.
	const key = $derived(ev.previewTask ?? (ev.preview ? urlKey(ev.preview) : null));
	const boardKey = $derived(ev.board ? urlKey(ev.board) : null);
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
	let studio = $state<{ from: Box | null } | null>(null);
	const open = (e: MouseEvent) =>
		(studio = { from: (e.currentTarget as HTMLElement).getBoundingClientRect() });
</script>

{#if ev.preview || ev.board}
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
			{#if ev.board}
				{#if boardStopped}
					<span class="inline-flex items-center gap-1 text-muted-foreground" data-where-board="down"
						><MonitorOff class="size-3.5 shrink-0" aria-hidden="true" />Board stopped</span
					>
				{:else}
					<a
						href={ev.board}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 font-medium text-sea hover:underline max-md:min-h-11"
						title={ev.board}
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

{#if studio && ev.preview}
	<PreviewStudio
		taskId={ev.previewTask}
		title={card.taskTitle}
		url={ev.preview}
		from={studio.from}
		onclose={() => (studio = null)}
	/>
{/if}
