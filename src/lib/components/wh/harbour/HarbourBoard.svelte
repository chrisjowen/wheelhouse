<script lang="ts">
	/**
	 * The Harbour board: the task states as columns, a lane per project, each task a card
	 * in its state's column in its project's lane. A lane's name slides the project out
	 * (`onProject`; with Cmd or Ctrl it opens the project's page); a card is a link to its
	 * task, which the shared slide-out (SlideoutHost) slides out. A lane folds to a line of counts; `collapsed` holds the folded
	 * lanes' project ids. On a phone each lane stacks its non-empty columns.
	 *
	 * Each lane is also a race: under its name runs its course, one leg per column, every
	 * task a small ship in its column's leg making for the chequered finish where Landed
	 * begins, with a wake behind the furthest open one. A ship and its card light up
	 * together on hover. A folded lane keeps its course, with each column's count.
	 */
	import { flip } from 'svelte/animate';
	import { ArrowRight, ChevronDown, Flag, Ship } from '@lucide/svelte';
	import {
		BOARD_COLUMNS,
		CELL_CAP,
		cardOutcome,
		cardWait,
		count,
		course,
		progress,
		underWay,
		type BoardColumn,
		type BoardLane,
		type CardTone
	} from '$lib/harbourboard';
	import { fadeQuick, MOTION, reducedMotion, rise } from '$lib/motion';
	import type { ProjectLabel } from '$lib/projectnames';
	import type { TaskSummary } from '$lib/types';
	import Vessel from './Vessel.svelte';

	let {
		lanes,
		labels,
		now,
		landed,
		collapsed,
		onToggle,
		onProject
	}: {
		lanes: BoardLane[];
		labels: Map<string, ProjectLabel>;
		now: number;
		/** Whether the Landed column shows. */
		landed: boolean;
		collapsed: ReadonlySet<string>;
		onToggle: (projectId: string) => void;
		onProject: (projectId: string) => void;
	} = $props();

	const columns = $derived(
		landed ? BOARD_COLUMNS : BOARD_COLUMNS.filter((c) => c.key !== 'landed')
	);
	const cols = $derived(`--cols: repeat(${columns.length}, minmax(0, 1fr))`);
	const total = (key: BoardColumn) => lanes.reduce((n, l) => n + count(l, key), 0);
	const name = (l: BoardLane) =>
		l.project.id === 'unassigned'
			? 'Not yet assigned'
			: (labels.get(l.project.id)?.label ?? l.project.name);

	// A plain click slides the project out; Cmd, Ctrl, Shift or a middle click follow the link.
	const plain = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);
	const open = (e: MouseEvent, f: () => void) => {
		if (!plain(e)) return;
		e.preventDefault();
		f();
	};
	const taskHref = (t: TaskSummary) => `/tasks/${encodeURIComponent(t.id)}`;
	const TONE_TEXT: Record<CardTone, string> = {
		you: 'text-gold',
		working: 'text-working',
		trouble: 'text-danger',
		landed: 'text-teal',
		quiet: ''
	};
	const WAKE: Record<CardTone, string> = {
		you: 'bg-gold/60',
		working: 'bg-working/60',
		trouble: 'bg-danger/60',
		landed: 'bg-teal/60',
		quiet: 'bg-foreground/25'
	};
	/** The task whose ship or card is under the pointer, so the other lights up too. */
	let hovered = $state<string | null>(null);
	const hover = (id: string | null) => () => (hovered = id);
</script>

