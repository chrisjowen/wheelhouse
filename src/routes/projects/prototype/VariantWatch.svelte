<!-- PROTOTYPE, direction C "Watch": happenings first. A compact chart of every project sits
     at the top; under it, what waits on you and a log of what happened, newest first, across
     all projects. Picking a project narrows the same page to it, with its own tabs (its log,
     work, plugin tabs, passage, repository): the drill-in never leaves the page. -->
<script lang="ts">
	import {
		ago,
		byAttention,
		fleetTotals,
		headlineOf,
		health,
		heldUp,
		landedThisWeek,
		moving,
		underWay,
		waited,
		yourMove,
		type FakeProject,
		type LogEntry
	} from './prototype-data';
	import GitInsightsTab from './GitInsightsTab.svelte';
	import HealthMark from './HealthMark.svelte';
	import Monogram from './Monogram.svelte';
	import Note from './Note.svelte';
	import OtherTab from './OtherTab.svelte';
	import Pulse from './Pulse.svelte';
	import Stage from './Stage.svelte';
	import WorkTab from './WorkTab.svelte';
	import {
		ArrowRight,
		Check,
		CircleDot,
		ExternalLink,
		GitPullRequest,
		Hand,
		Play,
		TriangleAlert
	} from '@lucide/svelte';

	let {
		projects,
		project: p,
		tab,
		whole,
		link,
		notes
	}: {
		projects: FakeProject[];
		project: FakeProject | null;
		tab: string | null;
		/** Show the whole week's log, not just the latest lines. */
		whole: boolean;
		link: (q: Record<string, string | null>) => string;
		notes: boolean;
	} = $props();

	const t = $derived(fleetTotals(projects));
	const sorted = $derived(byAttention(projects));
	const tabs = $derived(
		p ? ['Log', 'Work', ...p.tabs, ...(p.id === 'unassigned' ? [] : ['Passage'])] : []
	);
	const current = $derived(tab && tabs.includes(tab) ? tab : 'Log');

	// Everything waiting on the captain, the longest wait first.
	const moves = $derived(
		(p ? [p] : projects)
			.flatMap((x) => yourMove(x).map((m) => ({ ...m, project: x })))
			.sort((a, b) => b.since - a.since)
	);
	// The log, newest first, grouped by day; the clock is the prototype's made-up 14:20.
	const NOW = 14 * 60 + 20;
	const week = $derived(
		(p ? [p] : projects)
			.flatMap((x) => x.log.map((e) => ({ ...e, project: x })))
			.filter((e) => e.at < 7 * 1440)
			.sort((a, b) => a.at - b.at)
	);
	// The latest dozen lines; the rest of the week is one click away.
	const LATEST = 12;
	const entries = $derived(whole || p ? week : week.slice(0, LATEST));
	const day = (at: number) =>
		at <= NOW ? 'Today' : at <= NOW + 1440 ? 'Yesterday' : 'Earlier this week';
	const days = $derived(
		['Today', 'Yesterday', 'Earlier this week']
			.map((d) => ({ d, list: entries.filter((e) => day(e.at) === d) }))
			.filter((x) => x.list.length)
	);
	const clockOf = (at: number) => {
		const m = (((NOW - at) % 1440) + 1440) % 1440;
		return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	};
	const ICON = {
		landed: Check,
		started: Play,
		'needs-you': Hand,
		'held-up': TriangleAlert,
		pr: GitPullRequest,
		note: CircleDot
	};
	const TONE: Record<LogEntry['kind'], string> = {
		landed: 'text-success',
		started: 'text-muted-foreground',
		'needs-you': 'text-sea',
		'held-up': 'text-danger',
		pr: 'text-muted-foreground',
		note: 'text-muted-foreground'
	};
	const tileLine = (x: FakeProject) => {
		const h = health(x);
		if (h === 'needs-you')
			return `${yourMove(x).length} ${yourMove(x).length === 1 ? 'needs' : 'need'} you · ${underWay(x).length} under way`;
		if (h === 'held-up')
			return heldUp(x).length
				? `Held up · ${underWay(x).length} under way`
				: x.main === 'red'
					? 'Main branch failing'
					: 'Passage has a problem';
		if (h === 'quiet') return `Quiet · last ${ago(x.lastActivity)}`;
		return `${underWay(x).length} under way · ${landedThisWeek(x).length} landed`;
	};
	const tileMark: Record<string, string> = {
		'needs-you': 'border-l-sea',
		'held-up': 'border-l-danger',
		new: 'border-l-success',
		'under-way': 'border-l-foreground/40',
		quiet: 'border-l-hair'
	};
