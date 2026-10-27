<script lang="ts">
	import type { PassageStep, TaskRun, TaskRuns, ValidationRun } from '$lib/types';
	import { clock } from '$lib/format';
	import { duration } from '$lib/insights';
	import { OUTCOME_LABEL } from '$lib/changes';
	import ChangeRequests from './ChangeRequests.svelte';
	import { Check } from '@lucide/svelte';

	/**
	 * An earlier run of the task, as it went: the changes that started it, the
	 * stages it went through up to its ready report, its validation runs and
	 * screenshots, and how long it took. What ended it (the changes the next
	 * run took up) closes it.
	 */
	let {
		run,
		runs,
		steps,
		validations,
		shots,
		onshot
	}: {
		run: TaskRun;
		runs: TaskRuns;
		steps: PassageStep[];
		validations: ValidationRun[];
		shots: { name: string; url: string }[];
		onshot: (url: string) => void;
	} = $props();

	const next = $derived(runs.runs.find((r) => r.n === run.n + 1) ?? null);
	// A finished run went through every step up to the review (Landed comes once, at the end).
	const reached = $derived(steps.filter((s) => s.key !== 'landed' && s.state !== 'skipped'));
	const built = $derived(
		run.startedAt && run.readyAt
			? duration((Date.parse(run.readyAt) - Date.parse(run.startedAt)) / 1000)
			: null
	);
</script>

<section class="space-y-5" aria-label="Run {run.n}" data-past-run={run.n}>
	{#if run.n > 1}<ChangeRequests {run} />{/if}

	<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
		<div>
			<dt class="text-xs text-muted-foreground">Started</dt>
			<dd>{run.startedAt ? clock(run.startedAt) : 'Not recorded'}</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">Reported ready</dt>
			<dd>{run.readyAt ? clock(run.readyAt) : 'Not reported'}</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">Built in</dt>
			<dd>{built ?? 'Unknown'}</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">Ended</dt>
			<dd>{OUTCOME_LABEL[run.outcome]}{run.endedAt ? ` at ${clock(run.endedAt)}` : ''}</dd>
		</div>
	</dl>

	<ol class="space-y-2" aria-label="Stages of run {run.n}">
		{#each reached as s (s.key)}
			<li class="flex items-center gap-3">
				<span
					class="grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
					aria-hidden="true"><Check class="size-3" /></span
				>
				<span class="font-serif">{s.label}</span>
			</li>
		{/each}
		{#if run.outcome === 'changes-requested'}
			<li class="flex items-center gap-3 text-warning">
				<span class="grid size-5 place-items-center rounded-full border border-warning text-xs"
					>↺</span
				>
				<span
					>Changes requested{next
						? ` (${next.changes.length || 'no written'} ${next.changes.length === 1 ? 'request' : 'requests'}), so run ${next.n} began`
						: ''}</span
				>
			</li>
		{/if}
	</ol>

	<div>
		<h3 class="text-sm font-medium">Checks in this run</h3>
		{#if validations.length}
			<ul class="mt-1.5 space-y-1 text-sm">
				{#each validations as v (v.id)}
					<li>
						<span class="text-muted-foreground">{v.startedAt ? clock(v.startedAt) : ''}</span>
						{v.text}
						<span class="font-mono text-xs text-muted-foreground">({v.id.slice(-6)})</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-sm text-muted-foreground">No validation run was recorded in this run.</p>
		{/if}
	</div>

	<div>
		<h3 class="text-sm font-medium">Screenshots from this run</h3>
		{#if shots.length}
			<div class="mt-2 flex flex-wrap gap-3">
				{#each shots as s (s.url)}
					<button
						type="button"
						class="w-40 shrink-0 cursor-zoom-in text-left"
						onclick={() => onshot(s.url)}
						aria-label="Enlarge {s.name}"
					>
						<img
							src={s.url}
							alt={s.name}
							loading="lazy"
							class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
						/>
						<p class="mt-1.5 truncate text-xs text-muted-foreground">{s.name}</p>
					</button>
				{/each}
			</div>
		{:else}
			<p class="mt-1 text-sm text-muted-foreground">No screenshots were saved in this run.</p>
		{/if}
	</div>
</section>
