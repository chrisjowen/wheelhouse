<script lang="ts">
	/**
	 * The home page's right-hand rail: what needs the captain first (failed
	 * steps, then reviews and decisions), then the work in play, then what is
	 * up next and what landed. Every card links to its task page and can start
	 * a message about the task ("Chat about this"). Quiet insight pieces sit
	 * around them: the Claude allowance under the headline, a work-time estimate
	 * on work under way, the latest review questions Firstmate decided for the
	 * captain, and where today's time went; each opens its own page. The lists
	 * sit in tabs, one at a time, each with its count: Needs you (with the
	 * decisions Firstmate made), Under way (with what is up next), Landed (with
	 * where today's time went), and a tab per plugin home.card (such as Harness).
	 */
	import {
		Anchor,
		ArrowRight,
		ArrowUpRight,
		Check,
		ChevronRight,
		CircleX,
		Gauge,
		GitPullRequest,
		Hand,
		MessageSquare,
		MessageSquareText,
		OctagonAlert,
		Scale,
		Unplug,
		X
	} from '@lucide/svelte';
	import { ago } from '$lib/format';
	import { harbour, headline } from '$lib/harbour';
	import { duration, sumSplits, total } from '$lib/insights';
	import ChecksStrip from '$lib/components/wh/ChecksStrip.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import AllowanceMeter from '$lib/components/wh/insights/AllowanceMeter.svelte';
	import EtaLine from '$lib/components/wh/insights/EtaLine.svelte';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import { onMount } from 'svelte';
	import { showsChecks } from '$lib/checks';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import type { Project, RailInsights, TaskSummary } from '$lib/types';
	import { composerBus } from './bus.svelte';

	let {
		tasks,
		projects,
		now,
		insights = null,
		scope = null,
		cards = [],
		onClose,
		onChat
	}: {
		tasks: TaskSummary[];
		projects: Project[];
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
	const midnight = $derived(new Date(new Date(now).toDateString()).getTime());
	const decidedToday = $derived(decided.filter((d) => Date.parse(d.decidedAt) >= midnight).length);
	const today = $derived(sumSplits((insights?.today ?? []).filter((t) => inScope(t.projectId))));
	const todayTotal = $derived(total(today));
	const todayTasks = $derived((insights?.today ?? []).filter((t) => inScope(t.projectId)).length);
	const share = (k: keyof typeof today) =>
		todayTotal ? Math.round((today[k] / todayTotal) * 100) : 0;
	const allowance = $derived(insights?.allowance ?? null);

	const h = $derived(harbour(tasks, now));
	const failedIds = $derived(new Set(h.stepFailed.map((t) => t.id)));
	const failed = $derived(h.stepFailed.filter((t) => !h.needsYou.includes(t)));
	const underWay = $derived(
		[...h.waitingOnFirstmate, ...h.underWay].filter((t) => !failedIds.has(t.id))
	);
	let showQueued = $state(false);

	// One list at a time: what needs you (the default), what is under way, what landed, and a
	// tab per plugin card (such as Harness). The tab you pick is remembered in this browser.
	const TAB_KEY = 'wheelhouse-rail-tab';
	const tabs = $derived([
		{
			id: 'needs',
			label: 'Needs you',
			count: failed.length + h.needsYou.length,
			strong: true
		},
		{ id: 'under', label: 'Under way', count: underWay.length, strong: false },
		{ id: 'landed', label: 'Landed', count: h.landedRecent.length, strong: false },
		...cards.map((e) => ({ id: e.key, label: e.title, count: e.badge ?? 0, strong: false }))
	]);
	let picked = $state('needs');
	const tab = $derived(tabs.some((t) => t.id === picked) ? picked : 'needs');
	const plugin = $derived(cards.find((e) => e.key === tab) ?? null);
	onMount(() => {
		try {
			picked = localStorage.getItem(TAB_KEY) || 'needs';
		} catch {
			// storage unavailable: start on Needs you
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

	const projectName = (t: TaskSummary) =>
		projects.find((p) => p.id === t.projectId)?.name ??
		(t.projectId === 'unassigned' ? null : t.projectId);
	const href = (t: TaskSummary) => `/tasks/${encodeURIComponent(t.id)}`;
	const nowText = (t: TaskSummary) => t.activity?.text || t.summary || t.statusLabel;
	const prOf = (t: TaskSummary) => t.attention?.url ?? t.pr?.url ?? null;

	type Tone = 'danger' | 'warning' | 'sea' | 'muted';
	type Problem = { label: string; icon: typeof Hand; tone: Tone };
	/** The one problem badge a card carries: icon plus words, never colour alone. */
	function problem(t: TaskSummary): Problem | null {
		const step = t.passage.steps[t.passage.current];
		if (step?.failed) return { label: `${step.label} failed`, icon: CircleX, tone: 'danger' };
		if (t.status === 'failed') return { label: 'Failed', icon: CircleX, tone: 'danger' };
		if (t.status === 'blocked') return { label: 'Stuck', icon: OctagonAlert, tone: 'danger' };
		if (t.status === 'lost' || t.status === 'unknown')
			return { label: 'Not responding', icon: Unplug, tone: 'warning' };
		if (t.attention?.owner === 'captain')
			return t.attention.kind === 'review'
				? { label: 'Your review', icon: GitPullRequest, tone: 'sea' }
				: { label: 'Your call', icon: Hand, tone: 'sea' };
		if (t.addressingReview)
			return { label: 'Addressing your review', icon: MessageSquareText, tone: 'muted' };
		if (t.status === 'with-firstmate')
			return { label: 'Firstmate deciding', icon: Anchor, tone: 'muted' };
		return null;
	}
	const TONE: Record<Tone, string> = {
		danger: 'bg-danger/10 text-danger',
		warning: 'bg-warning/10 text-warning',
		sea: 'bg-sea/10 text-sea',
		muted: 'bg-muted text-muted-foreground'
	};
	const EDGE: Record<Tone, string> = {
		danger: 'border-l-danger',
		warning: 'border-l-warning',
		sea: 'border-l-sea',
		muted: 'border-l-border'
	};

	function chat(t: TaskSummary) {
		composerBus.pending = {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: projectName(t),
			url: null
		};
		onChat?.();
	}
</script>

{#snippet card(t: TaskSummary, ask: string | null)}
	{@const p = problem(t)}
	{@const pr = prOf(t)}
	{@const Icon = p?.icon}
	<li
		class="rounded-lg border border-l-[3px] bg-card px-3 pt-2.5 pb-1.5 {p
			? EDGE[p.tone]
			: 'border-l-border'}"
	>
		<div class="flex flex-wrap items-center gap-1.5">
			{#if projectName(t)}
				<span
					class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
					>{projectName(t)}</span
				>
			{/if}
			{#if p && Icon}
				<span
					class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {TONE[
						p.tone
					]}"><Icon class="size-3" aria-hidden="true" />{p.label}</span
				>
			{:else if t.busy}
				<span class="flex items-center gap-1.5 text-xs text-muted-foreground"
					><span class="size-1.5 animate-pulse rounded-full bg-sea" aria-hidden="true"
					></span>Working</span
				>
			{/if}
		</div>
		<a
			href={href(t)}
			class="mt-1.5 line-clamp-2 block text-sm leading-snug font-medium hover:underline"
			>{ask ?? t.shortTitle}</a
		>
		{#if ask}
			<p class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{t.shortTitle}</p>
		{/if}
		{#if showsChecks(t)}
			<!-- In the checks stage the strip and its line say what is happening now (as on Harbour). -->
			<div class="mt-1.5"><ChecksStrip pipeline={t.pipeline} busy={t.busy} size="rail" /></div>
		{:else if !ask}
			<p class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{nowText(t)}</p>
		{/if}
		{#if pr}
			<a
				href={pr}
				target="_blank"
				rel="noreferrer"
				class="mt-1 block text-xs break-all text-sea hover:underline">{pr}</a
			>
		{/if}
		{#if t.passage.steps.length > 1}
			<div class="mt-2.5"><StageTrack task={t} /></div>
		{/if}
		{#if t.eta}<div class="mt-2"><EtaLine eta={t.eta} /></div>{/if}
		<div class="mt-1.5 -mr-1.5 flex justify-end gap-0.5">
			<a
				href={href(t)}
				class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				><ArrowUpRight class="size-3.5" />Open</a
			>
			<button
				class="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => chat(t)}><MessageSquare class="size-3.5" />Chat about this</button
			>
		</div>
	</li>
{/snippet}

<aside class="flex h-full min-h-0 flex-col" aria-label="Tasks and decisions">
	<div class="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm">
		<span class="font-display text-[1.15rem] font-medium">On deck</span>
		{#if onClose}
			<button
				class="-mr-2 ml-auto flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
				onclick={onClose}><X class="size-4" /></button
			>
		{/if}
	</div>

	<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
		<p class="mb-5 text-sm leading-relaxed text-muted-foreground">{headline(h)}</p>

		{#if allowance?.state === 'ok' && allowance.windows.length}
			<a
				href="/headroom"
				class="mb-6 block rounded-lg border bg-card px-3 py-2.5 hover:border-foreground/20"
			>
				<span class="flex items-center gap-1.5 text-xs font-medium"
					><Gauge class="size-3.5 text-muted-foreground" aria-hidden="true" />Claude headroom</span
				>
				<span class="mt-2 flex flex-col gap-1">
					{#each allowance.windows.slice(0, 2) as w (w.id)}
						<AllowanceMeter {w} {now} compact />
					{/each}
				</span>
				{#if insights?.atRisk}
					<span class="mt-1.5 block text-xs text-warning"
						>{insights.atRisk.label} may run out before it resets.</span
					>
				{/if}
			</a>
		{:else if allowance?.state === 'connect'}
			<a
				href="/headroom"
				class="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
				><Gauge class="size-3.5" aria-hidden="true" />Connect your Claude usage to see what is left</a
			>
		{/if}

		<div
			class="sticky -top-4 z-10 -mx-4 mb-4 no-scrollbar flex justify-between gap-0.5 overflow-x-auto border-b bg-panel px-2.5"
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

		<div id="rail-panel" role="tabpanel" aria-labelledby="rail-tab-{tab}">
			{#if tab === 'needs'}
				{#if failed.length || h.needsYou.length}
					<ul class="mb-6 flex flex-col gap-2">
						{#each failed as t (t.id)}
							{@render card(
								t,
								`${t.passage.steps[t.passage.current].label} failed: ${t.shortTitle}`
							)}
						{/each}
						{#each h.needsYou as t (t.id)}
							{@render card(t, t.attention?.text || null)}
						{/each}
					</ul>
				{:else}
					<p class="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
						<Check class="size-4 text-success" />Nothing needs you right now.
					</p>
				{/if}
				{#if decided.length}
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<h2 class="section-label flex-1">Decided for you</h2>
						<a href="/decisions" class="text-xs text-muted-foreground hover:text-foreground"
							>See all</a
						>
					</div>
					{#if decidedToday}
						<p class="mb-2 text-xs text-muted-foreground">
							Firstmate settled {decidedToday} review {decidedToday === 1
								? 'question'
								: 'questions'} for you today.
						</p>
					{/if}
					<ul class="mb-6 divide-y rounded-lg border bg-card">
						{#each decided.slice(0, 3) as d (d.id)}
							<li>
								<a href="/decisions#{d.id}" class="block px-3 py-2.5 hover:bg-muted/60">
									<span class="flex items-center gap-2 text-xs">
										<Scale class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
										<span class="shrink-0 font-medium whitespace-nowrap">{d.verdict}</span>
										<span class="min-w-0 truncate text-muted-foreground">· {d.taskTitle}</span>
										<span class="ml-auto shrink-0 text-muted-foreground"
											>{ago(d.decidedAt, now)}</span
										>
									</span>
									<span class="mt-1 line-clamp-2 block text-xs text-muted-foreground"
										>{d.question}</span
									>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'under'}
				{#if underWay.length}
					<ul class="mb-6 flex flex-col gap-2">
						{#each underWay as t (t.id)}
							{@render card(t, null)}
						{/each}
					</ul>
				{:else}
					<p class="mb-6 text-sm text-muted-foreground">Nothing under way.</p>
				{/if}
				{#if h.queued.length}
					<button
						class="mb-2 flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
						aria-expanded={showQueued}
						onclick={() => (showQueued = !showQueued)}
					>
						Up next · {h.queued.length}
						<ChevronRight class="size-3.5 transition-transform {showQueued ? 'rotate-90' : ''}" />
					</button>
					{#if showQueued}
						<ul class="mb-4 flex flex-col">
							{#each h.queued as t (t.id)}
								<li>
									<a
										href={href(t)}
										class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
										>{#if projectName(t)}<span
												class="shrink-0 rounded border px-1 font-mono text-xs leading-4"
												>{projectName(t)}</span
											>{/if}<span class="truncate">{t.shortTitle}</span></a
									>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			{:else if tab === 'landed'}
				{#if h.landedRecent.length}
					<ul class="mb-6 flex flex-col">
						{#each h.landedRecent as t (t.id)}
							<li>
								<a
									href={href(t)}
									class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
									><Check
										class="size-3.5 shrink-0 text-success"
										aria-label="Landed"
									/>{#if projectName(t)}<span
											class="shrink-0 rounded border px-1 font-mono text-xs leading-4"
											>{projectName(t)}</span
										>{/if}<span class="truncate">{t.shortTitle}</span></a
								>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mb-6 text-sm text-muted-foreground">Nothing landed in the last day.</p>
				{/if}
				{#if todayTotal > 0}
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<h2 class="section-label flex-1">Where time went today</h2>
						<a href="/time" class="text-xs text-muted-foreground hover:text-foreground">Details</a>
					</div>
					<a href="/time" class="block rounded-lg border bg-card p-3 hover:border-foreground/20">
						<span class="block text-sm"
							><span class="font-medium">{duration(todayTotal)}</span>
							<span class="text-muted-foreground"
								>of crew time on {todayTasks}
								{todayTasks === 1 ? 'task' : 'tasks'}</span
							></span
						>
						<span class="mt-2 block"><TimeBar seconds={today} label="Today" /></span>
						<span class="mt-2 block text-xs text-muted-foreground"
							>{share('build')}% building · {share('review')}% automated review · {share(
								'captain'
							)}% waiting on you</span
						>
					</a>
				{/if}
			{:else if plugin}
				<div data-slot="home.card"><SlotContent entry={plugin} {now} /></div>
			{/if}
		</div>

		<a
			href="/harbour"
			class="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>Open the full board in Harbour <ArrowRight class="size-3.5" /></a
		>
	</div>
</aside>