<div class="harbour-board">
	<div
		class="sticky top-15 z-20 -mx-4 hidden grid-cols-(--cols) gap-3 border-b border-hair bg-background px-4 pt-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-10 lg:grid lg:px-10"
		style={cols}
	>
		{#each columns as c (c.key)}
			<div class="flex items-baseline gap-2 px-1" data-column={c.key}>
				<div class="min-w-0">
					<span class="section-label {c.key === 'you' ? 'text-gold!' : ''}">{c.name}</span>
					<span class="block truncate text-xs text-muted-foreground">{c.hint}</span>
				</div>
				<span class="tabular ml-auto text-xs text-muted-foreground">{total(c.key)}</span>
			</div>
		{/each}
	</div>

	{#each lanes as l (l.project.id)}
		{@const folded = collapsed.has(l.project.id)}
		{@const label = labels.get(l.project.id)}
		{@const moving = underWay(l) - l.heldUp}
		{@const race = course(
			l,
			columns.map((c) => c.key),
			now
		)}
		<section
			class="border-b border-hair"
			data-lane={l.project.id}
			aria-label={name(l)}
			animate:flip={{ duration: reducedMotion() ? 0 : MOTION.panel }}
			in:rise
			out:fadeQuick
		>
			<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-3.5">
				<button
					type="button"
					class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-expanded={!folded}
					aria-label="{folded ? 'Expand' : 'Collapse'} {name(l)}"
					onclick={() => onToggle(l.project.id)}
					><ChevronDown
						class="size-4 transition-transform duration-200 {folded ? '-rotate-90' : ''}"
					/></button
				>
				<a
					href={l.project.id === 'unassigned'
						? '/harbour'
						: `/projects/${encodeURIComponent(l.project.id)}`}
					class="group -ml-1 inline-flex min-w-0 items-center gap-2.5 rounded-md py-1 pr-2 pl-1 hover:bg-accent/60"
					title="About {label?.full ?? name(l)}"
					data-project={l.project.id}
					onclick={(e) => open(e, () => onProject(l.project.id))}
				>
					<span class="project-tile" data-hue={label?.hue ?? 0} aria-hidden="true"
						>{l.project.id === 'unassigned' ? 'NA' : (label?.monogram ?? '?')}</span
					>
					<span
						class="truncate font-display text-[1.3rem] leading-tight decoration-gold decoration-1 underline-offset-4 group-hover:underline"
						>{name(l)}</span
					>
					<ArrowRight
						class="size-4 shrink-0 text-muted-foreground group-hover:text-gold"
						aria-hidden="true"
					/>
				</a>
				{#if l.project.secondMates?.length}
					<span
						class="flex shrink-0 items-center gap-1 text-xs text-brass"
						data-project-second-mates
					>
						<Ship class="size-3.5" aria-hidden="true" />Work on second {l.project.secondMates
							.length === 1
							? 'mate'
							: 'mates'}
						{l.project.secondMates.join(', ')}
					</span>
				{/if}
				<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground max-md:hidden"
					>{l.project.description ?? ''}</span
				>
				<span class="flex flex-wrap gap-1.5 max-md:basis-full max-md:pl-9 md:ml-auto">
					{#if count(l, 'you')}<span class="pill border-gold/45 bg-gold/10 text-gold"
							>{count(l, 'you')} waiting on you</span
						>{/if}
					{#if l.heldUp}<span class="pill border-danger/40 text-danger">{l.heldUp} held up</span
						>{/if}
					{#if moving > 0}<span class="pill border-working/40 text-working">{moving} under way</span
						>{/if}
					{#if count(l, 'queued')}<span class="pill border-border text-muted-foreground"
							>{count(l, 'queued')} queued</span
						>{/if}
				</span>
			</div>

			<div class="relative" data-race>
				<!-- The legs' edges, faint, behind the course and the cards; the finish is chequered. -->
				<div
					class="pointer-events-none absolute inset-0 hidden grid-cols-(--cols) gap-3 lg:grid"
					style={cols}
					aria-hidden="true"
				>
					{#each columns as c, i (c.key)}
						<div
							class="relative {c.key === 'landed'
								? 'bg-gradient-to-r from-teal/[0.05] to-transparent'
								: ''}"
						>
							{#if c.key === 'landed'}
								<span class="wh-finish absolute inset-y-0 -left-[0.55rem] w-1.5 opacity-70"></span>
							{:else if i > 0}
								<span class="absolute inset-y-0 -left-1.5 border-l border-dashed border-brass/25"
								></span>
							{/if}
						</div>
					{/each}
				</div>

				<div
					class="relative grid grid-cols-(--cols) gap-3 {folded ? 'pb-3' : 'pb-2'}"
					style={cols}
					data-course
					data-folded={folded ? '' : undefined}
				>
					{#each race.legs as leg, i (leg.column)}
						{@const n = count(l, leg.column)}
						<div class="relative h-6" data-leg={leg.column}>
							<span
								class="absolute top-1/2 border-t border-dotted border-foreground/20 {i
									? 'left-[-0.375rem]'
									: 'left-0'} {i < race.legs.length - 1 ? 'right-[-0.375rem]' : 'right-0'}"
								aria-hidden="true"
							></span>
							{#if race.reach && i <= race.reach.leg}
								<span
									class="absolute top-1/2 h-px -translate-y-px bg-foreground/35 transition-[width] duration-700 ease-out"
									style="left: {i ? '-0.375rem' : '0'}; width: calc({i < race.reach.leg
										? '100%'
										: `${race.reach.x}%`} + {i ? 0.375 : 0}rem + {i < race.reach.leg
										? 0.375
										: 0}rem)"
									aria-hidden="true"
								></span>
							{/if}
							{#if leg.column === 'landed'}
								<Flag
									class="absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-teal/70"
									aria-hidden="true"
								/>
							{/if}
							{#if leg.more}
								<span
									class="tabular absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-background px-0.5 text-[10px] text-muted-foreground"
									style="left: {leg.more.x}%"
									title="{leg.more.count} more">+{leg.more.count}</span
								>
							{/if}
							{#each leg.vessels as v (v.task.id)}
								<a
									href={taskHref(v.task)}
									class="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-sm bg-background px-0.5 transition-[left,transform] duration-700 ease-out outline-none hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring {hovered ===
									v.task.id
										? 'z-10 scale-125'
										: ''}"
									style="left: {v.x}%"
									title="{v.task.shortTitle} · {cardWait(v.task, leg.column, now).text}"
									aria-label="{v.task.shortTitle}: {cardWait(v.task, leg.column, now).text}"
									data-vessel={v.task.id}
									onmouseenter={hover(v.task.id)}
									onmouseleave={hover(null)}
									onfocus={hover(v.task.id)}
									onblur={hover(null)}
									>{#if v.tone !== 'quiet' && leg.column !== 'landed'}<span
											class="mr-px h-px w-2.5 bg-gradient-to-r from-transparent max-sm:hidden {WAKE[
												v.tone
											]}"
											aria-hidden="true"
										></span>{/if}<Vessel tone={v.tone} class="h-3.5 w-4" /></a
								>
							{/each}
							{#if folded}
								<span
									class="tabular absolute top-1/2 right-0 -translate-y-1/2 bg-background pl-1 text-xs {leg.column ===
									'landed'
										? 'mr-5'
										: ''} {n
										? leg.column === 'you'
											? 'text-gold'
											: 'text-muted-foreground'
										: 'text-muted-foreground/40'}">{n || '·'}</span
								>
							{/if}
						</div>
					{/each}
				</div>

				{#if !folded}
					<div class="relative grid gap-3 pb-4 lg:grid-cols-(--cols)" style={cols}>
						{#each columns as c (c.key)}
							{@const tasks = l.cells[c.key]}
							{@const cap = CELL_CAP[c.key]}
							<div
								class="flex flex-col gap-2 self-start rounded-lg {tasks.length
									? c.key === 'you'
										? 'bg-gold/8 p-1.5 lg:-m-1.5'
										: ''
									: 'max-lg:hidden'}"
								data-cell={c.key}
							>
								<span class="section-label lg:hidden {c.key === 'you' ? 'text-gold!' : ''}"
									>{c.name}</span
								>
								{#each tasks.slice(0, cap) as t (t.id)}
									{@const w = cardWait(t, c.key, now)}
									{@const line = cardOutcome(t, c.key)}
									{@const sailed = progress(t, c.key)}
									<a
										href={taskHref(t)}
										class="relative block overflow-hidden rounded-lg border px-3 transition-[border-color,box-shadow] hover:border-foreground/30 {c.key ===
										'landed'
											? 'py-2'
											: 'bg-card py-2.5'} {c.key === 'you'
											? 'border-l-[3px] border-gold/55 border-l-gold'
											: w.tone === 'trouble'
												? 'border-l-[3px] border-l-danger'
												: ''} {hovered === t.id ? 'border-foreground/30 shadow-sm' : ''}"
										title={t.title}
										data-task={t.id}
										onmouseenter={hover(t.id)}
										onmouseleave={hover(null)}
									>
										<span
											class="text-[0.83rem] leading-snug {c.key === 'landed'
												? 'line-clamp-1 text-muted-foreground'
												: 'line-clamp-2 font-medium'}">{t.shortTitle}</span
										>
										{#if line}<span
												class="mt-0.5 line-clamp-2 text-[0.78rem] leading-snug text-muted-foreground"
												>{line}</span
											>{/if}
										<span
											class="mt-2 flex items-center gap-1.5 text-[0.72rem] text-muted-foreground"
										>
											<Vessel tone={w.tone} />
											<span class="font-medium {TONE_TEXT[w.tone]}">{w.text}</span>
											{#if w.when}<span class="tabular ml-auto font-mono text-[0.66rem]"
													>{w.when}</span
												>{/if}
										</span>
										<!-- Its own wake along the keel: how far through its passage it has sailed. -->
										<span
											class="absolute inset-x-0 bottom-0 border-t border-dotted border-foreground/10"
											aria-hidden="true"
										></span>
										{#if sailed > 0}<span
												class="absolute bottom-0 left-0 h-[2px] transition-[width] duration-700 ease-out {WAKE[
													w.tone
												]}"
												style="width: {sailed * 100}%"
												aria-hidden="true"
											></span>{/if}
									</a>
								{/each}
								{#if tasks.length > cap}
									<button
										type="button"
										class="px-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
										onclick={() => onProject(l.project.id)}
										>+ {tasks.length - cap} more{c.key === 'landed' ? ' landed' : ''}</button
									>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/each}
</div>

<style>
	.pill {
		border-width: 1px;
		border-radius: 9999px;
		padding: 0.05rem 0.55rem;
		font-size: 0.72rem;
		white-space: nowrap;
	}
</style>
