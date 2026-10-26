<script lang="ts">
	import type { Project } from '$lib/types';
	import { ago } from '$lib/format';
	import {
		PROJECT_FIRST_DIR,
		postureWords,
		sortProjects,
		type ProjectColumn,
		type ProjectLink,
		type ProjectStats,
		type Sort
	} from '$lib/views';
	import { ExternalLink } from '@lucide/svelte';
	import SortHeader from './SortHeader.svelte';

	let {
		projects,
		stats,
		links,
		sort,
		onsort,
		now
	}: {
		projects: Project[];
		stats: (p: Project) => ProjectStats;
		links: (p: Project) => ProjectLink[];
		sort: Sort<ProjectColumn>;
		onsort: (s: Sort<ProjectColumn>) => void;
		now: number;
	} = $props();

	const rows = $derived(sortProjects(projects, stats, sort));
	const COLUMNS: { key: ProjectColumn; label: string; class?: string }[] = [
		{ key: 'name', label: 'Project', class: 'w-[30%]' },
		{ key: 'underWay', label: 'Under way', class: 'w-28' },
		{ key: 'needsYou', label: 'Waiting on you', class: 'w-32' },
		{ key: 'landed', label: 'Landed this week', class: 'hidden w-36 md:table-cell' },
		{ key: 'activity', label: 'Last activity', class: 'hidden w-32 md:table-cell' }
	];
</script>

<div class="overflow-hidden rounded-lg border bg-card">
	<table class="w-full table-fixed text-sm" aria-label="Projects" data-project-table>
		<thead class="border-b border-hair bg-panel text-xs text-muted-foreground">
			<tr>
				{#each COLUMNS as c (c.key)}
					<SortHeader
						label={c.label}
						column={c.key}
						{sort}
						firstDir={PROJECT_FIRST_DIR[c.key]}
						{onsort}
						class={c.class}
					/>
				{/each}
				<th scope="col" class="hidden px-3 py-2 pr-4 text-left font-medium lg:table-cell">
					Delivery and pages
				</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as p (p.id)}
				{@const s = stats(p)}
				{@const posture = postureWords(p)}
				{@const last = s.lastActivity === null ? null : new Date(s.lastActivity).toISOString()}
				<tr class="border-b border-hair align-top last:border-0 hover:bg-accent/40">
					<td class="py-3 pr-3 pl-4">
						<a
							href="/harbour?project={encodeURIComponent(p.id)}"
							class="block truncate font-display text-[1.1rem] font-medium hover:underline"
							>{p.name}</a
						>
						<span
							class="block truncate text-xs text-muted-foreground"
							title={p.description ?? undefined}>{p.description ?? 'No description'}</span
						>
					</td>
					<td class="tabular px-3 py-3 text-base {s.underWay ? '' : 'text-muted-foreground/60'}"
						>{s.underWay}</td
					>
					<td
						class="tabular px-3 py-3 text-base {s.needsYou
							? 'font-medium text-sea'
							: 'text-muted-foreground/60'}">{s.needsYou}</td
					>
					<td
						class="tabular hidden px-3 py-3 text-base md:table-cell {s.landed
							? 'text-success'
							: 'text-muted-foreground/60'}">{s.landed}</td
					>
					<td class="tabular hidden px-3 py-3 text-muted-foreground md:table-cell"
						>{last ? ago(last, now) : 'No work yet'}</td
					>
					<td class="hidden py-3 pr-4 pl-3 lg:table-cell">
						<span class="block" title={posture ? `${posture.ships}. ${posture.merges}.` : undefined}
							>{posture?.short ?? 'Not registered'}</span
						>
						<span class="mt-0.5 flex flex-wrap gap-x-3 text-xs">
							{#each links(p) as l (l.href)}
								<a
									href={l.href}
									target={l.external ? '_blank' : undefined}
									rel={l.external ? 'noreferrer' : undefined}
									class="inline-flex items-center gap-0.5 hover:underline {l.emphasis === 'danger'
										? 'text-danger'
										: l.emphasis === 'sea'
											? 'text-sea'
											: 'text-muted-foreground hover:text-foreground'}"
									>{l.label}{#if l.external}<ExternalLink
											class="size-3"
											aria-hidden="true"
										/>{/if}</a
								>
							{/each}
						</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
