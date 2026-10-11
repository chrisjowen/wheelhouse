<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { ExternalLink, GitPullRequest, Globe } from '@lucide/svelte';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const href = $derived(`/tasks/${encodeURIComponent(task.id)}`);
	const thread = $derived(`/bridge?task=${encodeURIComponent(task.id)}`);
	const line = $derived(task.attention?.text ?? task.summary ?? task.statusLabel);
	const a = $derived(task.attention);
</script>

<!-- A task Firstmate's report-in links to, inline in the conversation. -->
<article class="flex min-w-0 gap-4 rounded-xl border bg-card p-4">
	<a {href} tabindex="-1" aria-hidden="true" class="hidden w-32 shrink-0 sm:block"
		><Thumb {task} class="rounded-lg" /></a
	>
	<div class="min-w-0 flex-1">
		{#if projectName}<p class="truncate text-xs text-muted-foreground">{projectName}</p>{/if}
		<a {href} class="block truncate font-medium hover:underline">{task.title}</a>
		<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{line}</p>
		<div class="mt-3"><StageTrack {task} size="bar" /></div>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if a?.owner === 'captain' && a.kind === 'review' && task.pr}
				<Button size="sm" href={task.pr.url} target="_blank" rel="noreferrer"
					>Review PR<ExternalLink /></Button
				>
			{:else if a?.owner === 'captain' && task.preview}
				<Button size="sm" href={task.preview.url} target="_blank" rel="noreferrer"
					>Open preview<ExternalLink /></Button
				>
			{:else if a?.owner === 'captain'}
				<!-- The decision opens as a question in this task's thread, not on the task page. -->
				<Button size="sm" href={thread}>Answer</Button>
			{/if}
			<Button size="sm" variant="outline" {href}>Open</Button>
			<span class="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
				{#if task.pr}
					<a
						href={task.pr.url}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 hover:text-foreground"
						><GitPullRequest class="size-3.5" aria-hidden="true" />{task.pr.number
							? `#${task.pr.number}`
							: 'PR'}</a
					>
				{/if}
				{#if task.preview}
					<a
						href={task.preview.url}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-sea hover:underline"
						><Globe class="size-3.5" aria-hidden="true" />Preview</a
					>
				{/if}
			</span>
		</div>
	</div>
</article>
