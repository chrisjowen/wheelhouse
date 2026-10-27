<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { projectTabHref, slotKey } from '$lib/plugins/keys';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { clock } from '$lib/format';
	import { harbour, headline, shelf, shelfOf } from '$lib/harbour';
	import MoveCard from '$lib/components/wh/MoveCard.svelte';
	import PassageChart from '$lib/components/wh/PassageChart.svelte';
	import RadarBoard from '$lib/components/wh/RadarBoard.svelte';
	import TaskCard from '$lib/components/wh/TaskCard.svelte';
	import CompactCard from '$lib/components/wh/views/CompactCard.svelte';
	import TaskTable from '$lib/components/wh/views/TaskTable.svelte';
	import ViewToggle from '$lib/components/wh/views/ViewToggle.svelte';
	import { rememberView } from '$lib/client/view';
	import { VIEW_COOKIE, type BoardView, type Sort, type TaskColumn } from '$lib/views';
	import type { Snippet } from 'svelte';
	import type { Project, TaskSummary } from '$lib/types';
	import { Grid3x3, LayoutGrid, List, Radar, RectangleHorizontal, Waypoints } from '@lucide/svelte';

	let { data } = $props();

	const fleet = $derived(currentFleet());
	const view = $derived.by(() => {
		const v = page.url.searchParams.get('view');
		return v === 'passage' || v === 'radar' ? v : 'cards';
	});
	// Under way | Completed (?view=completed) on the Harbour view; Passage and Radar show everything.
	const showing = $derived(shelfOf(page.url.searchParams.get('view')));
	const scope = $derived(page.url.searchParams.get('project'));
	const projects = $derived(fleet?.projects ?? []);
	const scoped = $derived(scope ? (projects.find((p) => p.id === scope) ?? null) : null);
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope));
	const report = $derived(harbour(tasks, live.now));
	const open = $derived(shelf(tasks, 'under-way'));
	const h = $derived(harbour(open, live.now));
	const completed = $derived(shelf(tasks, 'completed'));
	const projectName = (t: TaskSummary) =>
		scope ? null : (projects.find((p) => p.id === t.projectId)?.name ?? t.projectId);
	const nameOf = (t: TaskSummary) =>
		projects.find((p) => p.id === t.projectId)?.name ?? t.projectId;

	// Large cards, compact cards or a list: remembered per browser, the same sections in each.
	let picked = $state<BoardView | null>(null);
	const layout = $derived(picked ?? data.layout);
	const LAYOUTS = [
		{ value: 'large' as const, label: 'Large', icon: RectangleHorizontal },
		{ value: 'compact' as const, label: 'Compact', icon: Grid3x3 },
		{ value: 'list' as const, label: 'List', icon: List }
	];
	function pickLayout(v: BoardView) {
		picked = v;
		rememberView(VIEW_COOKIE.harbour, v);
	}
	// One sort for every list on the page, most pressing first until a column is picked.
	let sort = $state<Sort<TaskColumn>>({ key: 'status', dir: 'asc' });

	// Plugin entries per project: project.tab (each its own page, linked from the project's
	// header and the scoped view's tabs) and harbour.card.
	const entries = (p: Project) => slots.entries(slotKey.project(p.id), data.slots, data.slotsAt);
	const tabs = (p: Project) => entries(p).filter((e) => e.slot === 'project.tab');
	const cards = (p: Project) => entries(p).filter((e) => e.slot === 'harbour.card');
	const tabHref = (p: Project, e: SlotEntry) => projectTabHref(p.id, e);
	$effect(() => {
		void live.revision;
		for (const p of scoped ? [scoped] : projects)
			slots.refresh(slotKey.project(p.id), data.slotsAt);
	});

	// A project section header is an ordered list of parts, so later slots can add entries.
	type HeaderPart = { id: string; render: Snippet<[Project]> };
	const headerParts = (p: Project): HeaderPart[] =>
		[
			{ id: 'name', render: projectName_, show: true },
			{ id: 'description', render: projectDescription, show: !!p.description },
			{ id: 'tabs', render: projectTabs, show: tabs(p).length > 0 },
			{ id: 'passage', render: projectPassage, show: p.id !== 'unassigned' },
			{ id: 'path', render: projectPath, show: !!p.path }
		].filter((x) => x.show);

	let showOlder = $state(false);
	const href = (v: string | null) => {
		const q = [
			scope ? `project=${encodeURIComponent(scope)}` : null,
			v ? `view=${encodeURIComponent(v)}` : null
		].filter(Boolean);
		return q.length ? `/harbour?${q.join('&')}` : '/harbour';
	};
