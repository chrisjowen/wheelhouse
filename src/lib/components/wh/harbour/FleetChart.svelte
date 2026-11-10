<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { FleetChart } from '$lib/fleetchart';
	import type { ProjectLabel } from '$lib/projectnames';
	import { cue, fadeQuick, MOTION, pop, reducedMotion, rise } from '$lib/motion';
	import { LANES, laneLabel, type Signal } from '$lib/radar';
	import { Ship } from '@lucide/svelte';

	/**
	 * The fleet at a glance, at the top of the Harbour: a quiet line per project
	 * with work on it, each task a small vessel at its lane from Queued to Landed.
	 * Only a call on the captain carries a standing label; every other vessel names
	 * itself on hover or focus. Nothing moves until something changes: a vessel
	 * glides when it changes lane and ripples once when it lands. A vessel opens
	 * its task's page; a project's name opens the project.
	 */
	let { chart, labels }: { chart: FleetChart; labels: Map<string, ProjectLabel> } = $props();

	const WORD: Record<Signal, string> = {
		you: 'waiting on you',
		stuck: 'held up',
		firstmate: 'with Firstmate',
		busy: 'working now',
		idle: 'under way',
		landed: 'landed'
	};
	const DOT: Record<Signal, string> = {
		busy: 'rounded-full bg-foreground',
		idle: 'rounded-full border-[1.5px] border-foreground/60 bg-card',
		firstmate: 'rounded-full border-[1.5px] border-foreground/60 bg-card',
		you: 'rounded-full bg-amber ring-[3px] ring-amber/30',
		stuck: 'rotate-45 rounded-[1px] bg-danger',
		landed: 'rounded-full bg-success'
	};
	const TONE: Partial<Record<Signal, string>> = { you: 'text-warning', stuck: 'text-danger' };
	const KEY: [Signal, string][] = [
		['busy', 'Working'],
		['idle', 'Under way'],
		['you', 'Waiting on you'],
		['stuck', 'Held up'],
		['landed', 'Landed']
	];
</script>

