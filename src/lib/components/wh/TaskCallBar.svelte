<script lang="ts">
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import type { InboxView } from '$lib/inbox';
	import { awaitingReview } from '$lib/review';
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import {
		Compass,
		ExternalLink,
		MessageSquare,
		MessageSquareReply,
		MonitorPlay
	} from '@lucide/svelte';

	/**
	 * The task page's foot on a phone, kept in reach above the tab bar: the
	 * chat about the task, and the captain's call when there is one. That is
	 * answering its open question while the decision waits on the captain,
	 * else reviewing its pull request while it waits on the captain, else its
	 * live preview. Not shown from `md` up,
	 * where the overview's own buttons are always in view.
	 */
	let { task, onpreview }: { task: TaskSummary; onpreview: (from: HTMLElement) => void } = $props();

	const questions = $derived(inbox.forTask(task.id, page.data.inbox as InboxView | undefined));
	const prLink = $derived(task.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const call = $derived(
		questions.length && task.attention?.owner === 'captain' && task.attention.kind === 'decision'
			? 'answer'
			: awaitingReview(task) && prLink
				? 'review'
				: task.preview && !previewChecks.stopped(task.id)
					? 'preview'
					: null
	);

	/** Bring the first open question, in the overview, into view. */
	function answer() {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.querySelector('aside [aria-label="Open questions"] > li')
			?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
	}
</script>

<div
	class="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-30 -mx-4 mt-4 flex gap-2 border-t bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
	data-task-call
>
	<Button
		variant={call ? 'outline' : 'default'}
		class="h-11 min-w-0 flex-1 rounded-xl"
		href="/?chat={encodeURIComponent(task.id)}"><MessageSquare />Chat about this</Button
	>
	{#if call === 'answer'}
		<Button class="h-11 min-w-0 flex-1 rounded-xl" onclick={answer} data-call="answer"
			><MessageSquareReply />Answer</Button
		>
	{:else if call === 'review' && prLink && task.pr}
		<Button
			class="h-11 min-w-0 flex-1 rounded-xl"
			href={prLink.href}
			target={prLink.external ? '_blank' : undefined}
			rel={prLink.external ? 'noreferrer' : undefined}
			data-call="review"
			><Compass />Review {task.pr.number
				? `#${task.pr.number}`
				: 'the PR'}{#if prLink.external}<ExternalLink />{/if}</Button
		>
	{:else if call === 'preview'}
		<Button
			class="h-11 min-w-0 flex-1 rounded-xl"
			onclick={(e: MouseEvent) => onpreview(e.currentTarget as HTMLElement)}
			data-call="preview"><MonitorPlay />Live preview</Button
		>
	{/if}
</div>
