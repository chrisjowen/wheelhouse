<!-- PROTOTYPE: roughly what the Git insights plugin's project tab could show (that plugin is
     its own task); here only so the drill-in has a real-looking plugin tab. -->
<script lang="ts">
	import { ago, sum, WHEELHOUSE_INSIGHTS, type FakeProject } from './prototype-data';
	import { GitCommitHorizontal, GitPullRequest, RefreshCw } from '@lucide/svelte';

	let { project }: { project: FakeProject } = $props();

	const fresh = $derived(project.id === 'git-insights-wheelhouse' || sum(project.commits) === 0);
	const g = $derived(
		project.id === 'wheelhouse'
			? WHEELHOUSE_INSIGHTS
			: {
					...WHEELHOUSE_INSIGHTS,
					refreshed: 41,
					people: [
						{
							name: 'Chris Owen',
							commits: sum(project.commits),
							share: 1,
							last: ago(project.lastActivity)
						}
					],
					commits: project.log
						.filter((e) => e.kind === 'landed')
						.map((e) => ({ title: e.text.replace(/ landed$/, ''), who: 'Chris Owen', at: e.at })),
					hotspots: WHEELHOUSE_INSIGHTS.hotspots.slice(0, 3).map((h, i) => ({
						...h,
						changes: Math.max(1, Math.round(sum(project.commits) / (i + 2)))
					})),
					prs: project.openPRs
						? [
								{
									title:
										project.tasks.find((t) => t.stage >= 3 && t.state !== 'landed')?.title ??
										'A change',
									who: 'Firstmate',
									age: 'opened today',
									state: 'Checks running'
								}
							]
						: [],
					figures: [
						{
							label: 'Commits this week',
							value: String(sum(project.commits.slice(7))),
							note: `${sum(project.commits.slice(0, 7))} the week before`
						},
						{
							label: 'Pull requests merged',
							value: String(sum(project.pulse.slice(7))),
							note: 'in the last 7 days'
						},
						{ label: 'Time to merge', value: '5.1 h', note: 'median, last 30 days' },
						{
							label: 'Open pull requests',
							value: String(project.openPRs),
							note: project.openPRs ? 'none older than a week' : 'nothing open'
						}
					]
				}
	);
	const top = $derived(Math.max(...g.hotspots.map((h) => h.changes)));
</script>

<p class="flex items-center gap-2 text-sm text-muted-foreground">
	<RefreshCw class="size-4" aria-hidden="true" />
	From the Git insights plugin. Read from git and GitHub {fresh
		? 'every hour'
		: `${g.refreshed} min ago; it reads again every hour`}.
</p>

{#if fresh}
	<div class="surface mt-5 p-6">
		<h2 class="font-display text-xl">The first read is on its way</h2>
		<p class="mt-2 max-w-2xl text-muted-foreground">
			This repository is new: Git insights reads its history every hour, so people, hotspots and
			pull requests show here after the first read, in about 20 minutes. Three commits so far.
		</p>
	</div>
{:else}
	<!-- The figures, logbook style: a ruled row. -->
	<dl class="surface mt-5 grid grid-cols-2 lg:grid-cols-4">
		{#each g.figures as f, i (f.label)}
			<div
				class="px-5 py-4 {i % 2 ? 'border-l border-hair' : ''} {i > 1
					? 'max-lg:border-t lg:border-l'
					: ''}"
			>
				<dt class="text-xs text-muted-foreground">{f.label}</dt>
				<dd class="tabular mt-1 font-display text-[1.9rem] leading-none">{f.value}</dd>
				<dd class="mt-1.5 text-xs text-muted-foreground">{f.note}</dd>
			</div>
		{/each}
	</dl>

	<div class="mt-6 grid gap-6 lg:grid-cols-2">
		<section class="surface p-5" aria-labelledby="gi-commits">
			<h2 id="gi-commits" class="section-label mb-3">Latest commits</h2>
			<ul class="divide-y divide-hair">
				{#each g.commits as c (c.title)}
					<li class="flex items-start gap-3 py-2.5">
						<GitCommitHorizontal
							class="mt-1 size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span class="min-w-0 flex-1">{c.title}</span>
						<span class="shrink-0 text-xs text-muted-foreground">{c.who}, {ago(c.at)}</span>
					</li>
				{/each}
			</ul>
		</section>

		<div class="grid content-start gap-6">
			<section class="surface p-5" aria-labelledby="gi-hot">
				<h2 id="gi-hot" class="section-label mb-1">Code hotspots</h2>
				<p class="mb-3 text-sm text-muted-foreground">The parts changed most this month.</p>
				<ul class="space-y-2.5">
					{#each g.hotspots as h (h.area)}
						<li class="grid grid-cols-[9rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
							<span class="truncate">{h.area}</span>
							<span class="h-2 rounded-full bg-muted">
								<span
									class="block h-2 rounded-full bg-sea/70"
									style="width: {(h.changes / top) * 100}%"
								></span>
							</span>
							<span class="tabular text-right text-xs text-muted-foreground">{h.changes}</span>
						</li>
					{/each}
				</ul>
			</section>

			<section class="surface p-5" aria-labelledby="gi-people">
				<h2 id="gi-people" class="section-label mb-3">Who works on it</h2>
				<ul class="space-y-2">
					{#each g.people as p (p.name)}
						<li class="flex items-baseline justify-between gap-3 text-sm">
							<span>{p.name}</span>
							<span class="text-xs text-muted-foreground"
								>{p.commits} commits in 30 days · last {p.last}</span
							>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>

	<section class="surface mt-6 p-5" aria-labelledby="gi-prs">
		<h2 id="gi-prs" class="section-label mb-3">Open pull requests</h2>
		{#if g.prs.length}
			<ul class="divide-y divide-hair">
				{#each g.prs as pr (pr.title)}
					<li class="flex items-center gap-3 py-2.5">
						<GitPullRequest class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="min-w-0 flex-1">{pr.title}</span>
						<span class="text-xs text-muted-foreground">{pr.who}, {pr.age}</span>
						<span class="rounded-full border border-hair px-2 text-xs">{pr.state}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-muted-foreground">No open pull requests.</p>
		{/if}
	</section>
{/if}
