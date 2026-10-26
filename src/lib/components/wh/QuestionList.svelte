<script lang="ts">
	import type { AskedQuestion } from '$lib/buildlog';

	/**
	 * The automated review's questions to Firstmate, one per row: what was
	 * asked, where in the change, whether Firstmate has answered, and its call
	 * with the reason once it has. The whole question opens in place.
	 */
	let { questions, size = 'page' }: { questions: AskedQuestion[]; size?: 'card' | 'page' } =
		$props();

	let opened = $state<Record<string, boolean>>({});

	const STATUS: Record<AskedQuestion['status'], { label: string; class: string }> = {
		waiting: { label: 'Waiting on Firstmate', class: 'bg-warning/10 text-warning' },
		answered: { label: 'Answered', class: 'bg-success/10 text-success' },
		closed: { label: 'Closed without an answer', class: 'bg-muted text-muted-foreground' }
	};
</script>

<ol class="space-y-2" data-questions>
	{#each questions as q, i (q.id)}
		<li
			class="rounded-md border border-hair bg-card {size === 'card'
				? 'px-2.5 py-2 text-xs'
				: 'px-3 py-2.5 text-sm'}"
			data-question={q.status}
		>
			<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<p class="text-xs text-muted-foreground">
					Question {i + 1}{q.where ? ` · ${q.where}` : ''}{q.serious ? ' · marked serious' : ''}
				</p>
				<span class="rounded-full px-2 py-0.5 text-xs font-medium {STATUS[q.status].class}"
					>{STATUS[q.status].label}</span
				>
			</div>
			<p class="mt-1 leading-relaxed">{q.summary}</p>
			{#if q.detail}
				{#if opened[q.id]}
					<p
						class="mt-1.5 leading-relaxed whitespace-pre-line text-muted-foreground"
						data-question-detail
					>
						{q.detail}
					</p>
				{/if}
				<button
					type="button"
					class="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
					aria-expanded={!!opened[q.id]}
					onclick={() => (opened[q.id] = !opened[q.id])}
					>{opened[q.id] ? 'Show less' : 'Show the whole question'}</button
				>
			{/if}
			{#if q.verdict}
				<div class="mt-2 border-l-2 border-brass/60 pl-2.5" data-question-call>
					<p class="text-xs text-muted-foreground">
						Firstmate decided: <span class="font-medium text-foreground">{q.verdict}</span>
					</p>
					{#if q.reason}<p class="mt-0.5 leading-relaxed">{q.reason}</p>{/if}
				</div>
			{/if}
		</li>
	{/each}
</ol>
