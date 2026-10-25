<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { agentLine } from '$lib/card';
	import { awaitingReview, reviewView } from '$lib/review';
	import { ExternalLink, Images, MonitorPlay } from '@lucide/svelte';
	import CardPreview from './CardPreview.svelte';
	import ShotStrip from './ShotStrip.svelte';
	import StageTrack from './StageTrack.svelte';
	import Thumb from './Thumb.svelte';

	let { task, projectName = null }: { task: TaskSummary; projectName?: string | null } = $props();
	const a = $derived(task.attention!);
	const href = $derived(`/tasks/${encodeURIComponent(task.id)}`);
	const review = $derived(awaitingReview(task));
	const rv = $derived(reviewView(task));
	const who = $derived(agentLine(task.worker));
</script>

<!-- One card per thing that needs the captain, with one primary action. -->
<article
	class="flex min-w-0 flex-col rounded-2xl border border-sea/40 bg-card p-3 shadow-[0_0_0_4px] shadow-sea/5"
>
	<a {href} tabindex="-1" aria-hidden="true" class="relative block">
		<Thumb {task} class="rounded-xl" />
		{#if review && task.screenshots > 0}
			<span
				class="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium shadow-sm"
				><Images class="size-3.5" aria-hidden="true" />{task.screenshots}</span
			>
		{/if}
	</a>
	<ShotStrip
		shots={task.shots}
		total={task.screenshots}
		skip={task.thumb.kind === 'screenshot' ? 1 : 0}
	/>
	<div class="flex flex-1 flex-col px-1 pt-4 pb-1">
		{#if projectName || who}
			<p class="truncate text-xs text-muted-foreground">
				{#if projectName}<span class="font-medium tracking-wide text-sea">{projectName}</span>{who
						? ' · '
						: ''}{/if}{who ?? ''}
			</p>
		{/if}
		<a {href} class="mt-0.5 text-lg leading-snug font-semibold hover:underline" title={task.title}
			>{task.shortTitle}</a
		>
		<p class="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-muted-foreground">{a.text}</p>
		{#if review}
			<ul class="mt-3 space-y-1 text-xs text-muted-foreground" aria-label="Review evidence">
				<li class="flex items-center gap-1.5" data-review="screenshots">
					<Images class="size-3.5" aria-hidden="true" />{rv.shotsText}
				</li>
				<li class="flex items-center gap-1.5" data-review="preview">
					<MonitorPlay class="size-3.5" aria-hidden="true" />{#if rv.preview}<a
							href={rv.preview.url}
							target="_blank"
							rel="noreferrer"
							class="truncate text-sea hover:underline">{rv.preview.url}</a
						>{:else}{rv.previewText}{/if}
				</li>
			</ul>
		{/if}
		{#if task.preview}<CardPreview {task} />{/if}
		<div class="mt-4"><StageTrack {task} /></div>
		<div class="mt-5 flex flex-wrap gap-2">
			{#if review && rv.preview}
				<Button class="flex-1" href={rv.preview.url} target="_blank" rel="noreferrer"
					>Open preview<ExternalLink /></Button
				>
				{#if rv.pr}
					<Button variant="outline" href={rv.pr.url} target="_blank" rel="noreferrer"
						>Review PR<ExternalLink /></Button
					>
				{/if}
			{:else if review && rv.pr}
				<Button class="flex-1" href={rv.pr.url} target="_blank" rel="noreferrer"
					>Review PR<ExternalLink /></Button
				>
			{:else if review}
				<Button class="flex-1" {href}>Review the work</Button>
			{:else}
				<Button class="flex-1" {href}>Read the decision</Button>
			{/if}
			<Button variant="outline" {href}>Details</Button>
		</div>
	</div>
</article>
