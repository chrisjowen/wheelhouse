<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { FileText, GitPullRequest, Hand, Hourglass, TerminalSquare } from '@lucide/svelte';

	let { task, class: cls = '' }: { task: TaskSummary; class?: string } = $props();
	const thumb = $derived(task.thumb);
	const max = $derived(
		thumb.kind === 'diff' ? Math.max(1, ...thumb.files.map((f) => f.additions + f.deletions)) : 1
	);
</script>

<!-- The latest screenshot when there is one; otherwise a picture of the diff. -->
<div class="relative aspect-[16/10] overflow-hidden rounded-lg border bg-muted/40 {cls}">
	{#if thumb.kind === 'screenshot'}
		<img
			src={thumb.url}
			alt="Latest screenshot: {thumb.name}"
			loading="lazy"
			class="size-full object-cover object-top"
		/>
	{:else if thumb.kind === 'diff'}
		<div class="flex size-full flex-col justify-center gap-1.5 p-4" aria-label="Files changed">
			{#each thumb.files as f (f.path)}
				<div class="flex items-center gap-2">
					<span class="w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
						>{f.path.split('/').pop()}</span
					>
					<span class="flex h-1.5 w-20 overflow-hidden rounded-full bg-border/60">
						<span class="bg-success/80" style="width:{(f.additions / max) * 100}%"></span>
						<span class="bg-danger/80" style="width:{(f.deletions / max) * 100}%"></span>
					</span>
				</div>
			{/each}
			{#if thumb.totalFiles > thumb.files.length}
				<p class="font-mono text-xs text-muted-foreground">
					+{thumb.totalFiles - thumb.files.length} more
				</p>
			{/if}
		</div>
	{:else}
		<div class="grid size-full place-items-center text-muted-foreground/50">
			{#if task.status === 'queued'}<Hourglass class="size-6" aria-hidden="true" />
			{:else if task.attention?.kind === 'decision'}<Hand class="size-6" aria-hidden="true" />
			{:else if task.hasReport}<FileText class="size-6" aria-hidden="true" />
			{:else if task.pr}<GitPullRequest class="size-6" aria-hidden="true" />
			{:else}<TerminalSquare class="size-6" aria-hidden="true" />{/if}
		</div>
	{/if}
</div>
