<!-- PROTOTYPE, direction B "Logbook": one ruled sheet, one line per project, grouped by what
     it needs. Each line says the one thing that matters in a sentence. Opening a line gives a
     quick look (your move, under way, landed) and the project's pages; "Open project" goes
     to its own page. Built for scanning many projects at once. -->
<script lang="ts">
	import {
		ago,
		byAttention,
		fleetTotals,
		headlineOf,
		health,
		heldUp,
		landedThisWeek,
		queued,
		underWay,
		waited,
		yourMove,
		type FakeProject,
		type Health
	} from './prototype-data';
	import HealthMark from './HealthMark.svelte';
	import Monogram from './Monogram.svelte';
	import Note from './Note.svelte';
	import Pulse from './Pulse.svelte';
	import Stage from './Stage.svelte';
	import {
		ArrowRight,
		Check,
		ChevronDown,
		ExternalLink,
		LayoutGrid,
		Radar,
		Waypoints
	} from '@lucide/svelte';

	let {
		projects,
		open,
		link,
		notes
	}: {
		projects: FakeProject[];
		open: string | null;
		link: (q: Record<string, string | null>) => string;
		notes: boolean;
	} = $props();

	const t = $derived(fleetTotals(projects));
	const GROUPS: { label: string; has: Health[] }[] = [
		{ label: 'Needs you', has: ['needs-you'] },
		{ label: 'Held up', has: ['held-up'] },
		{ label: 'Under way', has: ['new', 'under-way'] },
		{ label: 'Quiet', has: ['quiet'] }
	];
	const sorted = $derived(byAttention(projects));
	const groups = $derived(
		GROUPS.map((g) => ({ ...g, list: sorted.filter((p) => g.has.includes(health(p))) })).filter(
			(g) => g.list.length
		)
	);
	const projectsWith = (f: (p: FakeProject) => boolean) => projects.filter(f).length;
	const first = $derived(groups[0]?.list[0]?.id);
</script>

