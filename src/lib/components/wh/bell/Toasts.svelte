<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { page } from '$app/state';
	import { bell } from '$lib/client/bell.svelte';
	import { live } from '$lib/client/live.svelte';
	import ToastCard from './ToastCard.svelte';

	// The ship's bell's toasts, newest first, top right under the header (clear of the
	// chat's message box), over every page. Three show; the rest fold into "+N more".
	const VISIBLE = 3;
	let expanded = $state(false);
	const newest = $derived([...bell.toasts].reverse());
	const shown = $derived(expanded ? newest : newest.slice(0, VISIBLE));
	const hidden = $derived(newest.length - shown.length);
	$effect(() => {
		if (newest.length <= VISIBLE) expanded = false;
	});
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	let still = $state(false);

	onMount(() => {
		const q = matchMedia('(prefers-reduced-motion: reduce)');
		still = q.matches;
		const change = () => (still = q.matches);
		q.addEventListener('change', change);
		const stop = bell.start();
		return () => {
			q.removeEventListener('change', change);
			stop();
		};
	});

	// A captain's toast goes once its moment has passed (merged, answered).
	$effect(() => {
		void live.fleet;
		bell.prune();
	});
</script>

<section
	class="{expanded
		? 'pointer-events-auto'
		: 'pointer-events-none'} fixed top-16 right-4 z-50 flex max-h-[calc(100dvh-5rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto"
	aria-label="Ship’s bell alerts"
	aria-live="polite"
>
	{#each shown as t (t.alert.id)}
		<div
			animate:flip={{ duration: still ? 0 : 180 }}
			in:fly={{ x: still ? 0 : 24, duration: still ? 0 : 200 }}
			out:fly={{ x: still ? 0 : 24, duration: still ? 0 : 150 }}
		>
			<ToastCard toast={t} {token} />
		</div>
	{/each}
	{#if hidden > 0 || expanded}
		<button
			type="button"
			class="pointer-events-auto self-end rounded-md border border-foreground/20 bg-card px-3 py-1 text-xs font-medium text-card-foreground shadow-sm hover:bg-muted"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}>{expanded ? 'Show fewer' : `+${hidden} more`}</button
		>
	{/if}
</section>
