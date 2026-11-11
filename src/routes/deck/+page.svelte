<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { railInsights } from '$lib/client/insights.svelte';
	import Rail from '$lib/components/firstmate/Rail.svelte';

	/**
	 * On deck on its own page: the phone's "Needs you" tab. On a wider screen the
	 * same rail docks beside the chat on the home page (or opens there as a sheet).
	 * "Chat about this" goes to the chat, where the composer picks up the task.
	 */
	let { data } = $props();

	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope));
	const cards = $derived(
		slots.entries(slotKey.fleet, data.slots, data.slotsAt).filter((e) => e.slot === 'home.card')
	);
	$effect(() => railInsights.seed(data.insights));
	const insights = $derived(railInsights.value ?? data.insights);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, data.slotsAt);
	});

	onMount(() => railInsights.connect());
</script>

<svelte:head><title>On deck · Wheelhouse</title></svelte:head>

<main class="flex min-h-0 flex-1 flex-col bg-panel">
	<Rail
		{tasks}
		projects={fleet?.projects ?? []}
		secondMates={fleet?.secondMates ?? []}
		now={live.now}
		{insights}
		{scope}
		{cards}
		onChat={() => void goto(scope ? `/?project=${encodeURIComponent(scope)}` : '/')}
	/>
</main>
