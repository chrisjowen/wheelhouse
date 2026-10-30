<!-- PROTOTYPE, direction A "Berths": one page for Projects and Harbour. Every busy project
     gets a card that answers, top to bottom: is it all right, does it need me, what is
     moving, is work landing, how busy has it been, is the code healthy. Quiet projects fold
     into one short list underneath. A card opens the project's own page. -->
<script lang="ts">
	import {
		ago,
		byAttention,
		fleetTotals,
		health,
		heldUp,
		landedThisWeek,
		lastLanded,
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
		ChevronRight,
		Hand,
		LayoutGrid,
		Radar,
		TriangleAlert,
		Waypoints
	} from '@lucide/svelte';

	let {
		projects,
		filter,
		link,
		notes
	}: {
		projects: FakeProject[];
		filter: string | null;
		link: (q: Record<string, string | null>) => string;
		notes: boolean;
	} = $props();

	const t = $derived(fleetTotals(projects));
	const sorted = $derived(byAttention(projects));
	const FILTERS: { key: string | null; label: string; match: (h: Health) => boolean }[] = [
		{ key: null, label: 'All', match: () => true },
		{ key: 'needs-you', label: 'Needs you', match: (h) => h === 'needs-you' },
		{ key: 'held-up', label: 'Held up', match: (h) => h === 'held-up' },
		{ key: 'busy', label: 'Under way', match: (h) => h === 'under-way' || h === 'new' },
		{ key: 'quiet', label: 'Quiet', match: (h) => h === 'quiet' }
	];
	const active = $derived(FILTERS.find((f) => f.key === filter) ?? FILTERS[0]);
	const shown = $derived(sorted.filter((p) => active.match(health(p))));
	const busy = $derived(shown.filter((p) => health(p) !== 'quiet'));
	const quiet = $derived(shown.filter((p) => health(p) === 'quiet'));
	const count = (f: (typeof FILTERS)[number]) => projects.filter((p) => f.match(health(p))).length;
</script>