<main class="px-4 pb-28 sm:px-6 lg:px-10">
	<header class="-mx-4 border-b border-hair bg-panel px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
		<div class="flex flex-wrap items-end justify-between gap-6">
			<div class="max-w-3xl">
				<p class="font-display text-base text-muted-foreground italic">
					Harbour, the log of every project, at 14:20
				</p>
				<h1 class="mt-2 text-[2.1rem] leading-tight text-balance">
					{t.needsYou} things need you in {projectsWith((p) => yourMove(p).length > 0)} projects. {t.underWay}
					under way across {projectsWith((p) => underWay(p).length > 0)}; {t.landed} landed this week.
				</h1>
			</div>
			<div class="flex rounded-md border bg-card p-0.5 text-sm" role="tablist" aria-label="View">
				<span
					role="tab"
					aria-selected="true"
					class="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-medium text-primary-foreground"
					><LayoutGrid class="size-4" />Projects</span
				>
				<a
					href="/harbour?view=passage"
					role="tab"
					aria-selected="false"
					class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground"
					><Waypoints class="size-4" />Passage</a
				>
				<a
					href="/harbour?view=radar"
					role="tab"
					aria-selected="false"
					class="inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground"
					><Radar class="size-4" />Radar</a
				>
			</div>
		</div>
	</header>

	{#if notes}
		<aside class="surface mt-6 border-brass/50 p-4 text-sm" aria-label="Notes on this design">
			<p class="mb-2 font-medium">
				Reading a line. Lines are grouped by what they need from you; open one for a quick look
				without leaving the page.
			</p>
			<ol class="grid gap-x-8 gap-y-1.5 text-muted-foreground md:grid-cols-2 2xl:grid-cols-3">
				<li>
					<b class="text-foreground">1</b> Which project, and how much is going on: under way and landed
					this week.
				</li>
				<li>
					<b class="text-foreground">2</b> The one thing that matters most right now, in a sentence: what
					needs you, what is stuck, or what is moving.
				</li>
				<li>
					<b class="text-foreground">3</b> How busy has it been? Two weeks of commits; a dark bar is a
					day something landed.
				</li>
				<li>
					<b class="text-foreground">4</b> Is it all right? One word, and when anything last happened.
				</li>
				<li>
					<b class="text-foreground">5</b> The quick look: what waits on you, what is moving and at which
					step, and what landed.
				</li>
				<li>
					<b class="text-foreground">6</b> The project's own pages, one click away: its page, each plugin
					tab such as Git insights, its passage and its repository.
				</li>
			</ol>
		</aside>
	{/if}

	<section class="surface mt-6" aria-label="Every project">
		<div
			class="hidden grid-cols-[17rem_minmax(0,1fr)_8rem_7.5rem_6.5rem_1.5rem] gap-x-5 border-b border-hair px-5 py-2.5 text-xs text-muted-foreground lg:grid"
		>
			<span>Project</span><span>What is happening</span><span>Two weeks</span><span>State</span
			><span class="text-right">Last</span><span></span>
		</div>
		{#each groups as g (g.label)}
			<h2 class="section-label px-5 pt-5 pb-1 {g.label === 'Needs you' ? 'text-sea' : ''}">
				{g.label} <span class="tabular text-base">{g.list.length}</span>
			</h2>
			<ul>
				{#each g.list as p (p.id)}
					{@const isOpen = open === p.id}
					{@const n = notes && p.id === first}
					{@const moves = yourMove(p)}
					{@const held = heldUp(p)}
					{@const going = underWay(p).filter((x) => !moves.includes(x) && !held.includes(x))}
					<li class="border-b border-hair last:border-b-0 {isOpen ? 'bg-panel' : ''}">
						<a
							href={link({ open: isOpen ? null : p.id })}
							aria-expanded={isOpen}
							class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-3.5 hover:bg-accent/40 lg:grid-cols-[17rem_minmax(0,1fr)_8rem_7.5rem_6.5rem_1.5rem]"
						>
							<span class="flex min-w-0 items-center gap-3">
								<Monogram name={p.name} />
								<span class="min-w-0">
									<span class="block truncate font-display text-[1.2rem] leading-snug"
										>{p.name}</span
									>
									<span class="block text-xs text-muted-foreground">
										{underWay(p).length} under way · {landedThisWeek(p).length} landed this week
									</span>
								</span>
								<Note n={1} show={n} />
							</span>
							<span
								class="col-span-2 flex min-w-0 items-start gap-2 text-sm max-lg:order-last lg:col-span-1"
							>
								<span
									class="min-w-0 {moves.length
										? 'text-sea'
										: held.length || p.main === 'red' || p.passageProblem
											? 'text-danger'
											: ''}"
								>
									{#if moves.length}<b class="font-semibold">Your move:</b>&nbsp;{/if}{headlineOf(
										p
									)}
								</span>
								<Note n={2} show={n} />
							</span>
							<span class="hidden items-center gap-2 lg:flex"
								><Pulse commits={p.commits} landed={p.pulse} width={96} /><Note
									n={3}
									show={n}
								/></span
							>
							<span class="flex items-center gap-2 max-lg:justify-self-end"
								><HealthMark health={health(p)} size="sm" /><Note n={4} show={n} /></span
							>
							<span class="hidden text-right text-xs text-muted-foreground lg:block"
								>{ago(p.lastActivity)}</span
							>
							<ChevronDown
								class="hidden size-4 text-muted-foreground transition-transform lg:block {isOpen
									? 'rotate-180'
									: ''}"
								aria-hidden="true"
							/>
						</a>

						{#if isOpen}
							<div class="px-5 pb-5">
								<div class="grid gap-6 rounded-md border border-hair bg-card p-4 md:grid-cols-3">
									<div class="min-w-0">
										<h3
											class="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-sea uppercase"
										>
											Your move <Note n={5} show={n} />
										</h3>
										{#each moves as m (m.id)}
											<a
												href="#top"
												class="mb-2 block rounded-md border border-l-4 border-sea/40 border-l-sea bg-sea/5 px-3 py-2 text-sm hover:bg-sea/10"
											>
												<span class="block font-medium">{m.title}</span>
												<span class="block text-xs text-muted-foreground"
													>{m.state === 'needs-review' ? 'Review' : 'Decide'} · waiting {waited(
														m.since
													)}</span
												>
											</a>
										{:else}
											<p class="text-sm text-muted-foreground">Nothing waits on you here.</p>
										{/each}
									</div>
									<div class="min-w-0">
										<h3
											class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
										>
											Under way
										</h3>
										<ul class="space-y-2.5 text-sm">
											{#each [...held, ...going] as w (w.id)}
												<li>
													<span class="flex items-center justify-between gap-3">
														<span class="min-w-0 truncate {held.includes(w) ? 'text-danger' : ''}"
															>{w.title}</span
														>
														<Stage task={w} words={false} />
													</span>
													<span class="block truncate text-xs text-muted-foreground">{w.now}</span>
												</li>
											{:else}
												<li class="text-muted-foreground">Nothing under way.</li>
											{/each}
										</ul>
										{#if queued(p).length}<p class="mt-2 text-xs text-muted-foreground">
												{queued(p).length} queued next
											</p>{/if}
									</div>
									<div class="min-w-0">
										<h3
											class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
										>
											Landed this week
										</h3>
										<ul class="space-y-1.5 text-sm">
											{#each landedThisWeek(p) as l (l.id)}
												<li class="flex items-start gap-2">
													<Check class="mt-1 size-3.5 shrink-0 text-success" aria-hidden="true" />
													<span class="min-w-0 flex-1">{l.title}</span>
													<span class="shrink-0 text-xs text-muted-foreground">{ago(l.since)}</span>
												</li>
											{:else}
												<li class="text-muted-foreground">Nothing this week.</li>
											{/each}
										</ul>
									</div>
								</div>
								<nav
									class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
									aria-label="{p.name} pages"
								>
									<a
										href={link({ project: p.id, open: null })}
										class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
										>Open project<ArrowRight class="size-4" aria-hidden="true" /></a
									>
									{#each p.tabs as tab (tab)}
										<a
											href={link({ project: p.id, open: null, tab })}
											class="text-muted-foreground hover:text-foreground hover:underline">{tab}</a
										>
									{/each}
									{#if p.id !== 'unassigned'}<a
											href={link({ project: p.id, open: null, tab: 'Passage' })}
											class="text-muted-foreground hover:text-foreground hover:underline">Passage</a
										>{/if}
									{#if p.repo}
										<a
											href={p.repo}
											target="_blank"
											rel="noreferrer"
											class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
											>Repository<ExternalLink class="size-3.5" aria-hidden="true" /></a
										>
									{/if}
									<Note n={6} show={n} />
								</nav>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
	</section>
</main>
