<script lang="ts">
	import { clock } from '$lib/format';
	import { minutes } from '$lib/insights';
	import type { AllowanceWindow } from '$lib/types';

	// What is left of one Claude allowance window. The bar shows what is LEFT,
	// so full reads as plenty; it turns amber only when the pace will not last.
	let {
		w,
		now,
		compact = false
	}: { w: AllowanceWindow; now: number; compact?: boolean } = $props();

	const resets = $derived(w.resetsAt ? Date.parse(w.resetsAt) : null);
	const out = $derived(w.runsOutAt ? Date.parse(w.runsOutAt) : null);
	const short = $derived(out && resets ? Math.max(1, Math.round((resets - out) / 60000)) : null);
	const fill = $derived(w.atRisk ? (w.percentLeft < 15 ? 'bg-danger' : 'bg-warning') : 'bg-sea');
	const resetText = $derived.by(() => {
		if (!resets) return null;
		const inMin = Math.max(0, Math.round((resets - now) / 60000));
		const day =
			resets - now > 20 * 3600 * 1000
				? `${new Date(resets).toLocaleDateString([], { weekday: 'short' })} `
				: '';
		return `Resets ${day}${clock(w.resetsAt)}, in ${minutes(inMin)}`;
	});
</script>

{#if compact}
	<div class="flex items-center gap-2 text-xs">
		<span class="text-muted-foreground">{w.label}</span>
		<span class="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true"
			><span class="block h-full {fill}" style="width: {w.percentLeft}%"></span></span
		>
		<span class="font-medium tabular-nums">{w.percentLeft}% left</span>
	</div>
{:else}
	<div>
		<div class="flex items-baseline justify-between gap-3">
			<p class="text-sm font-medium">{w.label}</p>
			<p class="text-right">
				<span class="text-2xl font-semibold tracking-tight tabular-nums">{w.percentLeft}%</span>
				<span class="text-sm text-muted-foreground"> left</span>
			</p>
		</div>
		<div
			class="mt-3 h-2 overflow-hidden rounded-full bg-muted"
			role="meter"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={w.percentLeft}
			aria-label="{w.label}: {w.percentLeft}% left"
		>
			<span class="block h-full rounded-full {fill}" style="width: {w.percentLeft}%"></span>
		</div>
		<div class="mt-2 space-y-0.5 text-xs text-muted-foreground">
			{#if resetText}<p>{resetText}</p>{/if}
			{#if out && short}
				<p class="font-medium {w.percentLeft < 15 ? 'text-danger' : 'text-warning'}">
					At this pace it runs out around {clock(w.runsOutAt)}, {minutes(short)} before it resets
				</p>
			{:else if w.atRisk}
				<p class="font-medium {w.percentLeft < 15 ? 'text-danger' : 'text-warning'}">
					At this pace it may run out before it resets
				</p>
			{:else}
				<p>Lasts until it resets at this pace</p>
			{/if}
		</div>
	</div>
{/if}
