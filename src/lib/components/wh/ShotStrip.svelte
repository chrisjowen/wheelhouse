<script lang="ts">
	import Lightbox from './Lightbox.svelte';

	/**
	 * A card's newest screenshots as thumbnails; selecting one enlarges it in
	 * the Lightbox, which steps through the same few. `skip` leaves out ones the
	 * card already shows as its picture.
	 */
	let {
		shots,
		total,
		skip = 0
	}: { shots: { name: string; url: string }[]; total: number; skip?: number } = $props();

	let enlarged = $state<number | null>(null);
	const shown = $derived(shots.slice(skip));
	const more = $derived(total - shots.length);
</script>

{#if shown.length}
	<div class="relative z-10 mt-2 flex flex-wrap gap-1.5" data-card-shots>
		{#each shown as s, i (s.url)}
			<button
				type="button"
				class="w-20 shrink-0 cursor-zoom-in"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					enlarged = i + skip;
				}}
				aria-label="Enlarge screenshot {s.name}"
				title={s.name}
				><img
					src={s.url}
					alt={s.name}
					loading="lazy"
					class="aspect-[16/10] w-full rounded-md border object-cover object-top"
				/></button
			>
		{/each}
	</div>
	{#if more > 0}
		<p class="mt-1 text-[11px] text-muted-foreground">+{more} more on the task page</p>
	{/if}
	<Lightbox {shots} bind:index={enlarged} />
{/if}
