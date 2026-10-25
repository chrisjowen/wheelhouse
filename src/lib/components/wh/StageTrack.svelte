<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import BusyRing from './BusyRing.svelte';
	import { dotClass, textClass, tone } from './tone';

	let { task, size = 'card' }: { task: TaskSummary; size?: 'card' | 'bar' } = $props();

	const p = $derived(task.passage);
	const t = $derived(tone(task));
	const label = $derived(
		`Step ${p.current + 1} of ${p.steps.length}: ${p.steps[p.current]?.label ?? ''}${
			p.steps[p.current]?.failed ? ', failed' : ''
		}${task.busy ? ', in progress' : ''}`
	);
	// A failed step (e.g. a failed deploy) is drawn in red; it is not a "needs you" item.
	const dot = (failed: boolean) => (failed ? 'bg-danger' : dotClass[t]);
	const text = (failed: boolean) => (failed ? 'text-danger' : textClass[t]);
</script>

{#if size === 'card'}
	<!-- Labelled mini passage: every step named, the current one emphasised. -->
	<ol
		class="grid"
		style="grid-template-columns: repeat({p.steps.length}, minmax(0, 1fr))"
		aria-label={label}
	>
		{#each p.steps as s, i (s.key)}
			<li class="relative flex min-w-0 flex-col items-center" title={s.note ?? undefined}>
				{#if i > 0}
					<span
						class="absolute top-[5px] right-1/2 left-[-50%] {i <= p.current
							? 'h-0.5 bg-foreground/50'
							: 'h-0 border-t border-dotted border-input'}"
					></span>
				{/if}
				{#if s.state === 'current'}
					<span class="relative z-10 size-3 rounded-full ring-[3px] ring-card {dot(s.failed)}"
						>{#if task.busy}<BusyRing class={dot(s.failed)} />{/if}</span
					>
				{:else if s.state === 'skipped'}
					<span
						class="relative z-10 mt-[2px] size-2 rounded-full border border-dashed border-muted-foreground/50 bg-card"
					></span>
				{:else}
					<span
						class="relative z-10 mt-[2px] size-2 rounded-full {s.state === 'done'
							? 'bg-foreground/50'
							: 'border border-border bg-card'}"
					></span>
				{/if}
				<span
					class="mt-1.5 max-w-full truncate text-[10px] leading-none {s.state === 'current'
						? `font-semibold ${text(s.failed)}`
						: s.state === 'done'
							? 'text-muted-foreground'
							: s.state === 'skipped'
								? 'text-muted-foreground italic line-through'
								: 'text-muted-foreground italic'}">{s.short}</span
				>
			</li>
		{/each}
	</ol>
{:else}
	<ol
		class="grid gap-2"
		style="grid-template-columns: repeat({p.steps.length}, minmax(0, 1fr))"
		aria-label={label}
	>
		{#each p.steps as s (s.key)}
			<li class="min-w-0" title={s.note ?? undefined}>
				<div
					class="h-1.5 rounded-full {s.state === 'done'
						? 'bg-foreground/60'
						: s.state === 'current'
							? dot(s.failed)
							: s.state === 'skipped'
								? 'border border-dashed border-border'
								: 'bg-border'}"
				></div>
				<p
					class="mt-2 truncate text-xs leading-tight {s.state === 'current'
						? `font-medium ${s.failed ? 'text-danger' : 'text-foreground'}`
						: s.state === 'done'
							? 'text-muted-foreground'
							: 'text-muted-foreground italic'} {s.state === 'skipped' ? 'line-through' : ''}"
				>
					{s.label}{s.failed ? ' failed' : ''}
				</p>
			</li>
		{/each}
	</ol>
{/if}
