<script lang="ts">
	import { ChevronLeft, ChevronRight, X } from '@lucide/svelte';

	/**
	 * Screenshots enlarged in the page: Esc closes, the arrow keys step through
	 * them. `index` opens it on that screenshot; null closes it.
	 */
	let {
		shots,
		index = $bindable(null)
	}: { shots: { name: string; url: string }[]; index?: number | null } = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	const shot = $derived(index === null ? null : (shots[index] ?? null));

	$effect(() => {
		if (!dialog) return;
		if (shot && !dialog.open) dialog.showModal();
		else if (!shot && dialog.open) dialog.close();
	});

	const step = (by: number) => {
		if (index === null || shots.length < 2) return;
		index = (index + by + shots.length) % shots.length;
	};

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			step(1);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			step(-1);
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[94vh] max-w-[min(94vw,1400px)] overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/70"
	onclose={() => (index = null)}
	onclick={(e) => e.target === dialog && dialog?.close()}
	{onkeydown}
	aria-label={shot?.name ?? 'Screenshot'}
>
	{#if shot && index !== null}
		<div class="flex items-center gap-3 border-b px-3 py-2 text-sm">
			<span class="min-w-0 flex-1 truncate">{shot.name}</span>
			{#if shots.length > 1}
				<span class="tabular text-xs text-muted-foreground">{index + 1} of {shots.length}</span>
				<button
					type="button"
					class="rounded p-1 hover:bg-accent"
					onclick={() => step(-1)}
					aria-label="Previous screenshot"><ChevronLeft class="size-4" /></button
				>
				<button
					type="button"
					class="rounded p-1 hover:bg-accent"
					onclick={() => step(1)}
					aria-label="Next screenshot"><ChevronRight class="size-4" /></button
				>
			{/if}
			<button
				type="button"
				class="rounded p-1 hover:bg-accent"
				onclick={() => dialog?.close()}
				aria-label="Close"><X class="size-4" /></button
			>
		</div>
		<img src={shot.url} alt={shot.name} class="mx-auto max-h-[85vh] w-auto object-contain" />
		<p class="border-t px-3 py-1.5 text-xs text-muted-foreground">
			Esc closes{shots.length > 1 ? '; ← and → step through the screenshots' : ''}.
		</p>
	{/if}
</dialog>
