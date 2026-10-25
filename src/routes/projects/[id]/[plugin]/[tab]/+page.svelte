<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { projectTabHref, slotKey } from '$lib/plugins/keys';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';

	/**
	 * A project's plugin tab (a project.tab entry, such as the Docket Chart) as
	 * its own page: it fills the viewport below the header, beside a strip of
	 * the project's other tabs, and the page itself never scrolls.
	 */
	let { data } = $props();

	const id = $derived(page.params.id!);
	const key = $derived(`${page.params.plugin}/${page.params.tab}`);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === id));
	const name = $derived(project?.name ?? id);
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
	<nav
		class="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4 text-sm sm:px-6"
		aria-label="{name} views"
	>
		<span class="mr-2 truncate font-medium">{name}</span>
		<a
			href="/harbour?project={encodeURIComponent(id)}"
			class="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground"
			>Work</a
		>
		{#each tabs as e (e.key)}
			{@const on = e.key === entry?.key}
			<a
				href={projectTabHref(id, e)}
				aria-current={on ? 'page' : undefined}
				class="-mb-px border-b-2 px-3 py-2 {on
					? 'border-foreground font-medium'
					: 'border-transparent text-muted-foreground hover:text-foreground'}">{e.title}</a
			>
		{/each}
	</nav>

	{#if entry}
		<section class="flex min-h-0 flex-1 flex-col" aria-label={entry.title} data-slot="project.tab">
			<SlotContent {entry} now={live.now} fill />
		</section>
	{:else}
		<p class="px-4 py-10 text-muted-foreground sm:px-6">
			{name} has no “{key}” view. It may belong to a plugin that is off for this project.
		</p>
	{/if}
</main>