</script>

<main class="px-4 pb-28 sm:px-6 lg:px-10">
	<header
		class="-mx-4 border-b border-hair bg-panel px-4 pt-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 {p
			? ''
			: 'pb-6'}"
	>
		{#if p}
			<a
				href={link({ project: null })}
				class="font-display text-base text-muted-foreground italic hover:text-foreground"
				>Harbour, on watch at 14:20 › All projects</a
			>
			<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
				<Monogram name={p.name} size="lg" />
				<h1 class="font-display text-[2.1rem] leading-tight">{p.name}</h1>
				<HealthMark health={health(p)} />
			</div>
			<p class="mt-1 max-w-3xl text-muted-foreground">{p.description}</p>
			<p class="mt-3 max-w-4xl font-display text-[1.35rem] leading-snug">{headlineOf(p)}</p>
			<nav class="mt-5 flex flex-wrap items-end gap-x-1" aria-label="{p.name} pages">
				{#each tabs as x (x)}
					<a
						href={link({ tab: x === 'Log' ? null : x })}
						class="nav-tab -mb-px border-b-2"
						aria-current={x === current ? 'page' : undefined}>{x}</a
					>
				{/each}
				{#if p.repo}
					<a
						href={p.repo}
						target="_blank"
						rel="noreferrer"
						class="nav-tab -mb-px inline-flex items-center gap-1 border-b-2"
						>Repository<ExternalLink class="size-3.5" aria-hidden="true" /></a
					>
				{/if}
				<span class="mb-2 ml-1"><Note n={4} show={notes} /></span>
			</nav>
		{:else}
			<p class="font-display text-base text-muted-foreground italic">Harbour, on watch at 14:20</p>
			<h1 class="mt-2 max-w-4xl text-[2.1rem] leading-tight text-balance">
				{t.needsYou} things need you. {t.underWay} under way in {projects.filter(
					(x) => underWay(x).length
				).length} projects,
				{t.heldUp} held up; {t.landed} landed this week.
			</h1>
		{/if}
	</header>

	{#if notes}
		<aside class="surface mt-6 border-brass/50 p-4 text-sm" aria-label="Notes on this design">
			<p class="mb-2 font-medium">
				What is happening comes first; the projects are the chart you steer by.
			</p>
			<ol class="grid gap-x-8 gap-y-1.5 text-muted-foreground md:grid-cols-2">
				<li>
					<b class="text-foreground">1</b> Every project at a glance, most pressing first: its state and
					what it needs, in a line. Pick one to narrow the page to it; pick it again for all.
				</li>
				<li>
					<b class="text-foreground">2</b> What waits on you, across every project (or the one picked),
					the longest wait first.
				</li>
				<li>
					<b class="text-foreground">3</b> The log: what happened, newest first, each line naming its
					project. Landings, new work, things held up, pull requests.
				</li>
				<li>
					<b class="text-foreground">4</b> A picked project gets its own tabs here: its log, its work,
					each plugin tab such as Git insights, its passage and its repository.
				</li>
			</ol>
		</aside>
	{/if}

	<!-- The chart of every project: a compact tile each, wrapping, never scrolling sideways. -->
	<section class="mt-6" aria-labelledby="chart">
		<h2 id="chart" class="section-label mb-3">Projects <Note n={1} show={notes} /></h2>
		<ul class="grid [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))] gap-2.5">
			{#each sorted as x (x.id)}
				{@const on = p?.id === x.id}
				<li>
					<a
						href={link({ project: on ? null : x.id })}
						aria-current={on ? 'page' : undefined}
						class="flex h-full items-center gap-3 rounded-md border border-l-4 bg-card px-3 py-2.5 transition-colors hover:border-foreground/40 {tileMark[
							health(x)
						]} {on ? 'border-foreground/60 ring-1 ring-foreground/30' : 'border-hair'} {p && !on
							? 'opacity-70 hover:opacity-100'
							: ''}"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-display text-[1.1rem] leading-snug">{x.name}</span>
							<span
								class="block truncate text-xs {health(x) === 'needs-you'
									? 'text-sea'
									: health(x) === 'held-up'
										? 'text-danger'
										: 'text-muted-foreground'}">{tileLine(x)}</span
							>
						</span>
						<Pulse commits={x.commits} landed={x.pulse} width={56} height={18} />
					</a>
				</li>
			{/each}
		</ul>
	</section>

	{#if p && current !== 'Log'}
		<div class="mt-8">
			{#if current === 'Work'}
				<WorkTab project={p} />
			{:else if current === 'Git insights'}
				<GitInsightsTab project={p} />
			{:else}
				<OtherTab project={p} tab={current} />
			{/if}
		</div>
	{:else}
		<div class="mt-8 grid gap-6 {p ? 'xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}">
			<div class="min-w-0 space-y-6">
				{#if moves.length}
					<section class="surface p-5" aria-labelledby="move">
						<h2 id="move" class="section-label mb-4 text-sea">
							Your move <Note n={2} show={notes} />
						</h2>
						<ul class="space-y-2.5">
							{#each moves as m (m.id)}
								<li
									class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-l-4 border-sea/40 border-l-sea bg-sea/5 px-4 py-3"
								>
									{#if !p}<a
											href={link({ project: m.project.id })}
											class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
											><Monogram name={m.project.name} />{m.project.name}</a
										>{/if}
									<span class="min-w-0 flex-1">
										<span class="block font-medium">{m.title}</span>
										<span class="block text-sm text-muted-foreground">{m.now}</span>
									</span>
									<span class="text-xs text-muted-foreground">waiting {waited(m.since)}</span>
									<a
										href="#top"
										class="inline-flex items-center gap-1.5 rounded-md bg-sea px-3 py-1.5 text-sm font-medium text-white dark:text-slate-950"
										>{m.state === 'needs-review' ? 'Review' : 'Answer'}<ArrowRight
											class="size-4"
											aria-hidden="true"
										/></a
									>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<section class="surface p-5" aria-labelledby="log">
					<h2 id="log" class="section-label mb-1">Log <Note n={3} show={notes} /></h2>
					{#each days as g (g.d)}
						<h3 class="mt-4 mb-1 font-display text-base text-muted-foreground italic">{g.d}</h3>
						<ol class="divide-y divide-hair">
							{#each g.list as e, i (i + e.text)}
								{@const Icon = ICON[e.kind]}
								<li
									class="grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] items-start gap-x-3 py-2.5 sm:grid-cols-[4.5rem_1.25rem_13rem_minmax(0,1fr)]"
								>
									<span class="tabular pt-0.5 text-xs whitespace-nowrap text-muted-foreground"
										>{g.d === 'Earlier this week' ? ago(e.at) : clockOf(e.at)}</span
									>
									<Icon class="mt-1 size-4 {TONE[e.kind]}" aria-hidden="true" />
									{#if !p}
										<a
											href={link({ project: e.project.id })}
											class="truncate text-sm text-muted-foreground hover:text-foreground max-sm:col-start-3"
											>{e.project.name}</a
										>
									{/if}
									<span class="text-sm max-sm:col-start-3 {p ? 'sm:col-span-2' : ''}">{e.text}</span
									>
								</li>
							{/each}
						</ol>
					{/each}
					{#if !p && week.length > entries.length}
						<a
							href={link({ log: 'week' })}
							class="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline"
							>The rest of the week, {week.length - entries.length} more</a
						>
					{/if}
				</section>
			</div>

			{#if p}
				<aside class="space-y-6">
					<section class="surface p-5" aria-labelledby="now">
						<h2 id="now" class="section-label mb-2">Under way now</h2>
						<ul class="space-y-3">
							{#each [...heldUp(p), ...moving(p)] as w (w.id)}
								<li>
									<span class="flex items-center justify-between gap-3 text-sm">
										<span class="min-w-0 truncate font-medium">{w.title}</span>
										<Stage task={w} words={false} />
									</span>
									<span class="block text-xs text-muted-foreground">{w.now}</span>
								</li>
							{:else}
								<li class="text-sm text-muted-foreground">Nothing under way.</li>
							{/each}
						</ul>
						<a
							href={link({ tab: 'Work' })}
							class="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline"
							>All its work</a
						>
					</section>
					<section class="surface p-5" aria-labelledby="two">
						<h2 id="two" class="section-label mb-3">Two weeks</h2>
						<Pulse commits={p.commits} landed={p.pulse} width={330} height={56} />
						<p class="mt-2 text-sm text-muted-foreground">
							{landedThisWeek(p).length} landed this week. Main branch {p.main === 'green'
								? 'green'
								: p.main === 'red'
									? 'failing'
									: 'has no checks yet'}; {p.openPRs} open pull {p.openPRs === 1
								? 'request'
								: 'requests'}.
						</p>
					</section>
				</aside>
			{/if}
		</div>
	{/if}
</main>
