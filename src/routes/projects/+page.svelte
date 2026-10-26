<script lang="ts">
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { rememberView } from '$lib/client/view';
	import { projectTabHref, slotKey } from '$lib/plugins/keys';
	import {
		projectStats,
		VIEW_COOKIE,
		type ProjectColumn,
		type ProjectLink,
		type ProjectsView,
		type Sort
	} from '$lib/views';
	import ProjectCard from '$lib/components/wh/views/ProjectCard.svelte';
	import ProjectTable from '$lib/components/wh/views/ProjectTable.svelte';
	import ViewToggle from '$lib/components/wh/views/ViewToggle.svelte';
	import type { Project } from '$lib/types';
	import { Grid2x2, List } from '@lucide/svelte';

	let { data } = $props();

	const fleet = $derived(currentFleet());
	const projects = $derived(fleet?.projects ?? []);
	const tasks = $derived(fleet?.tasks ?? []);
	const tasksOf = (p: Project) => tasks.filter((t) => t.projectId === p.id);
	const statsById = $derived(
		new Map(projects.map((p) => [p.id, projectStats(tasksOf(p), live.now)]))
	);
	const stats = (p: Project) => statsById.get(p.id) ?? projectStats([], live.now);
	const total = $derived(
		[...statsById.values()].reduce(
			(a, s) => ({
				underWay: a.underWay + s.underWay,
				needsYou: a.needsYou + s.needsYou,
				landed: a.landed + s.landed
			}),
			{ underWay: 0, needsYou: 0, landed: 0 }
		)
	);
	const named = $derived(projects.filter((p) => p.id !== 'unassigned').length);

	// Cards or a list, remembered per browser.
	let picked = $state<ProjectsView | null>(null);
	const layout = $derived(picked ?? data.layout);
	const LAYOUTS = [
		{ value: 'cards' as const, label: 'Cards', icon: Grid2x2 },
		{ value: 'list' as const, label: 'List', icon: List }
	];
	function pickLayout(v: ProjectsView) {
		picked = v;
		rememberView(VIEW_COOKIE.projects, v);
	}
	let sort = $state<Sort<ProjectColumn>>({ key: 'name', dir: 'asc' });

	// Each project's own pages: its Harbour, its passage (and editor), plugin tabs, repository.
	const tabs = (p: Project) =>
		slots
			.entries(slotKey.project(p.id), data.slots, data.slotsAt)
			.filter((e) => e.slot === 'project.tab');
	$effect(() => {
		void live.revision;
		for (const p of projects) slots.refresh(slotKey.project(p.id), data.slotsAt);
	});
	function links(p: Project): ProjectLink[] {
		const id = encodeURIComponent(p.id);
		const out: ProjectLink[] = [{ href: `/harbour?project=${id}`, label: 'Harbour' }];
		if (p.id !== 'unassigned') {
			out.push({
				href: `/projects/${id}/passage`,
				label: p.passage?.problems
					? 'Passage has problems'
					: p.passage?.needsConsent
						? 'Passage checks need enabling'
						: 'Passage',
				emphasis: p.passage?.problems ? 'danger' : p.passage?.needsConsent ? 'sea' : undefined
			});
			out.push({ href: `/projects/${id}/passage/edit`, label: 'Edit passage' });
		}
		for (const e of tabs(p)) out.push({ href: projectTabHref(p.id, e), label: e.title });
		const repo = data.repos[p.id];
		if (repo) out.push({ href: repo, label: 'Repository', external: true });
		return out;
	}
	const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
</script>

<svelte:head><title>Projects · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<header class="surface px-5 py-6 sm:px-6">
		<div class="flex flex-wrap items-end justify-between gap-6">
			<div class="max-w-3xl">
				<p class="font-display text-base text-muted-foreground italic">
					Every project Firstmate looks after
				</p>
				{#if fleet?.collectedAt}
					<h1 class="mt-2 text-[2.1rem] leading-tight text-balance">
						{n(named, 'project', 'projects')}. {total.needsYou
							? `${n(total.needsYou, 'thing needs', 'things need')} you, `
							: 'Nothing needs you, '}{total.underWay} under way, {total.landed} landed this week.
					</h1>
				{:else}
					<h1 class="mt-2 text-[2.1rem] leading-tight text-balance text-muted-foreground">
						Waiting for the first read of Firstmate…
					</h1>
				{/if}
			</div>
			<ViewToggle options={LAYOUTS} value={layout} onchange={pickLayout} label="Layout" />
		</div>
	</header>

	{#if fleet?.collectedAt && !projects.length}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
			No projects yet. Firstmate lists them in its project registry once you add one.
		</p>
	{:else if layout === 'list'}
		<div class="mt-6">
			<ProjectTable {projects} {stats} {links} {sort} onsort={(s) => (sort = s)} now={live.now} />
		</div>
	{:else}
		<div class="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{#each projects as p (p.id)}
				<ProjectCard
					project={p}
					tasks={tasksOf(p)}
					stats={stats(p)}
					links={links(p)}
					now={live.now}
				/>
			{/each}
		</div>
	{/if}
</main>
