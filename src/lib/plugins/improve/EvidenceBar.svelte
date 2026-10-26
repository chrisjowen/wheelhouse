<script lang="ts">
	import type { HarnessView } from './types';
	import { MIX_COLOR } from './visual';

	/**
	 * What improve read, by kind: one stacked bar, largest first, with a legend
	 * that carries the numbers, so the colours are never the only way to read it.
	 */
	let { mix, compact = false }: { mix: HarnessView['evidence']['mix']; compact?: boolean } =
		$props();
	const sorted = $derived([...mix].sort((a, b) => b.value - a.value));
	const total = $derived(sorted.reduce((n, m) => n + m.value, 0));
	const label = $derived(sorted.map((m) => `${m.value} ${m.label.toLowerCase()}`).join(', '));
</script>

{#if total > 0}
	<div
		class="flex overflow-hidden rounded-full bg-muted {compact ? 'h-1.5' : 'h-2.5'}"
		role="img"
		aria-label="What improve read: {label}"
	>
		{#each sorted as m (m.key)}
			<span
				class="h-full border-r border-card last:border-r-0"
				style="width: {(m.value / total) * 100}%; background: {MIX_COLOR[m.key] ??
					'var(--muted-foreground)'}"
			></span>
		{/each}
	</div>
	<ul
		class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground {compact
			? 'text-[0.7rem]'
			: 'text-xs'}"
		aria-hidden="true"
	>
		{#each sorted as m (m.key)}
			<li class="flex items-center gap-1.5">
				<span
					class="size-2 shrink-0 rounded-full"
					style="background: {MIX_COLOR[m.key] ?? 'var(--muted-foreground)'}"
				></span>{m.label}
				<span class="tabular font-medium text-foreground">{m.value}</span>
			</li>
		{/each}
	</ul>
{/if}
