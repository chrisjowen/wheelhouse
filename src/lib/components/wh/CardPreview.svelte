<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import type { Box } from '$lib/motion';
	import { MonitorPlay } from '@lucide/svelte';
	import PreviewStudio from './PreviewStudio.svelte';

	/**
	 * A task card's live preview: one line that opens the preview in place, full
	 * size with the preview helper beside it (PreviewStudio), growing out of the
	 * card and shrinking back into it when closed. Nothing is fetched until it
	 * opens. It sits above the card's own link so it can be used in place.
	 */
	let { task }: { task: TaskSummary } = $props();
	let from = $state<Box | null>(null);
	let open = $state(false);

	function show(e: MouseEvent) {
		const card = (e.currentTarget as HTMLElement).closest('article') ?? e.currentTarget;
		from = (card as HTMLElement).getBoundingClientRect();
		open = true;
	}
</script>

<div class="relative z-10 mt-3" data-card-preview>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-sea hover:underline"
		aria-haspopup="dialog"
		onclick={show}><MonitorPlay class="size-3.5" aria-hidden="true" />Open live preview</button
	>
</div>
{#if open && task.preview}
	<PreviewStudio
		taskId={task.id}
		title={task.shortTitle}
		url={task.preview.url}
		talk={task.status !== 'landed'}
		{from}
		onclose={() => (open = false)}
	/>
{/if}
