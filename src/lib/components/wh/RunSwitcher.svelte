<script lang="ts">
	import type { TaskRuns } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { OUTCOME_LABEL, runLine } from '$lib/changes';

	/**
	 * The task's runs as a short logbook: each run with how it went, the
	 * current one last. Selecting one shows its own stages, checks, screenshots
	 * and time on the task page.
	 */
	let {
		runs,
		selected,
		onselect
	}: { runs: TaskRuns; selected: number; onselect: (n: number) => void } = $props();

	const TONE: Record<string, string> = {
		building: 'text-foreground',
		ready: 'text-sea',
		'changes-requested': 'text-warning',
		landed: 'text-success',
		closed: 'text-muted-foreground'
	};
</script>

<nav aria-label="Runs" data-runs>
	<ol class="flex flex-wrap gap-2">
		{#each runs.runs as r (r.n)}
			<li>
				<button
					type="button"
					class="flex min-w-44 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors {r.n ===
					selected
						? 'border-foreground/40 bg-panel'
						: 'border-hair hover:border-input'}"
					aria-pressed={r.n === selected}
					onclick={() => onselect(r.n)}
					data-run={r.n}
				>
					<span class="text-sm font-medium"
						>Run {r.n}{r.n === runs.current ? ' · current' : ''}</span
					>
					<span class="text-xs {TONE[r.outcome]}">{OUTCOME_LABEL[r.outcome]}</span>
					<span class="tabular mt-0.5 text-xs text-muted-foreground"
						>{runLine(runs, r, live.now)}</span
					>
				</button>
			</li>
		{/each}
	</ol>
</nav>
