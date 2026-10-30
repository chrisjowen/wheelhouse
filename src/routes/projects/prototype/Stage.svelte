<!-- PROTOTYPE: where a task is on its passage, as six short ticks and the stage's name. -->
<script lang="ts">
	import { STAGES, type FakeTask } from './prototype-data';

	let { task, words = true }: { task: FakeTask; words?: boolean } = $props();

	const trouble = $derived(['blocked', 'failed', 'lost'].includes(task.state));
	const yours = $derived(task.state === 'needs-review' || task.state === 'needs-decision');
	const on = $derived(trouble ? 'bg-danger' : yours ? 'bg-sea' : 'bg-foreground/70');
</script>

<span
	class="inline-flex items-center gap-2"
	title="Step {task.stage + 1} of 6: {STAGES[task.stage]}"
>
	<span class="flex gap-0.5" aria-hidden="true">
		{#each STAGES as _, i (i)}
			<span
				class="h-1.5 w-3 rounded-full {i < task.stage
					? 'bg-foreground/35'
					: i === task.stage
						? on
						: 'bg-foreground/10'}"
			></span>
		{/each}
	</span>
	{#if words}
		<span
			class="text-xs whitespace-nowrap {trouble
				? 'text-danger'
				: yours
					? 'text-sea'
					: 'text-muted-foreground'}">{STAGES[task.stage]}</span
		>
	{/if}
</span>
