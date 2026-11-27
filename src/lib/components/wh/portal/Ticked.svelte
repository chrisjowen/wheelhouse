<script lang="ts">
	import { ticks } from '$lib/portal';

	/** A crew's words, with what they marked as code set as code. */
	let { text }: { text: string } = $props();
</script>

{#each ticks(text) as part, i (i)}{#if part.code}<code class="font-mono text-[0.88em]"
			>{part.text}</code
		>{:else}{part.text}{/if}{/each}
