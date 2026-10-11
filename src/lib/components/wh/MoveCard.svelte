<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { ExternalLink } from '@lucide/svelte';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const a = $derived(task.attention!);
	const href = $derived(`/tasks/${encodeURIComponent(task.id)}`);
</script>

<!-- One card per thing that needs the captain, with one primary action. -->
<article
	class="flex min-w-0 flex-col rounded-2xl border border-sea/40 bg-card p-3 shadow-[0_0_0_4px] shadow-sea/5"
>
	<a {href} tabindex="-1" aria-hidden="true"><Thumb {task} class="rounded-xl" /></a>
	<div class="flex flex-1 flex-col px-1 pt-4 pb-1">
		{#if projectName}<p class="text-xs font-medium tracking-wide text-sea">{projectName}</p>{/if}
		<a {href} class="mt-0.5 text-lg leading-snug font-semibold hover:underline">{task.title}</a>
		<p class="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-muted-foreground">{a.text}</p>
		<div class="mt-4"><StageTrack {task} /></div>
		<div class="mt-5 flex gap-2">
			{#if a.kind === 'review' && a.url}
				<Button class="flex-1" href={a.url} target="_blank" rel="noreferrer"
					>Review PR<ExternalLink /></Button
				>
			{:else if a.kind === 'review' && task.preview}
				<Button class="flex-1" href={task.preview.url} target="_blank" rel="noreferrer"
					>Open preview<ExternalLink /></Button
				>
			{:else}
				<Button class="flex-1" {href}>Read the decision</Button>
			{/if}
			<Button variant="outline" {href}>Details</Button>
		</div>
	</div>
</article>