</script>

<svelte:head><title>{scoped ? `${scoped.name} · ` : ''}Harbour · Wheelhouse</title></svelte:head>

<!-- A group of tasks in the chosen layout; Large keeps the full cards (and Your move's action cards). -->
{#snippet board(list: TaskSummary[], label: string, kind: 'task' | 'move' | 'named' = 'task')}
	{#if layout === 'list'}
		<TaskTable
			tasks={list}
			projectName={nameOf}
			{sort}
			onsort={(s) => (sort = s)}
			now={live.now}
			{label}
		/>
	{:else if layout === 'compact'}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
			{#each list as t (t.id)}<CompactCard task={t} projectName={nameOf(t)} />{/each}
		</div>
	{:else if kind === 'move'}
		<div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
			{#each list as t (t.id)}<MoveCard task={t} projectName={projectName(t)} />{/each}
		</div>
	{:else}
		<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
			{#each list as t (t.id)}<TaskCard
					task={t}
					projectName={kind === 'named' ? projectName(t) : null}
				/>{/each}
		</div>
	{/if}
{/snippet}

{#snippet work(list: TaskSummary[])}
	{@const under = h.underWay.filter((t) => list.includes(t))}
	{@const queued = h.queued.filter((t) => list.includes(t))}
	{@const landed = h.landedRecent.filter((t) => list.includes(t))}
	{@const older = h.landedOlder.filter((t) => list.includes(t))}
	{#if under.length}
		<h3 class="section-label mb-3">
			Under way <span class="tabular">{under.length}</span>
		</h3>
		{@render board(under, 'Under way')}
	{/if}
	{#if queued.length}
		<p class="mt-4 text-sm text-muted-foreground">
			Queued next: {#each queued as t, i (t.id)}<a
					class="hover:text-foreground hover:underline"
					href="/tasks/{encodeURIComponent(t.id)}">{t.shortTitle}</a
				>{i < queued.length - 1 ? ', ' : '.'}{/each}
		</p>
	{/if}
	{#if landed.length || (showOlder && older.length)}
		<h3 class="section-label mt-8 mb-3">
			Landed <span class="tabular">{landed.length + (showOlder ? older.length : 0)}</span>
		</h3>
		{@render board(showOlder ? [...landed, ...older] : landed, 'Landed')}
	{/if}
	{#if older.length && !showOlder}
		<button
			class="mt-4 text-sm text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => (showOlder = true)}
		>
			Show {older.length} older landed {older.length === 1 ? 'task' : 'tasks'}
		</button>
	{/if}
	{#if !under.length && !queued.length && !landed.length && !older.length}
		<p class="text-sm text-muted-foreground">Nothing else in harbour right now.</p>
	{/if}
{/snippet}

{#snippet done(list: TaskSummary[])}
	{@render board(list, 'Completed')}
{/snippet}

{#snippet projectName_(p: Project)}
	<a href="/?project={encodeURIComponent(p.id)}" class="hover:underline">
		<h2 id="proj-{p.id}" class="font-display text-[1.45rem] font-medium">{p.name}</h2>
	</a>
{/snippet}

{#snippet projectDescription(p: Project)}
	<span class="text-sm text-muted-foreground">{p.description}</span>
{/snippet}

{#snippet projectTabs(p: Project)}
	<span class="flex flex-wrap gap-1.5" data-slot="project.tab">
		{#each tabs(p) as e (e.key)}
			<a
				href={tabHref(p, e)}
				class="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>{e.title}</a
			>
		{/each}
	</span>
{/snippet}

{#snippet harbourCards(p: Project)}
	{@const list = cards(p)}
	{#if list.length}
		<div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
			{#each list as e (e.key)}
				<div class="min-w-0 rounded-xl border bg-card px-4 py-3" data-slot="harbour.card">
					<p class="mb-2 text-xs font-medium text-muted-foreground">{e.title}</p>
					<SlotContent entry={e} now={live.now} />
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet scopedTabs(p: Project)}
	{@const list = tabs(p)}
	{#if list.length}
		<nav class="mt-8 flex gap-1 border-b text-sm" aria-label="{p.name} views">
			<a
				href={href(null)}
				aria-current="page"
				class="-mb-px border-b-2 border-foreground px-3 py-2 font-medium">Work</a
			>
			{#each list as e (e.key)}
				<a
					href={tabHref(p, e)}
					class="-mb-px border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground"
					>{e.title}</a
				>
			{/each}
		</nav>
	{/if}
{/snippet}

{#snippet projectPassage(p: Project)}
	<!-- How the project's passage is defined; problems and pending consent are said plainly. -->
	<a
		href="/projects/{encodeURIComponent(p.id)}/passage"
		class="text-sm hover:underline {p.passage?.problems
			? 'text-danger'
			: p.passage?.needsConsent
				? 'text-sea'
				: 'text-muted-foreground'}"
		>{p.passage?.problems
			? 'Passage file has problems'
			: p.passage?.needsConsent
				? 'Passage checks need enabling'
				: p.passage?.custom
					? 'Custom passage'
					: 'Passage'}</a
	>
{/snippet}

{#snippet projectPath(p: Project)}
	<span class="ml-auto truncate font-mono text-xs text-muted-foreground">{p.path}</span>
{/snippet}

{#snippet section(p: Project, list: TaskSummary[])}
	<section class="surface mt-6 p-5 sm:p-6" aria-labelledby="proj-{p.id}">
		<div class="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			{#each headerParts(p) as part (part.id)}{@render part.render(p)}{/each}
		</div>
		{@render harbourCards(p)}
		{@render work(list)}
	</section>
{/snippet}

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<!-- On the Radar the watch report shrinks to one line, so the board is the page. Like
	     the home page's On deck, the report is a flush panel band on a hairline, not a card. -->
	<header
		class="-mx-4 -mt-6 border-b border-hair bg-panel px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 {view ===
		'radar'
			? 'py-4'
			: 'py-6'}"
	>
		<div class="flex flex-wrap items-end justify-between {view === 'radar' ? 'gap-3' : 'gap-6'}">
			<div class="max-w-3xl">
				<p class="font-display text-base text-muted-foreground italic">
					{scoped ? scoped.name : 'All projects'}, watch report{fleet?.collectedAt
						? ` at ${clock(fleet.collectedAt)}`
						: ''}{#if scoped && scoped.id !== 'unassigned'}&nbsp;·&nbsp;{@render projectPassage(
							scoped
						)}{/if}
				</p>
				{#if fleet?.collectedAt}
					<h1
						class="leading-tight text-balance {view === 'radar'
							? 'mt-1 text-xl'
							: 'mt-2 text-[2.1rem]'}"
					>
						{headline(report)}
					</h1>
				{:else}
					<h1 class="mt-2 text-[2.1rem] leading-tight text-balance text-muted-foreground">
						Waiting for the first read of Firstmate…
					</h1>
				{/if}
			</div>
			<div class="flex rounded-md border bg-card p-0.5 text-sm" role="tablist" aria-label="View">
				<a
					href={href(null)}
					role="tab"
					aria-selected={view === 'cards'}
					class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 {view === 'cards'
						? 'bg-primary font-medium text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					><LayoutGrid class="size-4" />Harbour</a
				>
				<a
					href={href('passage')}
					role="tab"
					aria-selected={view === 'passage'}
					class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 {view === 'passage'
						? 'bg-primary font-medium text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"><Waypoints class="size-4" />Passage</a
				>
				<a
					href={href('radar')}
					role="tab"
					aria-selected={view === 'radar'}
					class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 {view === 'radar'
						? 'bg-primary font-medium text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"><Radar class="size-4" />Radar</a
				>
			</div>
		</div>

		{#if scoped && view === 'cards'}{@render scopedTabs(scoped)}{/if}

		{#if view === 'cards'}
			<div class="mt-8 flex flex-wrap items-center justify-between gap-3">
				<div
					class="flex rounded-md border bg-card p-0.5 text-sm max-sm:w-full"
					role="tablist"
					aria-label="Show"
				>
					{#each [['under-way', 'Under way', null], ['completed', 'Completed', 'completed']] as [s, label, v] (s)}
						<a
							href={href(v)}
							role="tab"
							aria-selected={showing === s}
							class="flex-1 rounded-sm px-3 py-1.5 text-center whitespace-nowrap {showing === s
								? 'bg-primary font-medium text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground'}">{label}</a
						>
					{/each}
				</div>
				<ViewToggle options={LAYOUTS} value={layout} onchange={pickLayout} label="Layout" />
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
	{:else if showing === 'completed'}
		{#if scoped}
			<section class="surface mt-6 p-5 sm:p-6">{@render done(completed)}</section>
		{:else}
			{#each projects as p (p.id)}
				{@const list = completed.filter((t) => t.projectId === p.id)}
				{#if list.length}
					<section class="surface mt-6 p-5 sm:p-6" aria-labelledby="proj-{p.id}">
						<div class="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
							{#each headerParts(p) as part (part.id)}{@render part.render(p)}{/each}
						</div>
						{@render done(list)}
					</section>
				{/if}
			{/each}
		{/if}
		{#if fleet?.collectedAt && !completed.length}
			<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
				Nothing completed{scoped ? ' in this project' : ''} yet.
			</p>
		{/if}
	{:else}
		{#if h.needsYou.length}
			<section class="surface mt-6 p-5 sm:p-6" aria-labelledby="your-move">
				<h2 id="your-move" class="section-label mb-4 text-sea">Your move</h2>
				{@render board(h.needsYou, 'Your move', 'move')}
			</section>
		{/if}

		{#if h.waitingOnFirstmate.length}
			<section class="surface mt-6 p-5 sm:p-6" aria-labelledby="with-firstmate">
				<h2 id="with-firstmate" class="section-label">Waiting on Firstmate</h2>
				<p class="mt-1 mb-4 text-sm text-muted-foreground">
					A worker raised a decision. Firstmate handles it first and brings it to you if it needs
					you.
				</p>
				{@render board(h.waitingOnFirstmate, 'Waiting on Firstmate', 'named')}
			</section>
		{/if}

		{#if scoped}
			<section class="surface mt-6 p-5 sm:p-6">
				{@render harbourCards(scoped)}{@render work(open)}
			</section>
		{:else}
			{#each projects as p (p.id)}
				{@const list = open.filter((t) => t.projectId === p.id)}
				{#if list.some((t) => !h.needsYou.includes(t) && !h.waitingOnFirstmate.includes(t))}
					{@render section(p, list)}
				{/if}
			{/each}
		{/if}
		{#if fleet?.collectedAt && !open.length}
			<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
				Nothing under way{scoped ? ' in this project' : ''} right now.
			</p>
		{/if}
	{/if}
</main>
