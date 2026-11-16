<script lang="ts">
	import { currentFleet, live } from '$lib/client/live.svelte';
	import SecondMateCard from '$lib/components/wh/mates/SecondMateCard.svelte';
	import { Plus } from '@lucide/svelte';

	let { data: setup } = $props<{ data: { hostedSecondMates: boolean } }>();

	/**
	 * Second mates: every Firstmate the captain's Firstmate runs, on this
	 * computer or on another host, each with its health, projects, work in
	 * flight and queued, pull requests and what landed, and a read-only look at
	 * it on request. Their questions are cards in Decisions. They are never task
	 * cards under Under way.
	 */
	const fleet = $derived(currentFleet());
	const mates = $derived(fleet?.secondMates ?? []);
	const omitted = $derived(fleet?.secondMatesOmitted ?? 0);
</script>

<svelte:head><title>Second mates · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl">Second mates</h1>
			<p class="mt-1 max-w-3xl text-sm text-muted-foreground">
				Each second mate runs its own crew, on this computer or another host. This is what
				Firstmate’s last fleet snapshot says of each; their questions are in Decisions.
			</p>
		</div>
		{#if setup.hostedSecondMates}
			<a
				href="/second-mates/add"
				class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90"
				aria-label="Add a second mate"
			>
				<Plus class="size-4" aria-hidden="true" /> Add second mate
			</a>
		{/if}
	</div>
	{#if fleet?.stale && fleet.staleReason}
		<p class="mt-3 text-sm text-warning">{fleet.staleReason}</p>
	{/if}
	{#if mates.length}
		<div class="mt-6 flex flex-col gap-6">
			{#each mates as m (m.id)}
				<SecondMateCard mate={m} now={live.now} />
			{/each}
		</div>
		{#if omitted}
			<p class="mt-4 text-sm text-muted-foreground">
				Firstmate’s snapshot leaves out {omitted} more {omitted === 1
					? 'second mate'
					: 'second mates'}.
			</p>
		{/if}
	{:else if fleet?.collectedAt}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">Firstmate runs no second mates.</p>
	{:else}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6" aria-busy="true">Reading Firstmate…</p>
	{/if}
</main>
