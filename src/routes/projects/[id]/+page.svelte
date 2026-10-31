<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { shelfOf } from '$lib/harbour';
	import { slotKey } from '$lib/plugins/keys';
	import ProjectBanner from '$lib/components/wh/harbour/ProjectBanner.svelte';
	import WorkBoard from '$lib/components/wh/harbour/WorkBoard.svelte';

	/**
	 * One project's page, opened from its card on the Harbour: the banner with its state
	 * and its tabs (its work here, each plugin's tab, its passage, its repository), and
	 * its work under way or completed.
	 */
	let { data } = $props();

	const id = $derived(page.params.id!);
	const base = $derived(`/projects/${encodeURIComponent(id)}`);
	const fleet = $derived(currentFleet());
	const project = $derived(fleet?.projects.find((p) => p.id === id) ?? null);
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => t.projectId === id));
	const entries = $derived(slots.entries(slotKey.project(id), data.slots, data.slotsAt));
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.project(id), data.slotsAt);
	});
	const showing = $derived(shelfOf(page.url.searchParams.get('view')));
</script>

<svelte:head><title>{project?.name ?? id} · Harbour · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<ProjectBanner
		{id}
		{project}
		{tasks}
		tabs={entries.filter((e) => e.slot === 'project.tab')}
		repo={data.repo}
		current="work"
		now={live.now}
	/>

	{#if fleet?.collectedAt && !project}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
			Firstmate has no project called “{id}”. Its projects are all on the
			<a href="/harbour" class="underline hover:text-foreground">Harbour</a>.
		</p>
	{:else}
		<div class="mt-6">
			<WorkBoard
				{tasks}
				projectName={project?.name ?? id}
				cards={entries.filter((e) => e.slot === 'harbour.card')}
				layout={data.layout}
				{showing}
				shelfHref={(s) => (s === 'completed' ? `${base}?view=completed` : base)}
				collected={!!fleet?.collectedAt}
			/>
		</div>
	{/if}
</main>
