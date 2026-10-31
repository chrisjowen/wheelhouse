<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { tone } from '../tone';

	/** Where a task is on its passage: a short tick per step, the current one marked, and its name. */
	let { task }: { task: TaskSummary } = $props();

	const p = $derived(task.passage);
	const step = $derived(p.steps[p.current]);
	const t = $derived(step?.failed ? 'trouble' : tone(task));
	const on = $derived(t === 'trouble' ? 'bg-danger' : t === 'you' ? 'bg-sea' : 'bg-foreground/70');
	const text = $derived(
		t === 'trouble' ? 'text-danger' : t === 'you' ? 'text-sea' : 'text-muted-foreground'
	);
</script>

{#if step}
	<span
		class="inline-flex shrink-0 items-center gap-2"
		title="Step {p.current + 1} of {p.steps.length}: {step.label}{step.failed ? ', failed' : ''}"
	>
		<span class="flex gap-0.5" aria-hidden="true">
			{#each p.steps as s, i (s.key)}
				<span
					class="h-1.5 w-2.5 rounded-full {i < p.current
						? 'bg-foreground/35'
						: i === p.current
							? on
							: 'bg-foreground/10'}"
				></span>
			{/each}
		</span>
		<span class="text-xs whitespace-nowrap {text}">{step.label}{step.failed ? ' failed' : ''}</span>
	</span>
{/if}
