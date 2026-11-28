<script lang="ts">
	import { Check, Minus } from '@lucide/svelte';
	import type { FleetView } from '$lib/fleet';

	/**
	 * What this ship may use, as the gateway's fleet document says (Settings → Fleet, and
	 * Fleet → Overview while Fleet is on): what is on, what is off with who switched it off
	 * and the reason they gave, word for word, and what the plan leaves out.
	 */
	let { view }: { view: FleetView } = $props();

	const on = $derived(view.features.filter((f) => f.on));
	const off = $derived(view.features.filter((f) => !f.on && f.reason !== 'not_in_plan'));
	const notInPlan = $derived(view.features.filter((f) => !f.on && f.reason === 'not_in_plan'));
</script>

<div data-testid="fleet-features">
	<h3 class="font-medium">What this ship may use</h3>
	{#if on.length}
		<ul class="mt-2 grid gap-1.5 text-sm">
			{#each on as f (f.key)}
				<li class="flex items-start gap-2">
					<Check class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
					<span
						>{f.label}{#if f.note}<span class="ml-1.5 text-muted-foreground">· {f.note}</span
							>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-muted-foreground">Nothing yet.</p>
	{/if}
	{#if off.length}
		<h3 class="mt-5 font-medium">Off</h3>
		<ul class="mt-2 grid gap-2 text-sm">
			{#each off as f (f.key)}
				<li class="flex items-start gap-2" data-reason={f.reason}>
					<Minus class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="min-w-0">
						<span>{f.label}</span>
						<span class="block text-muted-foreground">{f.note}</span>
						{#if f.why}<span class="block text-muted-foreground italic">“{f.why}”</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if notInPlan.length}
		<p class="mt-5 text-xs text-muted-foreground" data-testid="fleet-not-in-plan">
			Not in {view.fleet?.plan ? `the ${view.fleet.plan}` : 'this fleet’s'} plan: {notInPlan
				.map((f) => f.label)
				.join(', ')}.
		</p>
	{/if}
</div>
