<script lang="ts">
	import WhereBadge from '$lib/components/wh/mates/WhereBadge.svelte';
	import type { TaskSummary } from '$lib/types';
	import { plural } from '$lib/format';
	import { pullRequests } from '$lib/client/pullrequests';
	import { Compass, ExternalLink, MessageCircleQuestion } from '@lucide/svelte';
	import StageTrack from '../StageTrack.svelte';
	import { dotClass, textClass, tone } from '../tone';

	let { task, projectName }: { task: TaskSummary; projectName: string } = $props();
	const t = $derived(tone(task));
	// The project's plugin review tab while one is on, else the PR on GitHub.
	const prLink = $derived(task.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const asked = $derived(task.build?.questions ?? 0);
	const open = $derived(task.build?.open ?? 0);
</script>

<!-- The card's essentials only: project, status, title, passage and questions. The title link covers it. -->
<article
	class="group relative flex min-w-0 flex-col rounded-lg border bg-card px-3.5 pt-3 pb-3.5 transition-colors duration-200 hover:border-input hover:shadow-[0_1px_0_var(--hair)] has-[a[data-card-link]:focus-visible]:ring-3 has-[a[data-card-link]:focus-visible]:ring-ring/50 {t ===
	'you'
		? 'border-t-2 border-t-sea'
		: ''}"
	data-compact-card
>
	<div class="flex min-w-0 items-center justify-between gap-2 text-xs">
		<span class="flex min-w-0 items-center gap-1">
			<span
				class="min-w-0 truncate rounded-sm border border-hair bg-panel px-1.5 py-0.5 text-sea"
				title={projectName}>{projectName}</span
			>
			<WhereBadge {task} />
		</span>
		<span class="flex shrink-0 items-center gap-1.5 {textClass[t]}"
			><span class="size-1.5 rounded-full {dotClass[t]}" aria-hidden="true"
			></span>{task.statusLabel}</span
		>
	</div>
	<a
		href="/tasks/{encodeURIComponent(task.id)}"
		data-card-link
		class="mt-2 line-clamp-2 leading-snug font-medium group-hover:underline after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none"
		title={task.title}>{task.shortTitle}</a
	>
	<div class="mt-auto pt-3.5"><StageTrack {task} /></div>
	{#if asked}
		<p class="tabular mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
			<MessageCircleQuestion class="size-3.5" aria-hidden="true" />
			{asked}
			{plural(asked, 'question', 'questions')}{#if open}<span class="text-warning"
					>{` · ${open} open`}</span
				>{/if}
		</p>
	{/if}
	{#if prLink && task.pr}
		<a
			href={prLink.href}
			target={prLink.external ? '_blank' : undefined}
			rel={prLink.external ? 'noreferrer' : undefined}
			class="relative z-10 mt-2 inline-flex items-center gap-1.5 self-start text-xs text-sea hover:underline"
			data-review-pr
			><Compass class="size-3.5" aria-hidden="true" />Review PR{task.pr.number
				? ` #${task.pr.number}`
				: ''}{#if prLink.external}<ExternalLink class="size-3" aria-hidden="true" />{/if}</a
		>
	{/if}
</article>
