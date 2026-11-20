<script lang="ts">
	/**
	 * The reports a decision rests on, as link chips on the card itself (the
	 * Decisions page and the chat): each opens the task's record at its
	 * permanent page, so it still opens once the decision is answered.
	 */
	import type { InboxCard } from '$lib/inbox';
	import { documents } from '$lib/client/documents.svelte';
	import DocChip from '../docs/DocChip.svelte';

	let { card }: { card: InboxCard } = $props();
	const records = $derived(
		documents
			.mentioned(
				[
					...(card.evidence.docs ?? []).filter((d) => d.kind === 'report').map((d) => d.path),
					card.secondMate ? '' : `data/${card.taskId}/report.md`,
					card.origin ? `data/${card.origin}/report.md` : '',
					card.question
				].join('\n')
			)
			.slice(0, 3)
	);
</script>

{#if records.length}
	<div class="mt-3 grid max-w-[40rem] gap-1.5" data-decision-records>
		{#each records as d (d.kind === 'record' ? d.record.key : d.kind === 'library' ? d.doc.key : d.prototype.id)}
			<DocChip doc={d} />
		{/each}
	</div>
{/if}
