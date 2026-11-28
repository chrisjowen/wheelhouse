<script lang="ts">
	import { Lock, MessageSquare } from '@lucide/svelte';
	import type { FleetFeatureView } from '$lib/fleet';

	/**
	 * A Fleet page whose feature the fleet switched off: a calm card in its place, never
	 * an error, saying who switched it off and the reason they gave, word for word, with
	 * the gateway's reason code and a way to ask about it (a draft in Firstmate's chat).
	 */
	let { feature, fleet }: { feature: FleetFeatureView; fleet: string | null } = $props();

	const draft = $derived(
		`Why is “${feature.label}” switched off in ${fleet ?? 'our fleet'}, and who could turn it back on?`
	);
</script>

<section
	class="mt-4 max-w-2xl rounded-lg border border-dashed bg-card px-5 py-4"
	aria-labelledby="switched-off-title"
	data-testid="fleet-switched-off"
	data-reason={feature.reason}
>
	<h2 id="switched-off-title" class="flex items-center gap-2 font-display text-lg font-semibold">
		<Lock class="size-4 text-muted-foreground" aria-hidden="true" />Switched off
	</h2>
	{#if feature.note}<p class="mt-1 text-sm text-muted-foreground">{feature.note}</p>{/if}
	{#if feature.why}
		<blockquote class="mt-3 border-l-2 border-gold pl-3 text-sm italic">“{feature.why}”</blockquote>
	{/if}
	<div class="mt-4 flex flex-wrap items-center gap-3">
		<a
			class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
			href={`/?draft=${encodeURIComponent(draft)}`}
			data-testid="fleet-ask"><MessageSquare class="size-4" aria-hidden="true" />Ask about it</a
		>
		{#if feature.reason}<code
				class="rounded border border-hair px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
				>{feature.reason}</code
			>{/if}
		<span class="text-xs text-muted-foreground"
			>The gateway checks every call again; this page only shows what it says.</span
		>
	</div>
</section>
