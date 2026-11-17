<script lang="ts">
	import { onMount } from 'svelte';
	import type { Box } from '$lib/motion';
	import { liveReviewHref, liveReviewOn } from '$lib/client/livereview.svelte';
	import { reviewSurface } from '$lib/client/reviewsurface';
	import PreviewStudio from './PreviewStudio.svelte';

	/**
	 * A task's preview opened full screen, from anywhere that opens one (a
	 * preview in the chat or a link to it, a task's card, line or chip, the task
	 * and decision slide-outs, the task page): one way in, the same everywhere.
	 * While the experimental `livereview` feature is on, a preview a task
	 * reported whose work is still under way opens as the page itself, in a new
	 * tab, with the review's panel on it (/tasks/<id>/live): nothing is recorded
	 * until the captain starts it there, and Wheelhouse stays as it was in this
	 * tab. A browser that blocks the new tab opens it in this one instead. Anything else (the switch off, landed work, a review board, a
	 * preview no task reported, a review-surface plugin on) opens as it always
	 * did, in PreviewStudio. Closing it leaves the captain where they opened it.
	 */
	let {
		taskId,
		title,
		url,
		talk = true,
		board = false,
		from = null,
		onclose
	}: {
		taskId: string | null;
		title: string;
		url: string;
		talk?: boolean;
		board?: boolean;
		from?: Box | null;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	const live = liveReviewOn() && !!taskId && talk && !board && !reviewSurface();

	onMount(() => {
		if (!live || !taskId) return;
		const href = liveReviewHref(taskId);
		const tab = window.open(href, '_blank');
		// The previewed page (a project's own code) gets no hold on this Wheelhouse tab.
		if (tab) tab.opener = null;
		else location.assign(href);
		onclose();
	});
</script>

{#if !live}
	<PreviewStudio {taskId} {title} {url} {talk} {board} {from} {onclose} />
{/if}
