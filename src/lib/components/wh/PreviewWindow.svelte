<script lang="ts">
	import type { Box } from '$lib/motion';
	import { liveReviewOn } from '$lib/client/livereview.svelte';
	import { reviewSurface } from '$lib/client/reviewsurface';
	import PreviewStudio from './PreviewStudio.svelte';
	import LiveReview from './livereview/LiveReview.svelte';

	/**
	 * A task's preview opened full screen, from anywhere that opens one (a
	 * preview in the chat or a link to it, a task's card, line or chip, the task
	 * and decision slide-outs, the task page): one window, the same everywhere.
	 * While the experimental `livereview` feature is on, a preview a task
	 * reported whose work is still under way opens as a live review session
	 * (LiveReview: the page, recorded, with the scribe to talk to beside it);
	 * anything else (the switch off, landed work, a review board, a preview no
	 * task reported, a review-surface plugin on) opens as it always did, in
	 * PreviewStudio. Closing it leaves the captain where they opened it.
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

	const live = $derived(liveReviewOn() && !!taskId && talk && !board && !reviewSurface());
</script>

{#if live && taskId}
	<LiveReview {taskId} {title} {from} {onclose} />
{:else}
	<PreviewStudio {taskId} {title} {url} {talk} {board} {from} {onclose} />
{/if}
