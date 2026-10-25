<script lang="ts">
	import { Clock } from '@lucide/svelte';
	import { CONFIDENCE, etaLine } from '$lib/insights';
	import type { WorkEta } from '$lib/types';

	// The work-time estimate on a card: one quiet line, its basis on hover.
	let { eta }: { eta: WorkEta } = $props();
	const l = $derived(etaLine(eta));
</script>

<p
	class="flex min-w-0 items-center gap-1.5 text-xs {l.tone === 'warning'
		? 'text-warning'
		: l.tone === 'muted'
			? 'text-muted-foreground'
			: 'text-foreground'}"
	title={l.note}
>
	<Clock class="size-3.5 shrink-0" aria-hidden="true" />
	<span class="truncate font-medium">{l.text}</span>
	{#if l.tone === 'normal' && eta.confidence !== 'none'}
		<span class="shrink-0 text-muted-foreground">· {CONFIDENCE[eta.confidence].toLowerCase()}</span>
	{/if}
	<span class="sr-only">{l.note}</span>
</p>
