<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { aliases } from '$lib/client/aliases.svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { clock } from '$lib/format';
	import { harbour, headline } from '$lib/harbour';
	import {
		BOARD_FILTERS,
		board as boardOf,
		boardFilterOf,
		boardHeadline,
		laneShows
	} from '$lib/harbourboard';
	import { projectLabels } from '$lib/projectnames';
	import type { TaskSummary } from '$lib/types';
	import { composerBus } from '$lib/components/firstmate/bus.svelte';
	import TaskSlideout from '$lib/components/firstmate/TaskSlideout.svelte';
	import HarbourBoard from '$lib/components/wh/harbour/HarbourBoard.svelte';
	import ProjectSlideout from '$lib/components/wh/harbour/ProjectSlideout.svelte';
	import MateHealthPill from '$lib/components/wh/mates/MateHealthPill.svelte';
	import PassageChart from '$lib/components/wh/PassageChart.svelte';
	import RadarBoard from '$lib/components/wh/RadarBoard.svelte';
	import { ChevronRight, LayoutGrid, Radar, Waypoints } from '@lucide/svelte';

	/**
	 * The Harbour: every project Firstmate looks after, at a glance. The Board view is one
	 * kanban for the fleet (HarbourBoard): the task states as columns, a lane per project,
	 * most pressing first, and projects with nothing on it folded into quiet waters. A
	 * lane's name slides the project out and a card slides the task out. The Passage and
	 * Radar views put every task on one chart, and the project switcher scopes them.
	 */

	const fleet = $derived(currentFleet());
	const view = $derived.by(() => {
		const v = page.url.searchParams.get('view');
		return v === 'passage' || v === 'radar' ? v : 'projects';
	});
	const scope = $derived(view === 'projects' ? null : page.url.searchParams.get('project'));
	const projects = $derived(fleet?.projects ?? []);
	const scoped = $derived(scope ? (projects.find((p) => p.id === scope) ?? null) : null);
	const allTasks = $derived(fleet?.tasks ?? []);
	const tasks = $derived(allTasks.filter((t) => !scope || t.projectId === scope));
	const report = $derived(harbour(tasks, live.now));
	const mates = $derived(fleet?.secondMates ?? []);

	// The Board view: a lane per project with work on the board, filtered from `?show=`.
	const board = $derived(boardOf(projects, allTasks, live.now));
	const labels = $derived(projectLabels(projects, aliases.names));
	const show = $derived(boardFilterOf(page.url.searchParams.get('show')));
	const shown = $derived(board.lanes.filter((l) => laneShows(l, show)));
	const head = $derived(boardHeadline(board.lanes));

	// Folded lanes and whether Landed shows are kept in this browser.
	const FOLDED_KEY = 'wheelhouse-harbour-folded';
	const LANDED_KEY = 'wheelhouse-harbour-landed';
	const folded = new SvelteSet<string>();
	let landed = $state(true);
	onMount(() => {
		try {
			for (const id of JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as string[])
				folded.add(id);
			landed = localStorage.getItem(LANDED_KEY) !== 'off';
		} catch {
			// storage unavailable or unreadable: every lane open, Landed on
		}
	});
	function keep(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
	function fold(ids: string[], on: boolean) {
		for (const id of ids) {
			if (on) folded.add(id);
			else folded.delete(id);
		}
		keep(FOLDED_KEY, JSON.stringify([...folded]));
	}
	const toggle = (id: string) => fold([id], !folded.has(id));

	// What is slid out over the board: a project, else a task.
	let slidProject = $state<string | null>(null);
	let slidTask = $state<string | null>(null);
	const openProject = $derived(
		slidProject ? (projects.find((p) => p.id === slidProject) ?? null) : null
	);
	const openLane = $derived(board.lanes.find((l) => l.project.id === slidProject) ?? null);
	const projectName = (id: string | null) =>
		id ? (labels.get(id)?.label ?? projects.find((p) => p.id === id)?.name ?? id) : null;
	function slideTask(id: string) {
		slidProject = null;
		slidTask = id;
	}
	function chat(t: TaskSummary) {
		slidTask = null;
		composerBus.pending = {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: projectName(t.projectId),
			url: null
		};
		goto('/');
	}

	const href = (q: Record<string, string | null>) => {
		const s = Object.entries(q)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
			.join('&');
		return s ? `/harbour?${s}` : '/harbour';
	};
	const viewHref = (v: string | null) => href({ project: scope, view: v });
	const VIEWS = [
		{ key: 'projects', label: 'Board', icon: LayoutGrid, v: null },
		{ key: 'passage', label: 'Passage', icon: Waypoints, v: 'passage' },
		{ key: 'radar', label: 'Radar', icon: Radar, v: 'radar' }
	];
</script>

<svelte:head><title>{scoped ? `${scoped.name} · ` : ''}Harbour · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<!-- The watch report is a flush panel band on a hairline, not a card; on the Radar it
	     shrinks to one line, so the board is the page. -->
	<header
		class="-mx-4 -mt-6 border-b border-hair bg-panel px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 {view ===
		'radar'
			? 'py-4'
			: 'py-6'}"
	>
		<div class="flex flex-wrap items-end justify-between {view === 'radar' ? 'gap-3' : 'gap-6'}">
			<div class="max-w-4xl">
				<p class="font-display text-base text-muted-foreground italic">
					{scoped ? scoped.name : 'Every project Firstmate looks after'}, watch report{fleet?.collectedAt
						? ` at ${clock(fleet.collectedAt)}`
						: ''}
				</p>
				{#if fleet?.collectedAt}
					<h1
						class="leading-tight text-balance {view === 'radar'
							? 'mt-1 text-xl'
							: 'mt-2 text-[2.1rem]'}"
						data-headline
					>
						{#if view === 'projects'}{#if head.you}<em class="text-gold">{head.you}</em
								>{'; '}{/if}{head.rest}{:else}{headline(report)}{/if}
					</h1>
				{:else}
					<h1 class="mt-2 text-[2.1rem] leading-tight text-balance text-muted-foreground">
						Waiting for the first read of Firstmate…
					</h1>
				{/if}
			</div>
			<div class="flex rounded-md border bg-card p-0.5 text-sm" role="tablist" aria-label="View">
				{#each VIEWS as v (v.key)}
					<a
						href={viewHref(v.v)}
						role="tab"
						aria-selected={view === v.key}
						class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 {view === v.key
							? 'bg-primary font-medium text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						><v.icon class="size-4" />{v.label}</a
					>
				{/each}
			</div>
		</div>

		{#if view === 'projects' && board.lanes.length}
			<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
				<div
					class="flex flex-wrap rounded-md border bg-card p-0.5 text-sm max-sm:w-full sm:inline-flex"
					role="tablist"
					aria-label="Show"
				>
					{#each [null, ...BOARD_FILTERS] as f (f?.key ?? 'all')}
						{@const on = show === (f?.key ?? null)}
						<a
							href={href({ show: f?.key ?? null })}
							role="tab"
							aria-selected={on}
							class="rounded-sm px-3 py-1.5 whitespace-nowrap {on
								? 'bg-primary font-medium text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
							>{f?.label ?? 'All'}
							<span class="tabular opacity-70"
								>{f
									? board.lanes.filter((l) => laneShows(l, f.key)).length
									: board.lanes.length}</span
							></a
						>
					{/each}
				</div>
				<div class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
					<label class="mr-2 inline-flex cursor-pointer items-center gap-2 select-none">
						<input
							type="checkbox"
							class="accent-gold"
							bind:checked={landed}
							onchange={() => keep(LANDED_KEY, landed ? 'on' : 'off')}
						/>
						Landed (last 24 h)
					</label>
					<button
						type="button"
						class="rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
						onclick={() =>
							fold(
								board.lanes.map((l) => l.project.id),
								true
							)}>Collapse all</button
					>
					<button
						type="button"
						class="rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
						onclick={() => fold([...folded], false)}>Expand all</button
					>
				</div>
			</div>
		{/if}
	</header>

	{#if view === 'passage'}
		<div class="surface mt-6 p-5 sm:p-6">
			<PassageChart {tasks} projects={scoped ? [scoped] : projects} />
		</div>
	{:else if view === 'radar'}
		<section class="surface mt-4 p-4 sm:p-5" aria-labelledby="radar">
			<h2 id="radar" class="section-label mb-3">Fleet radar</h2>
			<RadarBoard {tasks} {projects} now={live.now} connection={live.connection} />
		</section>
	{:else if fleet?.collectedAt && !projects.length}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
			No projects yet. Firstmate lists them in its project registry once you add one.
		</p>
	{:else}
		{#if shown.length}
			<HarbourBoard
				lanes={shown}
				{labels}
				now={live.now}
				{landed}
				collapsed={folded}
				onToggle={toggle}
				onProject={(id) => (slidProject = id)}
				onTask={slideTask}
			/>
		{:else if show && fleet?.collectedAt}
			<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
				No project matches {BOARD_FILTERS.find((f) => f.key === show)?.label.toLowerCase()} right now.
			</p>
		{/if}

		{#if mates.length}
			<!-- Second mates run crews of their own: a line each here, their work on their own page. -->
			<section class="mt-8" aria-labelledby="second-mates">
				<h2 id="second-mates" class="section-label mb-3">Second mates</h2>
				<ul class="surface divide-y divide-hair">
					{#each mates as m (m.id)}
						<li>
							<a
								href="/second-mates#mate-{encodeURIComponent(m.id)}"
								class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-accent/50"
								data-second-mate={m.id}
							>
								<span class="min-w-0 truncate font-display text-[1.15rem] sm:w-56">{m.id}</span>
								<MateHealthPill health={m.health} />
								<span class="min-w-0 flex-1 text-sm text-muted-foreground max-sm:basis-full">
									{m.stateLabel}: {m.inFlight.length} in flight, {m.queued.length} queued{m.captainDecisions
										? `, ${m.captainDecisions} waiting on you`
										: ''}{m.projects.length ? ` · ${m.projects.join(', ')}` : ''}
								</span>
								<ChevronRight
									class="size-4 text-muted-foreground max-sm:hidden"
									aria-hidden="true"
								/>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if board.quiet.length && !show}
			<!-- Projects with nothing on the board: a chip each, which slides the project out. -->
			<section class="mt-8" aria-labelledby="quiet">
				<h2 id="quiet" class="section-label mb-3">
					Quiet waters · {board.quiet.length}
					{board.quiet.length === 1 ? 'project' : 'projects'} with nothing open
				</h2>
				<div class="flex flex-wrap gap-2">
					{#each board.quiet as p (p.id)}
						{@const l = labels.get(p.id)}
						<a
							href="/projects/{encodeURIComponent(p.id)}"
							class="inline-flex items-center gap-2 rounded-lg border bg-card py-1 pr-3 pl-1 text-sm hover:border-gold"
							title={l?.full ?? p.name}
							data-quiet-project={p.id}
							onclick={(e) => {
								if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
								e.preventDefault();
								slidProject = p.id;
							}}
						>
							<span
								class="project-tile size-6! text-[0.6rem]!"
								data-hue={l?.hue ?? 0}
								aria-hidden="true">{l?.monogram ?? '?'}</span
							>{l?.label ?? p.name}</a
						>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</main>

<ProjectSlideout
	project={openProject}
	lane={openLane}
	label={slidProject ? labels.get(slidProject) : undefined}
	now={live.now}
	onClose={() => (slidProject = null)}
	onTask={slideTask}
/>
<TaskSlideout
	taskId={slidTask}
	tasks={allTasks}
	project={projectName(allTasks.find((t) => t.id === slidTask)?.projectId ?? null)}
	onClose={() => (slidTask = null)}
	onChat={chat}
/>
