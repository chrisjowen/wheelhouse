<script lang="ts">
	import { page } from '$app/state';
	import { aliases } from '$lib/client/aliases.svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import {
		ACTIVITY_DAYS,
		berth,
		byAttention,
		dayCounts,
		FILTERS,
		fleetHeadline,
		shows,
		STATE_WORDS,
		stateOf,
		type ProjectState
	} from '$lib/berths';
	import { ago, clock } from '$lib/format';
	import { harbour, headline } from '$lib/harbour';
	import { projectLabels } from '$lib/projectnames';
	import ActivityPulse from '$lib/components/wh/harbour/ActivityPulse.svelte';
	import ProjectBerth from '$lib/components/wh/harbour/ProjectBerth.svelte';
	import PassageChart from '$lib/components/wh/PassageChart.svelte';
	import RadarBoard from '$lib/components/wh/RadarBoard.svelte';
	import { ChevronRight, LayoutGrid, Radar, Waypoints } from '@lucide/svelte';

	/**
	 * The Harbour: every project Firstmate looks after, at a glance. The Projects view
	 * gives each busy project a card (most pressing first) and folds quiet ones into a
	 * short list; a card opens the project's own page, where its work is. The Passage and
	 * Radar views put every task on one chart, and the project switcher scopes them.
	 */
	let { data } = $props();

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

	// The Projects view: one berth per project, filtered by state from `?show=`.
	const berths = $derived(
		byAttention(
			projects.map((p) =>
				berth(
					p,
					allTasks.filter((t) => t.projectId === p.id),
					live.now
				)
			)
		)
	);
	const labels = $derived(projectLabels(projects, aliases.names));
	const show = $derived(stateOf(page.url.searchParams.get('show')));
	const shown = $derived(berths.filter((b) => shows(b.state, show)));
	const busy = $derived(shown.filter((b) => b.state !== 'quiet'));
	const quiet = $derived(shown.filter((b) => b.state === 'quiet'));
	const counts = $derived(
		Object.fromEntries(
			FILTERS.map((s) => [s, berths.filter((b) => shows(b.state, s)).length])
		) as Record<ProjectState, number>
	);

	const href = (q: Record<string, string | null>) => {
		const s = Object.entries(q)
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
			.join('&');
		return s ? `/harbour?${s}` : '/harbour';
	};
	const viewHref = (v: string | null) => href({ project: scope, view: v });
	const VIEWS = [
		{ key: 'projects', label: 'Projects', icon: LayoutGrid, v: null },
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
			<div class="max-w-3xl">
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
					>
						{view === 'projects' ? fleetHeadline(berths) : headline(report)}
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

		{#if view === 'projects' && berths.length}
			<div
				class="mt-6 flex flex-wrap rounded-md border bg-card p-0.5 text-sm max-sm:w-full sm:inline-flex"
				role="tablist"
				aria-label="Show"
			>
				{#each [null, ...FILTERS] as s (s ?? 'all')}
					<a
						href={href({ show: s })}
						role="tab"
						aria-selected={show === s}
						class="rounded-sm px-3 py-1.5 whitespace-nowrap {show === s
							? 'bg-primary font-medium text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						>{s ? STATE_WORDS[s] : 'All'}
						<span class="tabular opacity-70">{s ? counts[s] : berths.length}</span></a
					>
				{/each}
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
		{#if busy.length}
			<div class="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
				{#each busy as b (b.project.id)}
					<ProjectBerth
						berth={b}
						label={labels.get(b.project.id)}
						commits={data.commits[b.project.id] ?? null}
						now={live.now}
					/>
				{/each}
			</div>
		{:else if show && !quiet.length && fleet?.collectedAt}
			<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
				No project is {STATE_WORDS[show].toLowerCase()} right now.
			</p>
		{/if}

		{#if quiet.length}
			<!-- Projects with nothing open: a line each, so the cards stay for what is happening. -->
			<section class="mt-8" aria-labelledby="quiet">
				<h2 id="quiet" class="section-label mb-3">Quiet waters</h2>
				<ul class="surface divide-y divide-hair">
					{#each quiet as b (b.project.id)}
						{@const l = labels.get(b.project.id)}
						{@const last = b.lastLanded}
						<li>
							<a
								href="/projects/{encodeURIComponent(b.project.id)}"
								class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-accent/50"
								data-project={b.project.id}
							>
								{#if l}<span class="project-tile" data-hue={l.hue} aria-hidden="true"
										>{l.monogram}</span
									>{/if}
								<span class="min-w-0 truncate font-display text-[1.15rem] sm:w-56" title={l?.full}
									>{l?.label ?? b.project.name}</span
								>
								<span class="min-w-0 flex-1 text-sm text-muted-foreground max-sm:basis-full">
									Nothing under way.
									{#if last && b.landings[0]}Last landed {ago(
											new Date(b.landings[0]).toISOString(),
											live.now
										)}: {last.shortTitle}.{:else}No work yet.{/if}
								</span>
								<span class="max-sm:hidden">
									<ActivityPulse
										commits={data.commits[b.project.id] ?? null}
										landed={dayCounts(b.landings, live.now, ACTIVITY_DAYS)}
									/>
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
	{/if}
</main>
