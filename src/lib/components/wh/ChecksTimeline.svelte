<script lang="ts">
	import type { Check, Pipeline, PipelineStep } from '$lib/types';
	import { live } from '$lib/client/live.svelte';
	import { checksLine, ciChecksLine, duration, segmentTone, stepSummary } from '$lib/checks';
	import {
		Check as CheckIcon,
		CircleDashed,
		CirclePause,
		LoaderCircle,
		Minus,
		X
	} from '@lucide/svelte';

	/**
	 * The checks stage on the task page: what is happening now, then a short
	 * timeline of what each step found or changed, with the pull request's CI
	 * result on the CI step once the PR is up. Steps not reached yet fold into
	 * one line, so the list stays short.
	 */
	let {
		pipeline,
		busy = false,
		prChecks = []
	}: { pipeline: Pipeline; busy?: boolean; prChecks?: readonly Check[] } = $props();

	type Row = { kind: 'step'; s: PipelineStep } | { kind: 'later'; labels: string[] };
	const rows = $derived.by(() => {
		const out: Row[] = [];
		for (const s of pipeline.steps) {
			const last = out.at(-1);
			if (s.state === 'upcoming') {
				if (last?.kind === 'later') last.labels.push(s.label);
				else out.push({ kind: 'later', labels: [s.label] });
			} else out.push({ kind: 'step', s });
		}
		return out;
	});
	const line = $derived(checksLine(pipeline, live.now));
	const ci = $derived(ciChecksLine(prChecks));
	const under = (s: PipelineStep) => s.key === pipeline.step && pipeline.outcome === 'running';
	/** How long a step took, or has taken so far (live for the step under way). */
	function took(s: PipelineStep): string | null {
		if (under(s) && (s.state === 'running' || s.state === 'fixing')) {
			const from = Date.parse(pipeline.startedAt ?? '');
			if (!Number.isNaN(from)) return duration(live.now - from);
		}
		return s.durationMs != null && s.durationMs >= 1000 ? duration(s.durationMs) : null;
	}
	function summary(s: PipelineStep): string {
		const text = stepSummary(s, pipeline);
		return s.key === 'ci' && ci ? `${text} · ${ci}` : text;
	}
</script>

<div data-checks-timeline>
	<p class="tabular text-sm">{line}</p>
	<ol class="mt-3 space-y-0.5 text-sm">
		{#each rows as r, i (i)}
			{#if r.kind === 'step'}
				{@const tone = segmentTone(r.s, pipeline)}
				<li class="grid grid-cols-[1.25rem_6.5rem_minmax(0,1fr)_auto] items-start gap-x-2 py-1">
					<span class="flex h-5 items-center">
						{#if tone === 'done'}<CheckIcon
								class="size-4 {r.s.key === 'ci' ? 'text-success' : 'text-muted-foreground'}"
								aria-label="Done"
							/>
						{:else if tone === 'failed'}<X class="size-4 text-danger" aria-label="Failed" />
						{:else if tone === 'waiting'}<CirclePause
								class="size-4 text-warning"
								aria-label="Waiting on Firstmate"
							/>
						{:else if tone === 'skipped'}<Minus
								class="size-4 text-muted-foreground"
								aria-label="Skipped"
							/>
						{:else}<LoaderCircle
								class="size-4 text-foreground {busy ? 'motion-safe:animate-spin' : ''}"
								aria-label={tone === 'fixing' ? 'Fixing' : 'Under way'}
							/>{/if}
					</span>
					<span class="truncate leading-5 {under(r.s) ? 'font-medium' : ''}">{r.s.label}</span>
					<span
						class="leading-5 {tone === 'failed'
							? 'text-danger'
							: tone === 'waiting'
								? 'text-warning'
								: 'text-muted-foreground'}">{summary(r.s)}</span
					>
					<span class="tabular text-right text-xs leading-5 text-muted-foreground"
						>{took(r.s) ?? ''}</span
					>
				</li>
			{:else}
				<li
					class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2 py-1 text-muted-foreground"
				>
					<span class="flex h-5 items-center"
						><CircleDashed class="size-4 text-muted-foreground/60" aria-hidden="true" /></span
					>
					<span class="leading-5">Still to come: {r.labels.join(', ')}</span>
				</li>
			{/if}
		{/each}
	</ol>
</div>
