<script lang="ts">
	import type { Project, TaskSummary } from '$lib/types';
	import { ago } from '$lib/format';
	import { isCompleted } from '$lib/harbour';
	import { postureWords, type ProjectLink, type ProjectStats } from '$lib/views';
	import { Clock, ExternalLink, ShieldCheck } from '@lucide/svelte';
	import { dotClass, tone } from '../tone';

	let {
		project,
		tasks,
		stats,
		links,
		now
	}: {
		project: Project;
		tasks: TaskSummary[];
		stats: ProjectStats;
		links: ProjectLink[];
		now: number;
	} = $props();

	const posture = $derived(postureWords(project));
	const open = $derived(tasks.filter((t) => !isCompleted(t)));
	const last = $derived(
		stats.lastActivity === null ? null : new Date(stats.lastActivity).toISOString()
	);
	const harbour = $derived(`/harbour?project=${encodeURIComponent(project.id)}`);
	const COUNTS = $derived([
		{ label: 'Under way', n: stats.underWay, on: 'text-foreground' },
		{ label: 'Waiting on you', n: stats.needsYou, on: 'text-sea' },
		{ label: 'Landed this week', n: stats.landed, on: 'text-success' }
	]);
</script>

<article class="surface flex min-w-0 flex-col p-5" aria-labelledby="project-{project.id}">
	<div class="flex items-baseline justify-between gap-3">
		<h2 id="project-{project.id}" class="min-w-0 truncate font-display text-[1.45rem] font-medium">
			<a href={harbour} class="hover:underline">{project.name}</a>
		</h2>
		{#if stats.needsYou}
			<a
				href={harbour}
				class="tabular shrink-0 rounded-full bg-sea px-2 py-0.5 text-xs font-medium text-white dark:text-slate-950"
				>{stats.needsYou} {stats.needsYou === 1 ? 'needs' : 'need'} you</a
			>
		{/if}
	</div>
	<p
		class="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground"
		title={project.description ?? undefined}
	>
		{project.description ?? 'No description in the project registry.'}
	</p>

	<!-- The three counts, logbook style: a ruled row of figures. -->
	<dl class="mt-5 grid grid-cols-3 border-y border-hair">
		{#each COUNTS as c, i (c.label)}
			<div class="px-2 py-3 text-center {i > 0 ? 'border-l border-hair' : ''}">
				<dd
					class="tabular font-display text-[1.9rem] leading-none {c.n
						? c.on
						: 'text-muted-foreground/60'}"
				>
					{c.n}
				</dd>
				<dt class="mt-1.5 text-xs text-muted-foreground">{c.label}</dt>
			</div>
		{/each}
	</dl>

	{#if open.length}
		<!-- Every open task as a dot, coloured by who it waits on; each opens its task. -->
		<ul class="mt-4 flex flex-wrap gap-1.5" aria-label="Open tasks">
			{#each open as t (t.id)}
				<li>
					<a
						href="/tasks/{encodeURIComponent(t.id)}"
						class="block size-3 rounded-full ring-offset-2 ring-offset-card hover:ring-2 hover:ring-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {t.status ===
						'queued'
							? 'border border-muted-foreground/50 bg-card'
							: dotClass[tone(t)]}"
						title="{t.shortTitle}: {t.statusLabel}"
						aria-label="{t.shortTitle}: {t.statusLabel}"
					></a>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-4 mb-5 space-y-2 text-sm">
		<p class="flex gap-2">
			<ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			{#if posture}
				<span>{posture.ships}. <span class="text-muted-foreground">{posture.merges}.</span></span>
			{:else}
				<span class="text-muted-foreground">Not in Firstmate's project registry.</span>
			{/if}
		</p>
		<p class="flex gap-2 text-muted-foreground">
			<Clock class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{#if last}Last activity {ago(last, now)}{:else}No work yet{/if}
		</p>
	</div>

	<nav
		class="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 border-t border-hair pt-3 text-sm"
		aria-label="{project.name} pages"
	>
		{#each links as l (l.href)}
			<a
				href={l.href}
				target={l.external ? '_blank' : undefined}
				rel={l.external ? 'noreferrer' : undefined}
				class="inline-flex items-center gap-1 hover:underline {l.emphasis === 'danger'
					? 'text-danger'
					: l.emphasis === 'sea'
						? 'text-sea'
						: 'text-muted-foreground hover:text-foreground'}"
				>{l.label}{#if l.external}<ExternalLink class="size-3.5" aria-hidden="true" />{/if}</a
			>
		{/each}
	</nav>
</article>
