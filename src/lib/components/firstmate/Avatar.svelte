<script lang="ts">
	/** Firstmate's emblem beside its messages: a ship's wheel on a navy disc ringed in brass. */
	let { class: className = '' }: { class?: string } = $props();

	const SPOKES = [0, 45, 90, 135, 180, 225, 270, 315];
</script>

<svg
	viewBox="0 0 32 32"
	class="shrink-0 {className}"
	role="img"
	aria-label="Firstmate"
	xmlns="http://www.w3.org/2000/svg"
>
	<circle cx="16" cy="16" r="15.25" class="fill-primary stroke-brass" stroke-width="1.5" />
	<g class="fill-none stroke-primary-foreground" stroke-linecap="round">
		<circle cx="16" cy="16" r="7" stroke-width="1.6" />
		{#each SPOKES as a (a)}
			<line x1="16" y1="12.4" x2="16" y2="5.6" stroke-width="1.3" transform="rotate({a} 16 16)" />
		{/each}
	</g>
	<circle cx="16" cy="16" r="2.4" class="fill-primary-foreground" />
	{#each SPOKES as a (a)}
		<circle
			cx="16"
			cy="5.2"
			r="1.3"
			class="fill-primary-foreground"
			transform="rotate({a} 16 16)"
		/>
	{/each}
</svg>
