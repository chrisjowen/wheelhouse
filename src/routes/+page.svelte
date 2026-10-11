<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { clock } from '$lib/format';
	import { harbour, headline } from '$lib/harbour';
	import MoveCard from '$lib/components/wh/MoveCard.svelte';
	import PassageChart from '$lib/components/wh/PassageChart.svelte';
	import TaskCard from '$lib/components/wh/TaskCard.svelte';
	import type { Snippet } from 'svelte';
	import type { Project, TaskSummary } from '$lib/types';
	import { LayoutGrid, Waypoints } from '@lucide/svelte';

	let { data } = $props();

	const fleet = $derived(currentFleet());
	const view = $derived(page.url.searchParams.get('view') === 'passage' ? 'passage' : 'cards');
	const scope = $derived(page.url.searchParams.get('project'));
	const projects = $derived(fleet?.projects ?? []);
	const scoped = $derived(scope ? (projects.find((p) => p.id === scope) ?? null) : null);
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope));
	const h = $derived(harbour(tasks, live.now));
	const projectName = (t: TaskSummary) =>
		scope ? null : (projects.find((p) => p.id === t.projectId)?.name ?? t.projectId);

	// Plugin entries per project: project.tab (tabs on the scoped view) and harbour.card.
	const entries = (p: Project) => slots.entries(slotKey.project(p.id), data.slots, data.slotsAt);
	const tabs = (p: Project) => entries(p).filter((e) => e.slot === 'project.tab');
	const cards = (p: Project) => entries(p).filter((e) => e.slot === 'harbour.card');
	const tabId = (e: SlotEntry) => `${e.pluginId}/${e.contributionId}`;
	const tab = $derived(page.url.searchParams.get('tab'));
	const openTab = $derived(
		scoped && view === 'cards' && tab ? (tabs(scoped).find((e) => tabId(e) === tab) ?? null) : null
	);
	const tabHref = (p: Project, e: SlotEntry) =>
		`/?project=${encodeURIComponent(p.id)}&tab=${encodeURIComponent(tabId(e))}`;
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
			{ id: 'path', render: projectPath, show: !!p.path }
		].filter((x) => x.show);

	let showOlder = $state(false);
	const href = (v: string | null) => {
		const q = [
			scope ? `project=${encodeURIComponent(scope)}` : null,
			v ? `view=${encodeURIComponent(v)}` : null
		].filter(Boolean);
		return q.length ? `/?${q.join('&')}` : '/';
	};
</script>

<svelte:head><title>{scoped ? `${scoped.name} · ` : ''}Harbour · Wheelhouse</title></svelte:head>

