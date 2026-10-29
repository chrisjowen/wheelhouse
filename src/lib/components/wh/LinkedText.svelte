<script lang="ts">
	/** Text with each Markdown file path in it linked to the reader (see docpath.ts). */
	import { docHref, splitDocPaths } from '$lib/docpath';

	let { text }: { text: string | null | undefined } = $props();
	const runs = $derived(splitDocPaths(text ?? ''));
</script>

{#each runs as r, i (i)}{#if r.path}<a
			href={docHref(r.path)}
			class="break-all text-sea underline-offset-2 hover:underline"
			data-doc-link>{r.text}</a
		>{:else}{r.text}{/if}{/each}
