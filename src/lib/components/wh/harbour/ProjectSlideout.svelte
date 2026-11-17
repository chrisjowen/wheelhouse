<script lang="ts">
	/**
	 * A project slid out over the Harbour board from its lane: what it is, what it has open
	 * and what waits on the captain, every task it has on the board, and Open project page
	 * for the whole of it. A task's line slides that task out instead (`onTask`). It is a
	 * dialog: Escape, a click outside or Close shut it, and focus goes back to the lane.
	 */
	import { Dialog } from 'bits-ui';
	import { ArrowUpRight, X } from '@lucide/svelte';
	import { BOARD_COLUMNS, cardWait, count, underWay, type BoardLane } from '$lib/harbourboard';
	import type { ProjectLabel } from '$lib/projectnames';
	import type { Project } from '$lib/types';
	import CardDot from './CardDot.svelte';

	let {
		project,
		lane,
		label,
		now,
		onClose,
		onTask
	}: {
		/** The project slid out, or null while none is. */
		project: Project | null;
		/** Its lane on the board, or null when it is in quiet waters. */
		lane: BoardLane | null;
		label: ProjectLabel | undefined;
		now: number;
		onClose: () => void;
		onTask: (id: string) => void;
	} = $props();

	const unassigned = $derived(project?.id === 'unassigned');
	const name = $derived(unassigned ? 'Not yet assigned' : (label?.label ?? project?.name ?? ''));
	const columns = $derived(
		lane ? BOARD_COLUMNS.flatMap((c) => lane.cells[c.key].map((t) => ({ t, c }))) : []
	);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<Dialog.Root open={!!project} onOpenChange={(o) => !o && onClose()}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/45 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
		/>
		<Dialog.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-y-auto bg-panel px-6 pt-6 pb-10 text-foreground shadow-2xl duration-300 outline-none sm:w-[34rem] sm:border-l sm:border-hair data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
			data-project-slideout={project?.id}
		>
			{#if project}
				<Dialog.Close
					class="absolute top-4 right-4 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Close"><X class="size-4" /></Dialog.Close
				>
				<div class="flex items-center gap-3">
					<span class="project-tile size-10! text-sm!" data-hue={label?.hue ?? 0} aria-hidden="true"
						>{unassigned ? 'NA' : (label?.monogram ?? '?')}</span
					>
					<span class="section-label">Project</span>
				</div>
				<Dialog.Title class="mt-3 mr-10 font-display text-[1.9rem] leading-tight"
					>{name}</Dialog.Title
				>
				<Dialog.Description class="mt-1 text-muted-foreground">
					{project.description ??
						(unassigned
							? 'Work Firstmate has not filed under a project yet.'
							: 'No description in the project registry.')}
				</Dialog.Description>

				<dl class="mt-5 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
					{#if project.posture}
						<dt class="text-muted-foreground">Posture</dt>
						<dd>{project.posture}</dd>
					{/if}
					{#if project.secondMates?.length}
						<dt class="text-muted-foreground">Second mates</dt>
						<dd class="text-brass">{project.secondMates.join(', ')}</dd>
					{/if}
					<dt class="text-muted-foreground">Open work</dt>
					<dd>
						{lane
							? plural(underWay(lane) + count(lane, 'queued') + count(lane, 'you'), 'task', 'tasks')
							: 'Nothing open'}{#if lane && count(lane, 'you')},
							<span class="text-gold">{count(lane, 'you')} waiting on you</span>{/if}
					</dd>
					<dt class="text-muted-foreground">Landed today</dt>
					<dd>{lane ? count(lane, 'landed') : 0}</dd>
				</dl>

				{#if !unassigned}
					<a
						href="/projects/{encodeURIComponent(project.id)}"
						class="mt-6 inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
						data-open-project
						>Open project page <ArrowUpRight class="size-4" aria-hidden="true" /></a
					>
				{/if}

				{#if columns.length}
					<h3 class="section-label mt-8 mb-2">On the board</h3>
					<ul class="divide-y divide-hair rounded-md border border-hair">
						{#each columns as { t, c } (t.id)}
							{@const w = cardWait(t, c.key, now)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/60"
									onclick={() => onTask(t.id)}
								>
									<CardDot tone={w.tone} />
									<span class="min-w-0 flex-1">{t.shortTitle}</span>
									<span
										class="shrink-0 text-xs {c.key === 'you'
											? 'text-gold'
											: 'text-muted-foreground'}">{c.name}</span
									>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-8 text-muted-foreground">Nothing open. Quiet waters.</p>
				{/if}
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
