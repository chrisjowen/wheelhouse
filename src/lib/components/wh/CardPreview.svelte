<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { ChevronDown, MonitorPlay } from '@lucide/svelte';
	import LivePreview from './LivePreview.svelte';

	/**
	 * A Harbour card's expandable live preview: closed, one line; open, the
	 * embedded preview with its feedback box (nothing is fetched until opened).
	 * It sits above the card's own link so it can be used in place.
	 */
	let { task }: { task: TaskSummary } = $props();
	let open = $state(false);
</script>

<div class="relative z-10 mt-3" data-card-preview>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-sea hover:underline"
		aria-expanded={open}
		onclick={() => (open = !open)}
		><MonitorPlay class="size-3.5" aria-hidden="true" />{open
			? 'Hide live preview'
			: 'Show live preview'}<ChevronDown
			class="size-3.5 transition-transform {open ? 'rotate-180' : ''}"
			aria-hidden="true"
		/></button
	>
	{#if open}<div class="mt-2">
			<LivePreview taskId={task.id} compact feedback={task.status !== 'landed'} />
		</div>{/if}
</div>
