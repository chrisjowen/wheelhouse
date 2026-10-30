<script lang="ts">
	/**
	 * The task page's open questions, each in the Decisions page's decision box
	 * (its merge call is the review panel's). An answered one leaves at once;
	 * while Firstmate has not yet taken up the answer, a line says it is with it.
	 */
	import { Check } from '@lucide/svelte';
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import type { InboxView } from '$lib/inbox';
	import type { TaskSummary } from '$lib/types';
	import OpenDecision from './OpenDecision.svelte';

	let { task, now }: { task: TaskSummary; now: number } = $props();

	const seed = $derived(page.data.inbox as InboxView | undefined);
	const cards = $derived(inbox.forTask(task.id, seed));
	const answered = $derived(
		!cards.length && task.attention?.kind === 'decision' && inbox.hasDecision(task.id, seed)
	);
</script>

{#if cards.length}
	<ol class="mt-5 flex flex-col gap-3" aria-label="Open questions">
		{#each cards as c (c.id)}
			<li><OpenDecision card={c} {now} /></li>
		{/each}
	</ol>
{:else if answered}
	<p class="mt-5 flex items-center gap-2 text-sm text-muted-foreground" role="status">
		<Check class="size-4 shrink-0 text-success" aria-hidden="true" />Your answer is with Firstmate,
		which passes it on to the crew.
	</p>
{/if}
