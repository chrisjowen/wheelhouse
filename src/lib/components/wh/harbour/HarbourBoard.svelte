<script lang="ts">
	/**
	 * The Harbour board: the task states as columns, a lane per project, each task a card
	 * in its state's column in its project's lane. A lane's name slides the project out
	 * (`onProject`; with Cmd or Ctrl it opens the project's page) and a card slides the
	 * task out (`onTask`). A lane folds to a line of counts; `collapsed` holds the folded
	 * lanes' project ids. On a phone each lane stacks its non-empty columns.
	 */
	import { flip } from 'svelte/animate';
	import { ArrowRight, ChevronDown, Ship } from '@lucide/svelte';
	import {
		BOARD_COLUMNS,
		CELL_CAP,
		cardOutcome,
		cardWait,
		count,
		underWay,
		type BoardColumn,
		type BoardLane,
		type CardTone
	} from '$lib/harbourboard';
	import { fadeQuick, MOTION, reducedMotion, rise } from '$lib/motion';
	import type { ProjectLabel } from '$lib/projectnames';
	import type { TaskSummary } from '$lib/types';
	import CardDot from './CardDot.svelte';

	let {
		lanes,
		labels,
		now,
		landed,
		collapsed,
		onToggle,
		onProject,
		onTask
	}: {
		lanes: BoardLane[];
		labels: Map<string, ProjectLabel>;
		now: number;
		/** Whether the Landed column shows. */
		landed: boolean;
		collapsed: ReadonlySet<string>;
		onToggle: (projectId: string) => void;
		onProject: (projectId: string) => void;
		onTask: (taskId: string) => void;
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

	// A plain click slides out over the board; Cmd, Ctrl, Shift or a middle click follow the link.
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

			{#if folded}
				<div class="hidden grid-cols-(--cols) gap-3 pb-3 lg:grid" style={cols} data-folded>
					{#each columns as c (c.key)}
						{@const n = count(l, c.key)}
						<span
							class="tabular pl-1 text-xs {n
								? c.key === 'you'
									? 'text-gold'
									: 'text-muted-foreground'
								: 'text-muted-foreground/40'}">{n || '·'}</span
						>
					{/each}
				</div>
			{:else}
				<div class="grid gap-3 pb-4 lg:grid-cols-(--cols)" style={cols}>
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
								<a
									href={taskHref(t)}
									class="block rounded-lg border px-3 transition-colors hover:border-foreground/30 {c.key ===
									'landed'
										? 'py-2'
										: 'bg-card py-2.5'} {c.key === 'you'
										? 'border-l-[3px] border-gold/55 border-l-gold'
										: w.tone === 'trouble'
											? 'border-l-[3px] border-l-danger'
											: ''}"
									title={t.title}
									data-task={t.id}
									onclick={(e) => open(e, () => onTask(t.id))}
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
									<span class="mt-2 flex items-center gap-1.5 text-[0.72rem] text-muted-foreground">
										<CardDot tone={w.tone} />
										<span class="font-medium {TONE_TEXT[w.tone]}">{w.text}</span>
										{#if w.when}<span class="tabular ml-auto font-mono text-[0.66rem]"
												>{w.when}</span
											>{/if}
									</span>
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
