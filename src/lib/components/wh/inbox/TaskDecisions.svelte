<script lang="ts">
	/**
	 * A task's open questions, as a badge that opens the Decisions page on them
	 * (DecisionsBadge), on its page, its slide-out and its crew
	 * discussion. Once answered, while Firstmate has not yet taken up the
	 * answer, a line says it is with it.
	 */
	import { Check } from '@lucide/svelte';
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import { live } from '$lib/client/live.svelte';
	import type { InboxView } from '$lib/inbox';
	import type { TaskSummary } from '$lib/types';
	import DecisionsBadge from './DecisionsBadge.svelte';

	let { task }: { task: TaskSummary } = $props();

	const seed = $derived(page.data.inbox as InboxView | undefined);
	const open = $derived(inbox.forTask(task.id, seed, live.now).length > 0);
	const answered = $derived(
		!open && task.attention?.kind === 'decision' && inbox.hasDecision(task.id, seed)
	);
</script>

{#if open}
	<div class="mt-5" data-task-decisions>
		<DecisionsBadge filter={{ taskId: task.id }} />
	</div>
{:else if answered}
	<p
		class="mt-5 flex items-center gap-2 text-sm text-muted-foreground"
		role="status"
		data-task-decisions-answered
	>
		<Check class="size-4 shrink-0 text-success" aria-hidden="true" />Your answer is with Firstmate,
		which passes it on to the crew.
	</p>
{/if}