<main class="px-4 pb-28 sm:px-6 lg:px-10">
	<header class="-mx-4 border-b border-hair bg-panel px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
		<div class="flex flex-wrap items-end justify-between gap-6">
			<div class="max-w-3xl">
				<p class="font-display text-base text-muted-foreground italic">
					Harbour, every project Firstmate looks after, at 14:20
				</p>
				<h1 class="mt-2 text-[2.1rem] leading-tight text-balance">
					{t.projects} projects. {t.needsYou} things need you; {t.underWay} under way, {t.heldUp} held
					up,
					{t.landed} landed this week.
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
		<div
			class="mt-6 flex flex-wrap rounded-md border bg-card p-0.5 text-sm max-sm:w-full sm:inline-flex"
			role="tablist"
			aria-label="Show"
		>
			{#each FILTERS as f (f.label)}
				<a
					href={link({ filter: f.key })}
					role="tab"
					aria-selected={f === active}
					class="rounded-sm px-3 py-1.5 whitespace-nowrap {f === active
						? 'bg-primary font-medium text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					>{f.label} <span class="tabular opacity-70">{count(f)}</span></a
				>
			{/each}
		</div>
	</header>

	{#if notes}
		<aside class="surface mt-6 border-brass/50 p-4 text-sm" aria-label="Notes on this design">
			<p class="mb-2 font-medium">
				Reading a project card, top to bottom. Projects that need you come first; a click anywhere
				on a card opens the project.
			</p>
			<ol class="grid gap-x-8 gap-y-1.5 text-muted-foreground md:grid-cols-2 2xl:grid-cols-3">
				<li>
					<b class="text-foreground">1</b> Which project, and is it all right? One word: Needs you, Held
					up, Under way, Quiet or New.
				</li>
				<li>
					<b class="text-foreground">2</b> Does it need me? The first thing waiting on you (or what is
					stuck), and for how long.
				</li>
				<li>
					<b class="text-foreground">3</b> What is moving, and how far along? Up to three pieces of work
					and the step each is on.
				</li>
				<li>
					<b class="text-foreground">4</b> Is work landing? How much landed this week, and the latest.
				</li>
				<li>
					<b class="text-foreground">5</b> How busy has it been? Two weeks of commits; a dark bar is a
					day something landed.
				</li>
				<li>
					<b class="text-foreground">6</b> Is the code healthy? The main branch's checks and open pull
					requests, from Git insights.
				</li>
			</ol>
		</aside>
	{/if}

	{#if busy.length}
		<div class="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
			{#each busy as p, i (p.id)}
				{@const moves = yourMove(p)}
				{@const held = heldUp(p)}
				{@const going = underWay(p).filter((x) => !moves.includes(x) && !held.includes(x))}
				{@const last = lastLanded(p)}
				{@const n = notes && i === 0}
				<article
					class="surface relative flex min-w-0 flex-col p-5 transition-colors hover:border-foreground/30"
					aria-labelledby="card-{p.id}"
				>
					<div class="flex items-center gap-3">
						<Monogram name={p.name} />
						<h2
							id="card-{p.id}"
							class="min-w-0 flex-1 font-display text-[1.4rem] leading-tight font-medium [overflow-wrap:anywhere]"
						>
							<a
								href={link({ project: p.id })}
								class="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
								>{p.name}</a
							>
						</h2>
						<Note n={1} show={n} />
						<HealthMark health={health(p)} />
					</div>

					{#if moves.length}
						<a
							href={link({ project: p.id })}
							class="relative z-10 mt-4 flex items-start gap-3 rounded-md border border-l-4 border-sea/40 border-l-sea bg-sea/5 px-3 py-2.5 hover:bg-sea/10"
						>
							<Hand class="mt-0.5 size-4 shrink-0 text-sea" aria-hidden="true" />
							<span class="min-w-0 flex-1">
								<span class="block font-medium"
									>{moves[0].state === 'needs-review' ? 'Review' : 'Decide'}: {moves[0].title}</span
								>
								<span class="block text-xs text-muted-foreground"
									>Waiting {waited(moves[0].since)}{moves.length > 1
										? ` · and ${moves.length - 1} more`
										: ''}</span
								>
							</span>
							<Note n={2} show={n} />
							<ArrowRight class="mt-0.5 size-4 shrink-0 text-sea" aria-hidden="true" />
						</a>
					{:else if held.length}
						<a
							href={link({ project: p.id })}
							class="relative z-10 mt-4 flex items-start gap-3 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/5 px-3 py-2.5 hover:bg-danger/10"
						>
							<TriangleAlert class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
							<span class="min-w-0 flex-1">
								<span class="block font-medium">{held[0].title}</span>
								<span class="block text-xs text-muted-foreground">{held[0].now}</span>
							</span>
						</a>
					{:else if p.main === 'red' || p.passageProblem}
						<p
							class="mt-4 flex items-start gap-3 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/5 px-3 py-2.5 text-sm"
						>
							<TriangleAlert class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
							{p.main === 'red' ? 'Checks on the main branch are failing.' : p.passageProblem}
						</p>
					{/if}

					<div class="mt-4 flex items-center gap-2">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Under way
						</h3>
						<Note n={3} show={n} />
					</div>
					{#if going.length}
						<ul class="mt-1.5 space-y-2">
							{#each going.slice(0, 3) as w (w.id)}
								<li class="flex items-center justify-between gap-3 text-sm">
									<span class="min-w-0 truncate">{w.title}</span>
									<Stage task={w} />
								</li>
							{/each}
						</ul>
						{#if going.length > 3 || queued(p).length}
							<p class="mt-1.5 text-xs text-muted-foreground">
								{[
									going.length > 3 ? `${going.length - 3} more under way` : null,
									queued(p).length ? `${queued(p).length} queued` : null
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						{/if}
					{:else}
						<p class="mt-1.5 text-sm text-muted-foreground">
							{moves.length || held.length
								? 'Nothing else under way.'
								: 'Nothing under way.'}{queued(p).length ? ` ${queued(p).length} queued.` : ''}
						</p>
					{/if}

					<p class="mt-4 mb-5 flex items-start gap-2 text-sm">
						<Check class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
						<span class="min-w-0 flex-1">
							{#if last}
								{landedThisWeek(p).length} landed this week.
								<span class="text-muted-foreground">Latest: {last.title}, {ago(last.since)}.</span>
							{:else}
								<span class="text-muted-foreground">Nothing has landed yet.</span>
							{/if}
						</span>
						<Note n={4} show={n} />
					</p>

					<div
						class="mt-auto flex items-center gap-3 border-t border-hair pt-3 text-xs text-muted-foreground"
					>
						<Pulse commits={p.commits} landed={p.pulse} />
						<Note n={5} show={n} />
						<span class="ml-auto text-right">
							{p.main === 'green'
								? 'Main green'
								: p.main === 'red'
									? 'Main failing'
									: 'No checks yet'} · {p.openPRs}
							open {p.openPRs === 1 ? 'pull request' : 'pull requests'}
						</span>
						<Note n={6} show={n} />
					</div>
				</article>
			{/each}
		</div>
	{/if}

	{#if quiet.length}
		<section class="mt-8" aria-labelledby="quiet">
			<h2 id="quiet" class="section-label mb-3">Quiet waters</h2>
			<ul class="surface divide-y divide-hair">
				{#each quiet as p (p.id)}
					{@const last = lastLanded(p)}
					<li>
						<a
							href={link({ project: p.id })}
							class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-accent/50"
						>
							<Monogram name={p.name} />
							<span class="min-w-0 truncate font-display text-[1.15rem] sm:w-56">{p.name}</span>
							<span class="min-w-0 flex-1 text-sm text-muted-foreground max-sm:basis-full">
								Nothing under way. {last
									? `Last landed ${ago(last.since)}: ${last.title}.`
									: 'No work yet.'}
							</span>
							<span class="max-sm:hidden"><Pulse commits={p.commits} landed={p.pulse} /></span>
							<ChevronRight class="size-4 text-muted-foreground max-sm:hidden" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>