{#snippet work(list: TaskSummary[])}
	{@const under = h.underWay.filter((t) => list.includes(t))}
	{@const queued = h.queued.filter((t) => list.includes(t))}
	{@const landed = h.landedRecent.filter((t) => list.includes(t))}
	{@const older = h.landedOlder.filter((t) => list.includes(t))}
	{#if under.length}
		<h3 class="mb-3 text-xs font-medium text-muted-foreground">
			Under way <span class="tabular">{under.length}</span>
		</h3>
		<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{#each under as t (t.id)}<TaskCard task={t} />{/each}
		</div>
	{/if}
	{#if queued.length}
		<p class="mt-4 text-sm text-muted-foreground">
			Queued next: {#each queued as t, i (t.id)}<a
					class="hover:text-foreground hover:underline"
					href="/tasks/{encodeURIComponent(t.id)}">{t.title}</a
				>{i < queued.length - 1 ? ', ' : '.'}{/each}
		</p>
	{/if}
	{#if landed.length || (showOlder && older.length)}
		<h3 class="mt-8 mb-3 text-xs font-medium text-muted-foreground">
			Landed <span class="tabular">{landed.length + (showOlder ? older.length : 0)}</span>
		</h3>
		<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{#each landed as t (t.id)}<TaskCard task={t} />{/each}
			{#if showOlder}{#each older as t (t.id)}<TaskCard task={t} />{/each}{/if}
		</div>
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
		<p class="text-sm text-muted-foreground">Nothing else here right now.</p>
	{/if}
{/snippet}

{#snippet projectName_(p: Project)}
	<a href="/?project={encodeURIComponent(p.id)}" class="hover:underline">
		<h2 id="proj-{p.id}" class="text-xl font-semibold tracking-tight">{p.name}</h2>
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
		<div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
				aria-current={openTab ? undefined : 'page'}
				class="-mb-px border-b-2 px-3 py-2 {openTab
					? 'border-transparent text-muted-foreground hover:text-foreground'
					: 'border-foreground font-medium'}">Work</a
			>
			{#each list as e (e.key)}
				<a
					href={tabHref(p, e)}
					aria-current={openTab?.key === e.key ? 'page' : undefined}
					class="-mb-px border-b-2 px-3 py-2 {openTab?.key === e.key
						? 'border-foreground font-medium'
						: 'border-transparent text-muted-foreground hover:text-foreground'}">{e.title}</a
				>
			{/each}
		</nav>
	{/if}
{/snippet}

{#snippet projectPath(p: Project)}
	<span class="ml-auto truncate font-mono text-xs text-muted-foreground">{p.path}</span>
{/snippet}

{#snippet section(p: Project, list: TaskSummary[])}
	<section class="mt-16 border-t pt-8" aria-labelledby="proj-{p.id}">
		<div class="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			{#each headerParts(p) as part (part.id)}{@render part.render(p)}{/each}
		</div>
		{@render harbourCards(p)}
		{@render work(list)}
	</section>
{/snippet}

<main class="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-6">
		<div class="max-w-3xl">
			<p class="text-sm text-muted-foreground">
				{scoped ? scoped.name : 'All projects'}, watch report{fleet?.collectedAt
					? ` at ${clock(fleet.collectedAt)}`
					: ''}
			</p>
			{#if fleet?.collectedAt}
				<h1 class="mt-2 text-[1.75rem] leading-snug font-semibold tracking-tight text-balance">
					{headline(h)}
				</h1>
			{:else}
				<h1
					class="mt-2 text-[1.75rem] leading-snug font-semibold tracking-tight text-balance text-muted-foreground"
				>
					Waiting for the first read of Firstmate…
				</h1>
			{/if}
		</div>
		<div class="flex rounded-lg border p-0.5 text-sm" role="tablist" aria-label="View">
			<a
				href={href(null)}
				role="tab"
				aria-selected={view === 'cards'}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 {view === 'cards'
					? 'bg-accent font-medium'
					: 'text-muted-foreground hover:text-foreground'}"><LayoutGrid class="size-4" />Harbour</a
			>
			<a
				href={href('passage')}
				role="tab"
				aria-selected={view === 'passage'}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 {view === 'passage'
					? 'bg-accent font-medium'
					: 'text-muted-foreground hover:text-foreground'}"><Waypoints class="size-4" />Passage</a
			>
		</div>
	</div>

	{#if scoped && view === 'cards'}{@render scopedTabs(scoped)}{/if}

	{#if view === 'passage'}
		<div class="mt-10"><PassageChart {tasks} projects={scoped ? [scoped] : projects} /></div>
	{:else if openTab}
		<section class="mt-8 max-w-4xl" aria-label={openTab.title} data-slot="project.tab">
			<SlotContent entry={openTab} now={live.now} />
		</section>
	{:else}
		{#if h.needsYou.length}
			<section class="mt-10" aria-labelledby="your-move">
				<h2 id="your-move" class="mb-4 text-sm font-medium text-sea">Your move</h2>
				<div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
					{#each h.needsYou as t (t.id)}<MoveCard task={t} projectName={projectName(t)} />{/each}
				</div>
			</section>
		{/if}

		{#if h.waitingOnFirstmate.length}
			<section class="mt-10" aria-labelledby="with-firstmate">
				<h2 id="with-firstmate" class="text-sm font-medium text-warning">Waiting on Firstmate</h2>
				<p class="mt-1 mb-4 text-sm text-muted-foreground">
					A worker raised a decision. Firstmate handles it first and brings it to you if it needs
					you.
				</p>
				<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{#each h.waitingOnFirstmate as t (t.id)}<TaskCard
							task={t}
							projectName={projectName(t)}
						/>{/each}
				</div>
			</section>
		{/if}

		{#if scoped}
			<section class="mt-14">{@render harbourCards(scoped)}{@render work(tasks)}</section>
		{:else}
			{#each projects as p (p.id)}
				{@const list = tasks.filter((t) => t.projectId === p.id)}
				{#if list.some((t) => !h.needsYou.includes(t) && !h.waitingOnFirstmate.includes(t))}
					{@render section(p, list)}
				{/if}
			{/each}
		{/if}
		{#if fleet?.collectedAt && !tasks.length}
			<p class="mt-14 text-muted-foreground">
				No tasks{scoped ? ' in this project' : ''} right now.
			</p>
		{/if}
	{/if}
</main>
