<script lang="ts">
	/** The raw line behind a plain-words status, kept out of sight behind "details". */
	import LinkedText from './LinkedText.svelte';

	let { raw, plain = null }: { raw: string | null; plain?: string | null } = $props();
	const show = $derived(!!raw?.trim() && raw.trim() !== plain?.trim());
</script>

{#if show}
	<details class="group mt-1 text-xs text-muted-foreground">
		<summary class="inline select-none hover:text-foreground">details</summary>
		<p class="mt-1 font-mono break-words whitespace-pre-wrap"><LinkedText text={raw} /></p>
	</details>
{/if}
