<script lang="ts">
	/**
	 * A ring gauge: a whole percentage drawn as an arc round its figure, gold or teal.
	 * With no value (nothing to read yet) the ring is empty and the figure a dash.
	 */
	let { value, tone = 'gold' }: { value: number | null; tone?: 'gold' | 'teal' } = $props();
	const R = 22;
	const C = 2 * Math.PI * R;
	const v = $derived(value === null ? 0 : Math.max(0, Math.min(100, Math.round(value))));
</script>

<span class="gauge" data-tone={tone} aria-hidden="true">
	<svg viewBox="0 0 52 52">
		<circle cx="26" cy="26" r={R} class="gauge-track" />
		{#if value !== null && v > 0}<circle
				cx="26"
				cy="26"
				r={R}
				class="gauge-value"
				stroke-dasharray="{(v / 100) * C} {C}"
				transform="rotate(-90 26 26)"
			/>{/if}
	</svg>
	<span class="gauge-label">{value === null ? '–' : `${v}%`}</span>
</span>
