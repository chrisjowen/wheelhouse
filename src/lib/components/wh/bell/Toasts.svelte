<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { page } from '$app/state';
	import { bell } from '$lib/client/bell.svelte';
	import { live } from '$lib/client/live.svelte';
	import ToastCard from './ToastCard.svelte';

	// The ship's bell's toasts, newest at the bottom, over every page.
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
	class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
	aria-label="Ship’s bell alerts"
	aria-live="polite"
>
	{#each bell.toasts as t (t.alert.id)}
		<div
			animate:flip={{ duration: still ? 0 : 180 }}
			in:fly={{ x: still ? 0 : 24, duration: still ? 0 : 200 }}
			out:fly={{ x: still ? 0 : 24, duration: still ? 0 : 150 }}
		>
			<ToastCard toast={t} {token} />
		</div>
	{/each}
</section>
