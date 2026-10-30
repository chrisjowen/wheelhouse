<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import ProjectBanner from '$lib/components/wh/harbour/ProjectBanner.svelte';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';

	/**
	 * A project's plugin tab (a project.tab entry, such as the Docket Chart) as
	 * its own page: it fills the viewport below the header, under the project's
	 * one-line row of tabs, and the page itself never scrolls.
	 */
	let { data } = $props();

	const id = $derived(page.params.id!);
	const key = $derived(`${page.params.plugin}/${page.params.tab}`);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === id));
	const name = $derived(project?.name ?? id);
	const tasks = $derived((currentFleet()?.tasks ?? []).filter((t) => t.projectId === id));
	const tabs = $derived(
		slots
			.entries(slotKey.project(id), data.slots, data.slotsAt)
			.filter((e) => e.slot === 'project.tab')
	);
	const entry = $derived(tabs.find((e) => `${e.pluginId}/${e.contributionId}` === key) ?? null);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.project(id), data.slotsAt);
	});
</script>

<svelte:head><title>{entry ? `${entry.title} · ` : ''}{name} · Wheelhouse</title></svelte:head>

<main class="flex min-h-0 flex-1 flex-col">
	<ProjectBanner
		{id}
		project={project ?? null}
		{tasks}
		{tabs}
		repo={data.repo}
		current={entry?.key ?? ''}
		now={live.now}
		compact
	/>

	{#if entry}
		<section class="flex min-h-0 flex-1 flex-col" aria-label={entry.title} data-slot="project.tab">
			<SlotContent {entry} now={live.now} fill />
		</section>
	{:else}
		<p class="surface mx-4 my-6 max-w-3xl p-6 text-muted-foreground sm:mx-6">
			{name} has no “{key}” view. It may belong to a plugin that is off for this project.
		</p>
	{/if}
</main>
