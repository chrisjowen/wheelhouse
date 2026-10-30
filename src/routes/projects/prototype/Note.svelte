<!-- PROTOTYPE: a numbered note marker; the legend beside the design says what it answers. -->
<script lang="ts">
	let { n, show }: { n: number; show: boolean } = $props();
</script>

{#if show}
	<span
		class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brass font-sans text-[0.7rem] leading-none font-semibold text-white not-italic dark:text-slate-950"
		aria-label="Note {n}">{n}</span
	>
{/if}
