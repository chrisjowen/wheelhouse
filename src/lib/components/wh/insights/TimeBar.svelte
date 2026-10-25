<script lang="ts">
	import { duration, SEGMENTS } from '$lib/insights';
	import type { TimeSegment } from '$lib/types';

	// One task's (or a group's) time as a stacked bar. `scale` is the seconds that
	// fill the full width, shared across rows so bars compare; omit it for 100%.
	let {
		seconds,
		scale,
		height = 'h-2.5',
		label = ''
	}: {
		seconds: Record<TimeSegment, number>;
		scale?: number;
		height?: string;
		label?: string;
	} = $props();

	const total = $derived(Object.values(seconds).reduce((a, b) => a + b, 0));
	const width = $derived(scale ? Math.max(2, Math.min(100, (total / scale) * 100)) : 100);
	const summary = $derived(
		SEGMENTS.filter((s) => seconds[s.key] > 0)
			.map((s) => `${s.label} ${duration(seconds[s.key])}`)
			.join(', ')
	);
</script>

<div class="w-full" role="img" aria-label="{label} {duration(total)}: {summary}">
	<div class="flex overflow-hidden rounded-full bg-muted {height}" style="width: {width}%">
		{#if total > 0}
			{#each SEGMENTS as s (s.key)}
				{#if seconds[s.key] > 0}
					<span
						class="seg-{s.key} h-full border-r border-card last:border-r-0"
						style="width: {(seconds[s.key] / total) * 100}%"
						title="{s.label}: {duration(seconds[s.key])}"
					></span>
				{/if}
			{/each}
		{/if}
	</div>
</div>
