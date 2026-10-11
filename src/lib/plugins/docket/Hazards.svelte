<script lang="ts">
	import { Sailboat, TriangleAlert } from '@lucide/svelte';
	import type { HazardsData } from './types';

	/** "Hazards ahead": tasks under way whose changes touch restricted waters. */
	let { data }: { data: unknown } = $props();
	const value = $derived(data as HazardsData);
</script>

<ul class="space-y-2 text-sm">
	{#each value.hazards as h (h.taskId)}
		<li>
			<a
				class="inline-flex items-baseline gap-1.5 font-medium hover:underline"
				href="/tasks/{encodeURIComponent(h.taskId)}"
				><Sailboat class="size-3.5 shrink-0 self-center text-sea" aria-hidden="true" />{h.title}</a
			>
			<span class="text-muted-foreground">· {h.step}</span>
			<p class="mt-0.5 flex items-start gap-1.5 text-warning">
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
				<span
					>Touches {h.exhibits.map((x) => x.title).join(', ')}: {h.restrictions
						.map((r) => r.title)
						.join('; ')}</span
				>
			</p>
		</li>
	{/each}
</ul>
<a href={value.chartHref} class="mt-2 inline-block text-xs text-sea hover:underline"
	>Open the chart</a
>
