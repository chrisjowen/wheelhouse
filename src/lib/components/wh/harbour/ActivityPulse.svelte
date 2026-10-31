<script lang="ts">
	/**
	 * Two weeks of a project's activity as small bars, oldest on the left: a bar's height
	 * is that day's commits (from its clone), and a dark bar is a day something landed.
	 * Without a readable clone, the bars are the landings alone.
	 */
	let {
		commits,
		landed,
		width = 112,
		height = 22
	}: { commits: number[] | null; landed: number[]; width?: number; height?: number } = $props();

	const heights = $derived(commits ?? landed);
	const max = $derived(Math.max(4, ...heights));
	const step = $derived(width / heights.length);
	const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	const label = $derived(
		`${commits ? `${total(commits)} commits and ` : ''}${total(landed)} landed in the last two weeks`
	);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label} class="shrink-0">
	<title>{label}</title>
	{#each heights as n, i (i)}
		{@const h = n ? Math.max(2, (n / max) * (height - 2)) : 1}
		<rect
			x={i * step + 1}
			y={height - h}
			width={Math.max(2, step - 3)}
			height={h}
			rx="1"
			class={landed[i] ? 'fill-foreground/70' : n ? 'fill-foreground/25' : 'fill-foreground/10'}
		/>
	{/each}
</svg>
