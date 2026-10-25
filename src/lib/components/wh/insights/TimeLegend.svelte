<script lang="ts">
	import { duration, SEGMENTS } from '$lib/insights';
	import type { TimeSegment } from '$lib/types';

	let { seconds }: { seconds?: Record<TimeSegment, number> } = $props();
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
	{#each SEGMENTS as s (s.key)}
		{#if !seconds || seconds[s.key] > 0}
			<li class="flex items-center gap-1.5" title={s.hint}>
				<span class="seg-{s.key} inline-block size-2.5 rounded-sm" aria-hidden="true"></span>
				<span>{s.label}</span>
				{#if seconds}<span class="font-medium text-foreground tabular-nums"
						>{duration(seconds[s.key])}</span
					>{/if}
			</li>
		{/if}
	{/each}
</ul>
