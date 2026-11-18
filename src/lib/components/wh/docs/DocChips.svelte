<script lang="ts">
	/**
	 * The documents a message mentions (a report path, a record, a library
	 * document or a prototype; see documents.ts findDocRefs), each as a link
	 * chip under it, so a report Firstmate names opens at its permanent page.
	 * Only documents the index knows get a chip.
	 */
	import { documents } from '$lib/client/documents.svelte';
	import DocChip from './DocChip.svelte';

	let { text, max = 4 }: { text: string | null | undefined; max?: number } = $props();
	const docs = $derived(text ? documents.mentioned(text).slice(0, max) : []);
</script>

{#if docs.length}
	<div class="mt-2 grid w-full max-w-[min(100%,40rem)] gap-1.5" data-doc-chips>
		{#each docs as d (d.kind === 'record' ? d.record.key : d.kind === 'library' ? d.doc.key : d.prototype.id)}
			<DocChip doc={d} />
		{/each}
	</div>
{/if}
