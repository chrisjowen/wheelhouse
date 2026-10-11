<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { workerName } from '$lib/format';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';
	import { tone, textClass } from './tone';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const t = $derived(tone(task));
	const line = $derived(
		t === 'trouble' || t === 'firstmate' || task.status === 'waiting'
			? task.statusLabel
			: (task.summary ?? task.statusLabel)
	);
</script>

<a
	href="/tasks/{encodeURIComponent(task.id)}"
	class="group block min-w-0 rounded-2xl border bg-card p-3 transition-shadow duration-200 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
>
	<Thumb {task} class="rounded-xl" />
	<div class="px-1 pt-4 pb-1">
		<p class="truncate text-xs text-muted-foreground">
			{#if projectName}<span class="text-sea">{projectName}</span> ·
			{/if}{workerName(task.worker) ?? (task.status === 'queued' ? 'Not started' : 'Crew unknown')}
		</p>
		<p class="mt-0.5 leading-snug font-medium group-hover:underline">{task.title}</p>
		<p
			class="mt-1 line-clamp-1 text-sm {t === 'trouble'
				? textClass.trouble
				: t === 'firstmate'
					? textClass.firstmate
					: 'text-muted-foreground'}"
			title={task.summary ?? undefined}
		>
			{line}
		</p>
		<div class="mt-4"><StageTrack {task} /></div>
	</div>
</a>
