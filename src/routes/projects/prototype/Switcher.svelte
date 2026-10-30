<!-- PROTOTYPE: the floating bar that flips between design directions (← and → keys too) and
     shows or hides the numbered notes. Not part of any design. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ChevronLeft, ChevronRight, MessageSquareText } from '@lucide/svelte';

	let { variants }: { variants: { key: string; name: string }[] } = $props();

	const current = $derived(page.url.searchParams.get('variant') ?? variants[0].key);
	const i = $derived(
		Math.max(
			0,
			variants.findIndex((v) => v.key === current)
		)
	);
	const notes = $derived(page.url.searchParams.get('notes') !== 'off');

	function go(changes: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	const step = (d: number) =>
		go({ variant: variants[(i + d + variants.length) % variants.length].key });

	function onkeydown(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el?.closest('input, textarea, [contenteditable]')) return;
		if (e.key === 'ArrowLeft') step(-1);
		if (e.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window {onkeydown} />

<div
	class="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-950 px-1.5 py-1.5 font-sans text-sm text-white shadow-xl ring-1 ring-white/15"
	role="toolbar"
	aria-label="Prototype directions"
>
	<button
		class="rounded-full p-1.5 hover:bg-white/15"
		onclick={() => step(-1)}
		aria-label="Previous direction"><ChevronLeft class="size-4" /></button
	>
	<span class="px-2 text-center whitespace-nowrap sm:min-w-56">
		<span class="text-white/60 max-sm:hidden">Direction</span>
		<span class="font-semibold">{variants[i].key}</span>
		<span class="text-white/60">·</span>
		{variants[i].name.split(':')[0]}<span class="max-sm:hidden"
			>:{variants[i].name.split(':')[1]}</span
		>
		<span class="text-white/50 max-sm:hidden">({i + 1} of {variants.length})</span>
	</span>
	<button
		class="rounded-full p-1.5 hover:bg-white/15"
		onclick={() => step(1)}
		aria-label="Next direction"><ChevronRight class="size-4" /></button
	>
	<span class="mx-1 h-5 w-px bg-white/20"></span>
	<button
		class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 {notes
			? 'bg-white text-slate-950'
			: 'text-white/80 hover:bg-white/15'}"
		onclick={() => go({ notes: notes ? 'off' : null })}
		aria-pressed={notes}><MessageSquareText class="size-4" aria-hidden="true" />Notes</button
	>
</div>
