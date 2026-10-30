<!-- PROTOTYPE: one project's own page, the drill-in from directions A and B. A banner says
     the one thing that matters now; the tabs hold its work, plugin tabs and passage. -->
<script lang="ts">
	import {
		ago,
		headlineOf,
		health,
		landedThisWeek,
		underWay,
		yourMove,
		type FakeProject
	} from './prototype-data';
	import GitInsightsTab from './GitInsightsTab.svelte';
	import HealthMark from './HealthMark.svelte';
	import Monogram from './Monogram.svelte';
	import Note from './Note.svelte';
	import OtherTab from './OtherTab.svelte';
	import WorkTab from './WorkTab.svelte';
	import { ChevronLeft, ExternalLink } from '@lucide/svelte';

	let {
		project: p,
		tab,
		link,
		notes
	}: {
		project: FakeProject;
		tab: string | null;
		link: (q: Record<string, string | null>) => string;
		notes: boolean;
	} = $props();

	const tabs = $derived(['Work', ...p.tabs, ...(p.id === 'unassigned' ? [] : ['Passage'])]);
	const current = $derived(tab && tabs.includes(tab) ? tab : 'Work');
	const facts = $derived(
		[
			`${underWay(p).length} under way`,
			yourMove(p).length ? `${yourMove(p).length} waiting on you` : null,
			`${landedThisWeek(p).length} landed this week`,
			`last activity ${ago(p.lastActivity)}`
		].filter(Boolean)
	);
</script>

<main id="top" class="px-4 pb-28 sm:px-6 lg:px-10">
	<header class="-mx-4 border-b border-hair bg-panel px-4 pt-5 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
		<a
			href={link({ project: null, tab: null })}
			class="inline-flex items-center gap-1 font-display text-base text-muted-foreground italic hover:text-foreground"
			><ChevronLeft class="size-4" aria-hidden="true" />All projects</a
		>
		<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
			<Monogram name={p.name} size="lg" />
			<h1 class="font-display text-[2.1rem] leading-tight">{p.name}</h1>
			<HealthMark health={health(p)} />
			<Note n={1} show={notes} />
		</div>
		<p class="mt-1 max-w-3xl text-muted-foreground">{p.description}</p>
		<p class="mt-4 flex max-w-4xl items-start gap-2 font-display text-[1.35rem] leading-snug">
			{headlineOf(p)}<Note n={2} show={notes} />
		</p>
		<p class="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
			{facts.join(' · ')}<Note n={3} show={notes} />
		</p>

		<nav class="mt-6 flex flex-wrap items-end gap-x-1" aria-label="{p.name} pages">
			{#each tabs as t (t)}
				<a
					href={link({ tab: t === 'Work' ? null : t })}
					class="nav-tab -mb-px border-b-2"
					aria-current={t === current ? 'page' : undefined}>{t}</a
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
	</header>

	{#if notes}
		<aside class="surface mt-6 border-brass/50 p-4 text-sm" aria-label="Notes on this page">
			<p class="mb-2 font-medium">What each part of a project's page answers</p>
			<ol class="grid gap-x-8 gap-y-1.5 text-muted-foreground md:grid-cols-2">
				<li>
					<b class="text-foreground">1</b> Which project, and is it all right? One word: Needs you, Held
					up, Under way, Quiet or New.
				</li>
				<li><b class="text-foreground">2</b> What matters most right now, in one sentence.</li>
				<li>
					<b class="text-foreground">3</b> How busy it is: open work, waiting on you, landed this week,
					last activity.
				</li>
				<li>
					<b class="text-foreground">4</b> Everything about the project in one row: its work, each plugin's
					tab (such as Git insights), its passage and its repository.
				</li>
			</ol>
		</aside>
	{/if}

	<div class="mt-6">
		{#if current === 'Work'}
			<WorkTab project={p} />
		{:else if current === 'Git insights'}
			<GitInsightsTab project={p} />
		{:else}
			<OtherTab project={p} tab={current} />
		{/if}
	</div>
</main>
