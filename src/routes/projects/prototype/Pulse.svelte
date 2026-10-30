<!-- PROTOTYPE: two weeks of activity as small bars. Bar height is commits that day; a dark
     bar is a day something landed. -->
<script lang="ts">
	import { sum } from './prototype-data';

	let {
		commits,
		landed,
		width = 112,
		height = 22
	}: { commits: number[]; landed: number[]; width?: number; height?: number } = $props();

	const max = $derived(Math.max(4, ...commits));
	const step = $derived(width / commits.length);
	const label = $derived(`${sum(commits)} commits and ${sum(landed)} landed in the last two weeks`);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label} class="shrink-0">
	<title>{label}</title>
	{#each commits as c, i (i)}
		{@const h = c ? Math.max(2, (c / max) * (height - 2)) : 1}
		<rect
			x={i * step + 1}
			y={height - h}
			width={Math.max(2, step - 3)}
			height={h}
			rx="1"
			class={landed[i] ? 'fill-foreground/70' : c ? 'fill-foreground/20' : 'fill-foreground/10'}
		/>
	{/each}
</svg>
