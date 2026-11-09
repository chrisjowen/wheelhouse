<script lang="ts">
	/**
	 * The home page's rail, On deck: every piece of work as one line (DeckLine),
	 * grouped by whose crew runs it: Firstmate's own, then each second mate,
	 * with its host. A crew toggle (All, then one segment per crew, each with a
	 * count; remembered in this browser) narrows the rail to one crew. The lines
	 * sit in tabs, one at a time, each with its count: Needs you (the questions
	 * Firstmate escalated, failed steps, reviews and calls, the workers'
	 * questions Firstmate is handling, then the decisions Firstmate made for the
	 * captain), Under way (with what is up next, folded), Landed (with where
	 * today's time went), and a tab per plugin home.card (such as Harness).
	 * Selecting a line opens it in place; Open slides the task out beside the
	 * page, and Chat about this mentions it in the message box. Claude headroom
	 * sits in the header; the watch report's headline is the rail's description.
	 * Landed and closed work leaves Under way by itself.
	 */
	import { Anchor, ArrowRight, Check, ChevronRight, Gauge, Scale, Ship, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { ago } from '$lib/format';
	import { headline } from '$lib/harbour';
	import { duration, sumSplits, total } from '$lib/insights';
	import {
		ALL_CREWS,
		OWN_CREW,
		byCrew,
		crewChoice,
		crewsOf,
		deckOf,
		inCrew,
		shortAge,
		type Crew,
		type DeckLine as Line
	} from '$lib/ondeck';
	import { inbox } from '$lib/client/inbox.svelte';
	import { escalated, type InboxView } from '$lib/inbox';
	import { stampOut, rise } from '$lib/motion';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import MateHealthPill from '$lib/components/wh/mates/MateHealthPill.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import type { Project, RailInsights, SecondMate, TaskSummary } from '$lib/types';
	import DeckLine from './DeckLine.svelte';
	import { composerBus } from './bus.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { projectLabels } from '$lib/projectnames';

	let {
		tasks,
		projects,
		now,
		insights = null,
		scope = null,
		cards = [],
		secondMates = [],
		onClose,
		onChat
	}: {
		tasks: TaskSummary[];
		projects: Project[];
		/** Second mates, local and remote; each is a crew of its own. */
		secondMates?: SecondMate[];
		now: number;
		insights?: RailInsights | null;
		/** The project the rail is scoped to, if any. */
		scope?: string | null;
		/** Plugin home.card entries. */
		cards?: SlotEntry[];
		onClose?: () => void;
		onChat?: () => void;
	} = $props();

	const inScope = (projectId: string | null) => !scope || projectId === scope;
	const decided = $derived((insights?.decisions ?? []).filter((d) => inScope(d.projectId)));
	const today = $derived(sumSplits((insights?.today ?? []).filter((t) => inScope(t.projectId))));
	const todayTotal = $derived(total(today));
	const todayTasks = $derived((insights?.today ?? []).filter((t) => inScope(t.projectId)).length);
	const share = (k: keyof typeof today) =>
		todayTotal ? Math.round((today[k] / todayTotal) * 100) : 0;
	const allowance = $derived(insights?.allowance ?? null);

	// The open questions Firstmate escalated; with no inbox, held work keeps its own line.
	const seed = $derived(page.data.inbox as InboxView | undefined);
	const inboxView = $derived(inbox.view(seed));
	const decisions = $derived(
		inboxView?.available
			? { shown: inbox.shown(now, seed).shown.filter(escalated), all: inboxView.cards }
			: null
	);
	const deck = $derived(deckOf(tasks, now, decisions, scope));

	// ---- crews: Firstmate's own, then each second mate (in a project's rail, those with work in it) ----
	const lines = $derived([
		...deck.needs,
		...deck.withFirstmate,
		...deck.under,
		...deck.next,
		...deck.landed
	]);
	const mates = $derived(
		scope ? secondMates.filter((m) => lines.some((l) => l.crew === m.id)) : secondMates
	);
	const crews = $derived(crewsOf(mates, lines));
	const CREW_KEY = 'wheelhouse-rail-crew';
	let savedCrew = $state<string | null>(null);
	const crew = $derived(crewChoice(savedCrew, crews));
	function pickCrew(id: string) {
		savedCrew = id;
		try {
			localStorage.setItem(CREW_KEY, id);
		} catch {
			// storage unavailable: the choice lasts for this page only
		}
	}
	function moveCrew(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		const ids = [ALL_CREWS, ...crews.map((c) => c.id)];
		const i = ids.indexOf(crew);
		const n =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? ids.length - 1
					: (i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
		pickCrew(ids[n]);
		document.getElementById(crewDomId(ids[n]))?.focus();
	}
	const crewDomId = (id: string) => `rail-crew-${id.replace(/[^\w-]/g, '-')}`;
	const mine = (lines: Line[]) => lines.filter((l) => inCrew(crew, l.crew));
	const inPlay = (id: string) =>
		[...deck.needs, ...deck.withFirstmate, ...deck.under].filter((l) => inCrew(id, l.crew)).length;
	const forYou = (id: string) => deck.needs.filter((l) => inCrew(id, l.crew)).length;

	// ---- tabs: one list at a time; the tab picked is remembered in this browser ----
	const TAB_KEY = 'wheelhouse-rail-tab';
	const tabs = $derived([
		{ id: 'under', label: 'Under way', count: mine(deck.under).length, strong: false },
		{ id: 'needs', label: 'Needs you', count: mine(deck.needs).length, strong: true },
		{ id: 'landed', label: 'Landed', count: mine(deck.landed).length, strong: false },
		...cards.map((e) => ({ id: e.key, label: e.title, count: e.badge ?? 0, strong: false }))
	]);
	let picked = $state('under');
	const tab = $derived(tabs.some((t) => t.id === picked) ? picked : 'under');
	const plugin = $derived(cards.find((e) => e.key === tab) ?? null);
	onMount(() => {
		aliases.load();
		try {
			picked = localStorage.getItem(TAB_KEY) || 'under';
			savedCrew = localStorage.getItem(CREW_KEY);
		} catch {
			// storage unavailable: start on Under way, every crew
		}
	});
	function pickTab(id: string) {
		picked = id;
		try {
			localStorage.setItem(TAB_KEY, id);
		} catch {
			// storage unavailable: the tab lasts for this page only
		}
	}
	function moveTab(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const i = tabs.findIndex((t) => t.id === tab);
		const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
		pickTab(next.id);
		document.getElementById(`rail-tab-${next.id}`)?.focus();
	}

	// ---- lines ----
	let showQueued = $state(false);
	const opened = new SvelteSet<string>();
	function toggle(key: string) {
		if (opened.has(key)) opened.delete(key);
		else opened.add(key);
	}
	const tabLines = $derived(
		tab === 'needs'
			? [...deck.needs, ...deck.withFirstmate]
			: tab === 'under'
				? [...deck.under, ...(showQueued ? deck.next : [])]
				: tab === 'landed'
					? deck.landed
					: []
	);
	const groups = $derived(byCrew(tabLines, crews, crew));
	const queuedHere = $derived(mine(deck.next).length);
	const ownCrewShown = $derived(crew === ALL_CREWS || crew === OWN_CREW);

	// Up and down move between lines; Home and End jump to the first and last.
	function moveLine(e: KeyboardEvent) {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
		const list = e.currentTarget as HTMLElement;
		const lines = [...list.querySelectorAll<HTMLElement>('[data-deck-line]')];
		const i = lines.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		e.preventDefault();
		const n =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? lines.length - 1
					: Math.max(0, Math.min(lines.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
		lines[n]?.focus();
	}

	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (projects.find((p) => p.id === id)?.name ?? id);
	// Tags carry the short name: a friendly name, else the part after a shared prefix.
	const labels = $derived(projectLabels(projects, aliases.names));
	function projectOf(l: Line) {
		const id = l.kind === 'task' ? l.task.projectId : l.card.projectId;
		const name = projectName(id);
		return name ? { name, tag: labels.get(id!)?.label ?? name } : null;
	}

	function chat(t: TaskSummary) {
		composerBus.pending = {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: projectName(t.projectId),
			url: null
		};
		onChat?.();
	}
	const EMPTY: Record<string, string> = {
		needs: 'Nothing needs you right now.',
		under: 'Nothing under way.',
		landed: 'Nothing landed in the last day.'
	};
</script>

<!-- One crew's heading: who runs the work and where; selecting it shows only that crew. -->
{#snippet crewHead(c: Crew, n: number)}
	<h3 class="mt-3 mb-0.5 first:mt-0" data-crew={c.id}>
		<button
			type="button"
			class="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring {crew ===
			c.id
				? 'cursor-default'
				: 'cursor-pointer hover:bg-muted/50'}"
			aria-label="{c.label}{c.mate
				? `, ${c.mate.where === 'remote' ? `on ${c.mate.host ?? 'another host'}` : 'on this computer'}`
				: ''}: {n}{crew === c.id ? '' : '. Show only this crew'}"
			onclick={() => pickCrew(c.id)}
		>
			{#if c.id !== OWN_CREW}
				<Ship class="size-3.5 shrink-0 text-brass" aria-hidden="true" />
				<span class="shrink-0 font-medium text-brass">{c.label}</span>
				{#if c.mate}<span class="min-w-0 truncate text-muted-foreground"
						>{c.mate.where === 'remote'
							? `on ${c.mate.host ?? 'another host'}`
							: 'on this computer'}</span
					>{/if}
			{:else}
				<Anchor class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="shrink-0 font-medium text-foreground">{c.label}</span>
			{/if}
			<span class="shrink-0 text-muted-foreground tabular-nums">{n}</span>
			<span class="min-w-2 flex-1 border-t border-hair" aria-hidden="true"></span>
			{#if c.mate && (c.mate.health.online !== 'online' || c.mate.health.cached)}<MateHealthPill
					health={c.mate.health}
				/>{/if}
		</button>
	</h3>
	{#if c.mate && crew === c.id}
		<p
			class="mb-1 flex items-center gap-2 px-1.5 text-xs text-muted-foreground"
			data-second-mate={c.mate.id}
		>
			<MateHealthPill health={c.mate.health} />
			<span class="min-w-0 truncate" title={c.mate.lastReport?.text}
				>{c.mate.stateLabel}{c.mate.queued.length ? ` · ${c.mate.queued.length} queued` : ''}{c.mate
					.lastReport
					? ` · “${c.mate.lastReport.text}”`
					: ''}</span
			>
			<a
				href="/second-mates#mate-{encodeURIComponent(c.mate.id)}"
				class="ml-auto shrink-0 hover:text-foreground hover:underline">More</a
			>
		</p>
	{/if}
{/snippet}

<aside
	class="flex h-full min-h-0 flex-col"
	aria-label="Tasks and decisions"
	aria-describedby="rail-headline"
>
	<p id="rail-headline" class="sr-only">{headline(deck.h)}</p>
	<div class="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm">
		<span class="font-display text-[1.15rem] font-medium">On deck</span>
		{#if allowance?.state === 'ok' && allowance.windows.length}
			<a
				href="/headroom"
				class="ml-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				title="Claude headroom: {allowance.windows
					.slice(0, 2)
					.map((w) => `${w.label} ${w.percentLeft}% left`)
					.join(', ')}{insights?.atRisk
					? `. ${insights.atRisk.label} may run out before it resets.`
					: ''}"
				data-headroom
			>
				<Gauge class="size-3.5 shrink-0" aria-hidden="true" />
				<span class="sr-only">Claude headroom:</span>
				{#each allowance.windows.slice(0, 2) as w, i (w.id)}
					{#if i}<span class="opacity-50" aria-hidden="true">·</span>{/if}
					<span class="whitespace-nowrap tabular-nums {w.atRisk ? 'font-medium text-warning' : ''}"
						>{w.label} {w.percentLeft}%</span
					>
				{/each}
			</a>
		{:else if allowance?.state === 'connect'}
			<a
				href="/headroom"
				class="ml-auto flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				title="Connect your Claude usage to see what is left"
				><Gauge class="size-3.5" aria-hidden="true" />Connect usage</a
			>
		{/if}
		{#if onClose}
			<button
				class="-mr-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground {allowance?.state ===
					'ok' || allowance?.state === 'connect'
					? ''
					: 'ml-auto'}"
				aria-label="Close"
				onclick={onClose}><X class="size-4" /></button
			>
		{/if}
	</div>

	{#if crews.length > 1}
		<!-- Whose work: All, Firstmate's own crew, then each second mate. A count in blue is what waits on you. -->
		<div class="shrink-0 border-b px-2.5 py-2">
			<div
				class="no-scrollbar flex justify-between gap-0.5 overflow-x-auto rounded-md bg-muted/70 p-0.5 text-xs"
				role="radiogroup"
				aria-label="Whose work"
				tabindex="-1"
				onkeydown={moveCrew}
			>
				{#each [{ id: ALL_CREWS, label: 'All', short: 'All', mate: null }, ...crews] as c (c.id)}
					{@const n = inPlay(c.id)}
					{@const you = forYou(c.id)}
					<button
						type="button"
						id={crewDomId(c.id)}
						role="radio"
						aria-checked={crew === c.id}
						tabindex={crew === c.id ? 0 : -1}
						class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring {crew ===
						c.id
							? 'bg-card font-medium text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'}"
						title="{c.label}{c.mate?.host ? ` on ${c.mate.host}` : ''}: {n} in play{you
							? `, ${you} waiting on you`
							: ''}"
						onclick={() => pickCrew(c.id)}
					>
						{#if c.id !== OWN_CREW && c.id !== ALL_CREWS}<Ship
								class="size-3 shrink-0 text-brass"
								aria-hidden="true"
							/>{:else if c.id === OWN_CREW}<Anchor
								class="size-3 shrink-0"
								aria-hidden="true"
							/>{/if}
						<span>{c.short}</span>
						<span class="sr-only">: {n} in play{you ? `, ${you} waiting on you` : ''}</span>
						<span
							class="shrink-0 tabular-nums {you
								? 'rounded-full bg-sea px-[5px] font-semibold text-white dark:text-slate-950'
								: 'opacity-70'}"
							aria-hidden="true">{you || n}</span
						>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<div
		class="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b px-2.5"
		role="tablist"
		aria-label="On deck"
		tabindex="-1"
		onkeydown={moveTab}
	>
		{#each tabs as t (t.id)}
			<button
				id="rail-tab-{t.id}"
				role="tab"
				aria-selected={tab === t.id}
				aria-controls="rail-panel"
				tabindex={tab === t.id ? 0 : -1}
				class="-mb-px flex shrink-0 cursor-pointer items-center gap-1 border-b-2 px-1.5 py-2 text-[0.85rem] whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-ring {tab ===
				t.id
					? 'border-brass font-medium text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => pickTab(t.id)}
				>{t.label}{#if t.count}<span
						class="tabular rounded-full px-1.5 text-xs leading-4 font-semibold {t.strong
							? 'bg-sea text-white dark:text-slate-950'
							: 'bg-muted text-muted-foreground'}">{t.count}</span
					>{/if}</button
			>
		{/each}
	</div>

	<div
		id="rail-panel"
		role="tabpanel"
		aria-labelledby="rail-tab-{tab}"
		class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 py-3"
	>
		{#if plugin}
			<div class="px-1.5" data-slot="home.card"><SlotContent entry={plugin} {now} /></div>
		{:else}
			{#if tab === 'under' && queuedHere}
				<button
					type="button"
					class="float-right -mt-1 ml-2 flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					aria-expanded={showQueued}
					onclick={() => (showQueued = !showQueued)}
					><ChevronRight
						class="size-3.5 transition-transform {showQueued ? 'rotate-90' : ''}"
						aria-hidden="true"
					/>Up next · {queuedHere}</button
				>
			{/if}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div onkeydown={moveLine}>
				{#each groups as g (g.crew.id)}
					<section aria-label={g.crew.label} data-crew-group={g.crew.id}>
						{#if crews.length > 1}{@render crewHead(g.crew, g.lines.length)}{/if}
						{#if g.lines.length}
							<ul>
								{#each g.lines as l (l.key)}
									<li
										in:rise
										out:stampOut={{
											word: l.kind === 'decision' ? inbox.stampFor(l.card.id) : null
										}}
									>
										<DeckLine
											line={l}
											{now}
											open={opened.has(l.key)}
											project={projectOf(l)}
											dim={l.kind === 'task' &&
												(l.task.status === 'queued' || l.task.status === 'landed')}
											onToggle={() => toggle(l.key)}
											onChat={chat}
										/>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-1.5 py-1 text-xs text-muted-foreground">{EMPTY[tab]}</p>
						{/if}
					</section>
				{:else}
					<p class="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground">
						{#if tab === 'needs'}<Check
								class="size-4 text-success"
								aria-hidden="true"
							/>{/if}{EMPTY[tab]}
					</p>
				{/each}
			</div>

			{#if tab === 'needs' && decided.length && ownCrewShown}
				<div class="mt-4 mb-0.5 flex items-center gap-2 px-1.5 text-xs">
					<h3 class="flex items-center gap-1.5 font-medium text-muted-foreground">
						<Scale class="size-3.5" aria-hidden="true" />Decided for you
					</h3>
					<span class="flex-1 border-t border-hair" aria-hidden="true"></span>
					<a href="/decisions" class="text-muted-foreground hover:text-foreground">See all</a>
				</div>
				<ul>
					{#each decided.slice(0, 3) as d (d.id)}
						<li>
							<a
								href="/decisions#{d.id}"
								class="flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
								title={d.question}
							>
								<span class="min-w-0 flex-1 truncate text-[0.875rem] text-muted-foreground"
									>{d.taskTitle}</span
								>
								<span class="shrink-0 text-xs font-medium">{d.verdict}</span>
								<span
									class="w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
									title={ago(d.decidedAt, now)}>{shortAge(d.decidedAt, now)}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			{/if}

			{#if tab === 'landed' && todayTotal > 0 && ownCrewShown}
				<a href="/time" class="mt-4 block rounded-md px-1.5 py-1 hover:bg-muted/50">
					<span class="block text-xs text-muted-foreground"
						><span class="font-medium text-foreground">{duration(todayTotal)}</span>
						of crew time today on {todayTasks}
						{todayTasks === 1 ? 'task' : 'tasks'}</span
					>
					<span class="mt-1.5 block"><TimeBar seconds={today} label="Today" /></span>
					<span class="mt-1.5 block text-xs text-muted-foreground"
						>{share('build')}% building · {share('review')}% automated review · {share('captain')}%
						waiting on you</span
					>
				</a>
			{/if}
		{/if}

		<a
			href={scope ? `/projects/${encodeURIComponent(scope)}` : '/harbour'}
			class="mt-4 flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
			>{scope ? 'Open the project’s page' : 'Open every project in Harbour'}
			<ArrowRight class="size-3.5" aria-hidden="true" /></a
		>
		{#if mates.length}
			<a
				href="/second-mates"
				class="mt-1.5 flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
				>Every second mate, with its queue, pull requests and a look at it
				<ArrowRight class="size-3.5" aria-hidden="true" /></a
			>
		{/if}
	</div>
</aside>
