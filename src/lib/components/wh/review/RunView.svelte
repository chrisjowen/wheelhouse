<script lang="ts">
	import { onMount } from 'svelte';
	import { markdown } from '$lib/chat/markdown';
	import { usageLine, type ReviewRun } from '$lib/prreview';
	import { clock } from '$lib/format';
	import { LoaderCircle, Square } from '@lucide/svelte';

	/** One question and its answer, or one focused review, as it streams in. */
	let { run, onstop }: { run: ReviewRun; onstop?: (run: ReviewRun) => void } = $props();
	// The Markdown sanitiser needs the browser's DOM: plain text until mounted.
	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

<article class="space-y-2" data-run={run.id} data-run-kind={run.kind} data-run-status={run.status}>
	{#if run.kind === 'ask'}
		<div
			class="ml-auto w-fit max-w-[92%] rounded-lg border border-[var(--bubble-captain-border)] bg-[var(--bubble-captain)] px-3 py-2 text-sm whitespace-pre-line"
		>
			{run.question}
		</div>
	{:else}
		<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			{run.hunk ? 'Review of this hunk' : 'Review of the whole pull request'}
		</p>
	{/if}

	<div class="rounded-lg border bg-card px-3 py-2.5">
		{#if run.text}
			<div
				class="review-answer text-sm leading-relaxed"
				aria-live={run.status === 'running' ? 'polite' : 'off'}
			>
				{#if mounted}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
					{@html markdown(run.text)}
				{:else}
					<p class="whitespace-pre-line">{run.text}</p>
				{/if}
			</div>
		{:else if run.status === 'running'}
			<p class="flex items-center gap-2 text-sm text-muted-foreground">
				<LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
				{run.kind === 'review' ? 'Reviewing…' : 'Reading the diff and the records…'}
			</p>
		{/if}
		{#if run.error}
			<p class="mt-1 text-sm text-danger" role="alert">{run.error}</p>
		{:else if run.status === 'stopped'}
			<p class="mt-1 text-xs text-muted-foreground">Stopped before it finished.</p>
		{/if}
		<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
			{#if run.status === 'running'}
				<span class="flex items-center gap-1.5"
					><LoaderCircle class="size-3 animate-spin" aria-hidden="true" />Answering, {run.model}, {run.effort}
					effort</span
				>
				{#if onstop}
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
						onclick={() => onstop(run)}><Square class="size-3" aria-hidden="true" />Stop</button
					>
				{/if}
			{:else if run.usage && (run.usage.inputTokens || run.usage.outputTokens)}
				<span data-usage>{usageLine(run.usage, run.effort)}</span>
			{/if}
			<span class="ml-auto tabular-nums">{clock(run.startedAt)}</span>
		</div>
	</div>
</article>

<style>
	.review-answer :global(p) {
		margin: 0.4em 0;
	}
	.review-answer :global(ul),
	.review-answer :global(ol) {
		margin: 0.4em 0;
		padding-left: 1.25em;
	}
	.review-answer :global(ul) {
		list-style: disc;
	}
	.review-answer :global(ol) {
		list-style: decimal;
	}
	.review-answer :global(code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--muted);
		border-radius: 0.25rem;
		padding: 0.05em 0.3em;
	}
	.review-answer :global(pre) {
		overflow-x: auto;
		background: var(--muted);
		border-radius: 0.375rem;
		padding: 0.5em 0.75em;
		margin: 0.5em 0;
	}
	.review-answer :global(pre code) {
		background: none;
		padding: 0;
	}
	.review-answer :global(strong) {
		font-weight: 600;
	}
	.review-answer :global(a) {
		color: var(--sea);
		text-decoration: underline;
	}
</style>
