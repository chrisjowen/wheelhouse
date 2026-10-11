<script lang="ts">
	import type { Project, TaskSummary } from '$lib/types';
	import { workerName } from '$lib/format';
	import { chartColumns, progress } from '$lib/harbour';
	import { dotClass, tone, textClass } from './tone';

	let { tasks, projects }: { tasks: TaskSummary[]; projects: Project[] } = $props();

	// Columns come from the tasks' own steps; scout steps align with ship steps.
	const cols = $derived(chartColumns(tasks));
	const template = $derived(`minmax(12rem,18rem) repeat(${cols.length}, minmax(0,1fr))`);
	const rank = (t: TaskSummary) => (tone(t) === 'you' ? -10 : 0) - progress(t);
</script>

<div class="overflow-x-auto">
	<div class="min-w-[52rem]">
		<div
			class="grid border-b pb-2 text-xs text-muted-foreground"
			style="grid-template-columns: {template}"
		>
			<span></span>
			{#each cols as c (c.key)}<span class="text-center">{c.label}</span>{/each}
		</div>
		{#each projects as p (p.id)}
			{@const rows = tasks
				.filter((t) => t.projectId === p.id)
				.toSorted((a, b) => rank(a) - rank(b))}
			{#if rows.length}
				<h2 class="pt-6 pb-2 text-sm font-medium">{p.name}</h2>
				{#each rows as t (t.id)}
					{@const tn = tone(t)}
					{@const byCol = new Map(t.passage.steps.map((s, i) => [s.column, { s, i }]))}
					{@const cur = cols.findIndex((c) => c.key === t.passage.steps[t.passage.current]?.column)}
					<a
						href="/tasks/{encodeURIComponent(t.id)}"
						class="grid items-center rounded-lg py-3 hover:bg-accent/50"
						style="grid-template-columns: {template}"
						aria-label="{t.title}: {t.passage.steps[t.passage.current]?.label}, {t.statusLabel}"
					>
						<div class="min-w-0 pr-4 pl-2">
							<p class="truncate font-medium">{t.title}</p>
							<p
								class="truncate text-xs {tn === 'normal' || tn === 'landed'
									? 'text-muted-foreground'
									: textClass[tn]}"
							>
								{tn === 'normal' ? (workerName(t.worker) ?? t.statusLabel) : t.statusLabel}
							</p>
						</div>
						{#each cols as col, i (col.key)}
							{@const step = byCol.get(col.key)}
							<div
								class="relative flex h-6 items-center justify-center"
								title={step?.s.note ?? undefined}
							>
								{#if i > 0}
									<span
										class="absolute top-1/2 right-1/2 left-[-50%] h-0.5 -translate-y-1/2 {i <= cur
											? 'bg-foreground/50'
											: 'bg-border'}"
									></span>
								{/if}
								{#if i === cur}
									<span
										class="relative z-10 grid size-5 place-items-center rounded-full ring-4 ring-background {dotClass[
											tn
										]}"
									>
										{#if tn === 'you'}<span class="size-1.5 rounded-full bg-background"></span>{/if}
									</span>
								{:else if !step || step.s.state === 'skipped'}
									<span
										class="relative z-10 size-2 rounded-full border border-dashed border-muted-foreground/40 bg-background"
									></span>
								{:else if step.s.state === 'done'}
									<span class="relative z-10 size-2 rounded-full bg-foreground/50"></span>
								{:else}
									<span class="relative z-10 size-2 rounded-full border border-border bg-background"
									></span>
								{/if}
							</div>
						{/each}
					</a>
				{/each}
			{/if}
		{/each}
	</div>
</div>
