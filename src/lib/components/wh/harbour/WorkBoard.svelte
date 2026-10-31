<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import { rememberView } from '$lib/client/view';
	import { harbour, shelf, type Shelf } from '$lib/harbour';
	import type { SlotEntry } from '$lib/plugins/types';
	import type { TaskSummary } from '$lib/types';
	import { VIEW_COOKIE, type BoardView, type Sort, type TaskColumn } from '$lib/views';
	import { Grid3x3, List, RectangleHorizontal } from '@lucide/svelte';
	import MoveCard from '../MoveCard.svelte';
	import SlotContent from '../plugins/SlotContent.svelte';
	import TaskCard from '../TaskCard.svelte';
	import CompactCard from '../views/CompactCard.svelte';
	import TaskTable from '../views/TaskTable.svelte';
	import ViewToggle from '../views/ViewToggle.svelte';

	/**
	 * One project's work, on its Work tab: what needs you, what waits on Firstmate or on
	 * reviewers, its plugins' cards, then the work under way and queued (or, on the
	 * Completed shelf, everything finished, newest first). Large cards, compact cards
	 * or a list, remembered in this browser.
	 */
	let {
		tasks,
		projectName,
		cards,
		layout: initial,
		showing,
		shelfHref,
		collected
	}: {
		tasks: TaskSummary[];
		projectName: string;
		/** The project's harbour.card plugin entries. */
		cards: SlotEntry[];
		layout: BoardView;
		showing: Shelf;
		shelfHref: (s: Shelf) => string;
		/** Firstmate has been read at least once, so an empty board means no work. */
		collected: boolean;
	} = $props();

	const open = $derived(shelf(tasks, 'under-way'));
	const h = $derived(harbour(open, live.now));
	const completed = $derived(shelf(tasks, 'completed'));
	const nameOf = () => projectName;

	let picked = $state<BoardView | null>(null);
	const layout = $derived(picked ?? initial);
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
</script>

<!-- A group of tasks in the chosen layout; Large keeps the full cards (and Your move's action cards). -->
{#snippet board(list: TaskSummary[], label: string, kind: 'task' | 'move' = 'task')}
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
			{#each list as t (t.id)}<CompactCard task={t} {projectName} />{/each}
		</div>
	{:else if kind === 'move'}
		<div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
			{#each list as t (t.id)}<MoveCard task={t} projectName={null} />{/each}
		</div>
	{:else}
		<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
			{#each list as t (t.id)}<TaskCard task={t} projectName={null} />{/each}
		</div>
	{/if}
{/snippet}

<div class="flex flex-wrap items-center justify-between gap-3">
	<div
		class="flex rounded-md border bg-card p-0.5 text-sm max-sm:w-full"
		role="tablist"
		aria-label="Show"
	>
		{#each [['under-way', 'Under way'], ['completed', 'Completed']] as const as [s, label] (s)}
			<a
				href={shelfHref(s)}
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

{#if showing === 'completed'}
	{#if completed.length}
		<section class="surface mt-6 p-5 sm:p-6">{@render board(completed, 'Completed')}</section>
	{:else if collected}
		<p class="surface mt-6 p-5 text-muted-foreground sm:p-6">
			Nothing completed in this project yet.
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
				A worker raised a decision. Firstmate handles it first and brings it to you if it needs you.
			</p>
			{@render board(h.waitingOnFirstmate, 'Waiting on Firstmate')}
		</section>
	{/if}

	{#if h.waitingOnReviewers.length}
		<section class="surface mt-6 p-5 sm:p-6" aria-labelledby="with-reviewers">
			<h2 id="with-reviewers" class="section-label">Waiting on reviewers</h2>
			<p class="mt-1 mb-4 text-sm text-muted-foreground">
				Pull requests that are green and waiting on other people's review or approval. Nothing for
				you to do until they review.
			</p>
			{@render board(h.waitingOnReviewers, 'Waiting on reviewers')}
		</section>
	{/if}

	<section class="surface mt-6 p-5 sm:p-6" aria-label="Work">
		{#if cards.length}
			<div class="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
				{#each cards as e (e.key)}
					<div class="min-w-0 rounded-xl border bg-card px-4 py-3" data-slot="harbour.card">
						<p class="mb-2 text-xs font-medium text-muted-foreground">{e.title}</p>
						<SlotContent entry={e} now={live.now} />
					</div>
				{/each}
			</div>
		{/if}
		{#if h.underWay.length}
			<h3 class="section-label mb-3">
				Under way <span class="tabular">{h.underWay.length}</span>
			</h3>
			{@render board(h.underWay, 'Under way')}
		{/if}
		{#if h.queued.length}
			<p class="mt-4 text-sm text-muted-foreground">
				Queued next: {#each h.queued as t, i (t.id)}<a
						class="hover:text-foreground hover:underline"
						href="/tasks/{encodeURIComponent(t.id)}">{t.shortTitle}</a
					>{i < h.queued.length - 1 ? ', ' : '.'}{/each}
			</p>
		{/if}
		{#if !h.underWay.length && !h.queued.length}
			<p class="text-sm text-muted-foreground">
				{open.length || !collected
					? 'Nothing else under way right now.'
					: 'Nothing under way in this project right now.'}
				<a href={shelfHref('completed')} class="hover:text-foreground hover:underline"
					>What it has completed</a
				>
			</p>
		{/if}
	</section>
{/if}
