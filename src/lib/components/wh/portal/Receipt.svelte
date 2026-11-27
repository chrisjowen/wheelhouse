<script lang="ts">
	import { CircleCheck } from '@lucide/svelte';
	import { ago } from '$lib/format';
	import { filedBy, receipt, type PortalEvidence } from '$lib/portal';

	/** Where a fact was seen, who filed it and when, and whether it is confirmed against the code. */
	let { evidence, now }: { evidence: PortalEvidence; now: number } = $props();
</script>

<span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
	{#if evidence.url}
		<a
			class="font-mono underline decoration-hair underline-offset-2 hover:text-foreground"
			href={evidence.url}
			target="_blank"
			rel="noreferrer">{receipt(evidence)}</a
		>
	{:else}
		<span class="font-mono break-all">{receipt(evidence)}</span>
	{/if}
	<span>filed by {filedBy(evidence)}</span>
	{#if evidence.observedAt}<span>{ago(evidence.observedAt, now)}</span>{/if}
	{#if evidence.confirmed}
		<span class="inline-flex items-center gap-1 text-success" data-testid="confirmed">
			<CircleCheck class="size-3" aria-hidden="true" />Confirmed in the code
		</span>
	{/if}
</span>
