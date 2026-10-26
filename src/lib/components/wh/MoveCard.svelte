<script lang="ts">
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { agentLine } from '$lib/card';
	import { awaitingReview, reviewView } from '$lib/review';
	import { Compass, ExternalLink, Images, MessagesSquare, MonitorPlay } from '@lucide/svelte';
	import { hintLine } from '$lib/buildlog';
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
	// Questions asked about the task and the docs its session referenced, in a few words.
	const hint = $derived(hintLine(task.build));
	// A variable, not a literal: Svelte trims the spaces of a bare " · " inside a block.
	const sep = ' · ';
</script>

<!-- One card per thing that needs the captain, with one primary action. -->
<article class="flex min-w-0 flex-col rounded-lg border border-t-2 border-t-sea bg-card p-3">
	<a {href} tabindex="-1" aria-hidden="true" class="relative block">
		<Thumb {task} class="rounded-sm" />
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
		{#if hint}
			<p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-build-hint>
				<MessagesSquare class="size-3.5" aria-hidden="true" /><span
					>{hint.questions ?? ''}{#if hint.questions && hint.docs}{sep}{/if}{#if hint.docs}<a
							href="{href}?tab=docs"
							class="hover:text-foreground hover:underline"
							data-build-docs>{hint.docs}</a
						>{/if}</span
				>
			</p>
		{/if}
		{#if task.preview}<CardPreview {task} />{/if}
		<div class="mt-4"><StageTrack {task} /></div>
		<div class="mt-5 flex flex-wrap gap-2">
			<!-- Review PR opens the PR with the review agent's guide; GitHub stays one click away. -->
			{#if review && rv.preview}
				<Button class="flex-1" href={rv.preview.url} target="_blank" rel="noreferrer"
					>Open preview<ExternalLink /></Button
				>
				{#if rv.pr}
					<Button variant="outline" href="{href}/review" data-review-pr><Compass />Review PR</Button
					>
				{/if}
			{:else if review && rv.pr}
				<Button class="flex-1" href="{href}/review" data-review-pr><Compass />Review PR</Button>
				<Button variant="outline" href={rv.pr.url} target="_blank" rel="noreferrer"
					>On GitHub<ExternalLink /></Button
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
