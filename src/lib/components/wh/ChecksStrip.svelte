<script lang="ts" module>
	import type { SegmentTone } from '$lib/checks';

	/** One colour per segment tone; the plain line and labels say the same in words. */
	export const segmentClass: Record<SegmentTone, string> = {
		done: 'bg-foreground/45',
		active: 'bg-foreground',
		fixing: 'bg-foreground',
		waiting: 'bg-warning',
		failed: 'bg-danger',
		skipped: 'border border-dashed border-muted-foreground/50',
		todo: 'bg-border'
	};
	export const segmentWord: Record<SegmentTone, string> = {
		done: 'done',
		active: 'under way',
		fixing: 'fixing',
		waiting: 'waiting on Firstmate',
		failed: 'failed',
		skipped: 'skipped',
		todo: 'not reached'
	};
</script>

<script lang="ts">
	import type { Pipeline } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { checksLine, segmentTone } from '$lib/checks';

	/**
	 * The checks stage on a card: a slim strip, one segment per validation
	 * step, and one plain line under it. Only the step under way moves (a soft
	 * pulse, still under reduced motion), and only while the worker is busy.
	 */
	let {
		pipeline,
		busy = false,
		lead = null,
		leadClass = ''
	}: {
		pipeline: Pipeline;
		busy?: boolean;
		/** A status the card leads with (trouble, Firstmate), before the line. */
		lead?: string | null;
		leadClass?: string;
	} = $props();

	const segments = $derived(pipeline.steps.map((s) => ({ s, tone: segmentTone(s, pipeline) })));
	const line = $derived(checksLine(pipeline, live.now));
	const label = $derived(
		`Checks: ${segments.map(({ s, tone }) => `${s.label} ${segmentWord[tone]}`).join(', ')}`
	);
</script>

<div data-checks>
	<ol
		class="grid gap-0.5"
		style="grid-template-columns: repeat({segments.length}, minmax(0, 1fr))"
		aria-label={label}
	>
		{#each segments as { s, tone } (s.key)}
			<li
				class="h-1 rounded-full {segmentClass[tone]} {busy &&
				(tone === 'active' || tone === 'fixing')
					? 'motion-safe:animate-pulse'
					: ''}"
				title="{s.label}: {segmentWord[tone]}"
			></li>
		{/each}
	</ol>
	<p class="tabular mt-1.5 line-clamp-2 text-sm text-muted-foreground" data-checks-line>
		{#if lead}<span class="font-medium {leadClass}">{lead}.</span>{/if}
		<span class="text-foreground/80">{line}</span>
	</p>
</div>
