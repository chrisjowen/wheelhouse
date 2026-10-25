<script lang="ts">
	import { CircleCheck } from '@lucide/svelte';
	import type { Part } from '$lib/chat/fold';

	/**
	 * A question Firstmate asked with Claude Code's question picker, once
	 * answered: each question with the captain's answer. (While it is open, the
	 * menu itself shows as a PickerCard, read off the session's screen.)
	 */
	let { part }: { part: Extract<Part, { kind: 'question' }> } = $props();
</script>

{#if part.answers}
	<div class="flex max-w-[80ch] flex-col gap-1 text-sm text-muted-foreground">
		{#each part.questions as q (q.question)}
			<p class="flex items-start gap-2">
				<CircleCheck class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
				<span>
					{q.question}
					<span class="font-medium text-foreground">{part.answers[q.question] ?? 'No answer'}</span>
				</span>
			</p>
		{/each}
	</div>
{/if}