{#snippet dot(signal: Signal)}
	<span class="relative block size-2.5 {DOT[signal]}" aria-hidden="true"></span>
{/snippet}

<section class="surface mt-6 px-4 pt-3 pb-2 sm:px-5" aria-labelledby="fleet-chart" data-fleet-chart>
	<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
		<h2 id="fleet-chart" class="section-label">The fleet</h2>
		<ul
			class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground max-md:hidden"
			aria-label="Key"
		>
			{#each KEY as [s, word] (s)}
				<li class="flex items-center gap-1.5">{@render dot(s)}{word}</li>
			{/each}
			<li class="flex items-center gap-1.5">
				<span
					class="block size-2.5 rounded-full outline-1 outline-offset-2 outline-brass outline-dashed"
					aria-hidden="true"
				></span>
				Second mate
			</li>
		</ul>
	</div>

	<div class="relative mt-2">
		<!-- The lanes' edges, faint, behind every row; Landed is a little greener. -->
		<div
			class="pointer-events-none absolute inset-y-0 right-0 left-9 grid grid-cols-5 sm:left-44"
			aria-hidden="true"
		>
			{#each LANES as l (l.key)}
				<div
					class="border-l border-dashed border-brass/30 {l.key === 'landed'
						? 'bg-gradient-to-r from-success/[0.06] to-transparent'
						: ''}"
				></div>
			{/each}
		</div>

		<div class="flex text-xs text-muted-foreground" aria-hidden="true">
			<span class="w-9 shrink-0 sm:w-44"></span>
			<span class="grid flex-1 grid-cols-5">
				{#each LANES as l (l.key)}
					<span class="truncate pl-1.5 tracking-wide [font-variant-caps:all-small-caps]"
						>{l.label}</span
					>
				{/each}
			</span>
		</div>

		<ol aria-label="Work by project">
			{#each chart.rows as row (row.project.id)}
				{@const l = labels.get(row.project.id)}
				<li
					class="relative flex border-t border-hair/60 transition-[height] duration-300 first:border-t-0 focus-within:z-10 hover:z-10 {row.labelled
						? 'h-11'
						: 'h-7'}"
					data-chart-row={row.project.id}
					animate:flip={{ duration: reducedMotion() ? 0 : MOTION.panel }}
					in:rise
					out:fadeQuick
				>
					<a
						href="/projects/{encodeURIComponent(row.project.id)}"
						class="flex h-7 w-9 min-w-0 shrink-0 items-center gap-2 pr-2 text-sm hover:underline sm:w-44"
						title={l?.full ?? row.project.name}
					>
						{#if l}<span class="project-tile" data-hue={l.hue} aria-hidden="true">{l.monogram}</span
							>{/if}
						<span class="min-w-0 truncate max-sm:sr-only">{l?.label ?? row.project.name}</span>
						{#each row.mates as m (m.id)}
							<span
								class="shrink-0 text-brass max-sm:hidden"
								title={m.where === 'remote'
									? `Work on second mate ${m.id}, on ${m.host ?? 'another host'}`
									: `Work on second mate ${m.id}, on this computer`}
								data-chart-mate={m.id}
								><Ship class="size-3.5" aria-hidden="true" /><span class="sr-only"
									>, work on second mate {m.id}</span
								></span
							>
						{/each}
					</a>

					<!-- The line runs level with the project's name; a call's label hangs just under it. -->
					<div class="@container relative h-full flex-1">
						<span
							class="absolute inset-x-0 top-3.5 border-t border-dotted border-foreground/15"
							aria-hidden="true"
						></span>
						<!-- The wake: how far this project's open work has got. -->
						<span
							class="absolute top-3.5 left-0 h-px -translate-y-px bg-foreground/30 transition-[width] duration-700 ease-out"
							style="width: {row.reach}%"
							aria-hidden="true"
						></span>
						<ul aria-label="{row.project.name}, {row.vessels.length} on the chart">
							{#each row.vessels as v (v.blip.id)}
								{@const t = v.blip.task}
								{@const flipped = v.x > 60}
								{@const standing = row.labelled === v.blip.id}
								<li
									class="absolute top-3.5 -translate-x-1/2 -translate-y-1/2 transition-[left,opacity] duration-700 ease-out focus-within:z-20 hover:z-20"
									style="left: {v.x}%; opacity: {v.blip.opacity}"
									out:fadeQuick
								>
									<a
										href="/tasks/{encodeURIComponent(t.id)}"
										class="group relative flex items-center rounded-full p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label="{t.shortTitle}: {laneLabel(v.blip.lane)}{v.blip.signal === 'landed'
											? ''
											: `, ${WORD[v.blip.signal]}`}{t.secondMate
											? `, on second mate ${t.secondMate.id}`
											: ''}"
										data-vessel={t.id}
									>
										<span
											class="relative block rounded-full transition-transform duration-150 group-hover:scale-125 group-focus-visible:scale-125 {t.secondMate
												? 'outline-1 outline-offset-2 outline-brass outline-dashed'
												: ''}"
											{@attach cue(t.status === 'landed', 'wh-landed')}
											in:pop
										>
											{@render dot(v.blip.signal)}
										</span>
										<span
											class="pointer-events-none absolute top-full -mt-0.5 rounded-sm px-1.5 text-xs leading-5 whitespace-nowrap {flipped
												? 'right-0'
												: 'left-0'} {standing
												? `max-w-[min(16rem,var(--room))] truncate ${TONE[v.blip.signal] ?? ''} group-hover:max-w-none group-hover:border group-hover:border-hair group-hover:bg-popover group-hover:shadow-sm group-focus-visible:max-w-none`
												: 'hidden border border-hair bg-popover text-popover-foreground shadow-sm group-hover:block group-focus-visible:block'}"
											aria-hidden="true"
											style="--room: calc({flipped ? v.x : 100 - v.x}cqw - 0.25rem)"
											data-vessel-tag={standing ? 'standing' : 'hover'}
										>
											{t.shortTitle}<span class="text-muted-foreground"
												>{` · ${WORD[v.blip.signal]}`}</span
											>
										</span>
									</a>
								</li>
							{/each}
						</ul>
						{#each row.more as m (m.x)}
							<a
								href="/projects/{encodeURIComponent(row.project.id)}"
								class="tabular absolute top-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
								style="left: {m.x}%"
								title="{m.count} more in {row.project.name}"
								aria-label="{m.count} more in {row.project.name}">+{m.count}</a
							>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
	</div>
</section>
