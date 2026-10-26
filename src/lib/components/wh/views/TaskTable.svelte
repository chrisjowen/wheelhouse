<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { ago } from '$lib/format';
	import { completedAt, isCompleted } from '$lib/harbour';
	import {
		sortTasks,
		TASK_FIRST_DIR,
		updatedAt,
		waitingOn,
		type Sort,
		type TaskColumn
	} from '$lib/views';
	import SortHeader from './SortHeader.svelte';
	import { dotClass, textClass, tone } from '../tone';

	let {
		tasks,
		projectName,
		sort,
		onsort,
		now,
		label
	}: {
		tasks: TaskSummary[];
		projectName: (t: TaskSummary) => string;
		sort: Sort<TaskColumn>;
		onsort: (s: Sort<TaskColumn>) => void;
		now: number;
		label: string;
	} = $props();

	const rows = $derived(sortTasks(tasks, sort, projectName));
	const when = (t: TaskSummary) => (isCompleted(t) ? completedAt(t) : updatedAt(t));
	const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
	// The task takes what the fixed columns leave; narrow screens drop the secondary ones.
	const COLUMNS: { key: TaskColumn; label: string; class?: string }[] = [
		{ key: 'task', label: 'Task' },
		{ key: 'project', label: 'Project', class: 'hidden w-[10%] md:table-cell' },
		{ key: 'stage', label: 'Stage', class: 'hidden w-[16%] sm:table-cell' },
		{ key: 'status', label: 'Status', class: 'w-[45%] sm:w-[19%]' },
		{ key: 'waiting', label: 'Waiting on', class: 'hidden w-[11%] lg:table-cell' },
		{ key: 'updated', label: 'Updated', class: 'hidden w-[12%] md:table-cell' }
	];
</script>

<!-- One dense row per task; every column sorts. Narrow screens drop the secondary columns. -->
<div class="overflow-hidden rounded-lg border bg-card">
	<table class="w-full table-fixed text-sm" aria-label={label} data-task-table>
		<thead class="border-b border-hair bg-panel text-xs text-muted-foreground">
			<tr>
				{#each COLUMNS as c (c.key)}
					<SortHeader
						label={c.label}
						column={c.key}
						{sort}
						firstDir={TASK_FIRST_DIR[c.key]}
						{onsort}
						class={c.class}
					/>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as t (t.id)}
				{@const tn = tone(t)}
				{@const step = t.passage.steps[t.passage.current]}
				{@const w = waitingOn(t)}
				{@const at = iso(when(t))}
				<tr class="border-b border-hair last:border-0 hover:bg-accent/40">
					<td class="py-2.5 pr-3 pl-4">
						<a
							href="/tasks/{encodeURIComponent(t.id)}"
							class="block truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
							title={t.title}>{t.shortTitle}</a
						>
					</td>
					<td class="hidden px-3 py-2.5 md:table-cell">
						<span class="block truncate text-sea">{projectName(t)}</span>
					</td>
					<td class="hidden px-3 py-2.5 sm:table-cell">
						<!-- The passage as a row of dots, the current step named. -->
						<span
							class="flex min-w-0 items-center gap-2"
							title="Step {t.passage.current + 1} of {t.passage.steps.length}"
						>
							<span class="flex shrink-0 items-center gap-0.5" aria-hidden="true">
								{#each t.passage.steps as s (s.key)}
									<span
										class="size-1.5 rounded-full {s.state === 'current'
											? s.failed
												? 'bg-danger'
												: dotClass[tn]
											: s.state === 'done'
												? 'bg-foreground/45'
												: 'border border-border'}"
									></span>
								{/each}
							</span>
							<span class="truncate {step?.failed ? 'text-danger' : ''}"
								>{step?.label ?? ''}{step?.failed ? ' failed' : ''}</span
							>
						</span>
					</td>
					<td class="px-3 py-2.5">
						<span class="flex min-w-0 items-center gap-1.5 {textClass[tn]}">
							<span class="size-1.5 shrink-0 rounded-full {dotClass[tn]}" aria-hidden="true"
							></span><span class="truncate">{t.statusLabel}</span>
						</span>
					</td>
					<td
						class="hidden truncate px-3 py-2.5 lg:table-cell {w.who === 'you'
							? 'font-medium text-sea'
							: 'text-muted-foreground'}"
					>
						{w.label}
					</td>
					<td
						class="tabular hidden truncate py-2.5 pr-4 pl-3 text-muted-foreground md:table-cell"
						title={at ? new Date(at).toLocaleString() : undefined}
					>
						{at ? ago(at, now) : '—'}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
