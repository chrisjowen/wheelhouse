<script lang="ts">
	import {
		CircleCheck,
		CircleDashed,
		CircleX,
		Compass,
		ExternalLink,
		GitMerge,
		GitPullRequest,
		Maximize2,
		MonitorOff,
		MonitorPlay
	} from '@lucide/svelte';
	import type { ChatPreview } from '$lib/chat/previews';
	import { ago } from '$lib/format';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import type { Box } from '$lib/motion';

	/**
	 * A task's live preview under the Firstmate reply about it: the page,
	 * scaled down from desktop size as a Harbour card draws it, as a picture
	 * that opens full size (with the preview helper, while the work has not
	 * landed), and the pull request and its checks underneath. Landed work says
	 * so. The server checks the preview is on this machine and answering before
	 * a frame is drawn (LivePreview); until it answers the card says the preview
	 * has stopped, as one quiet line, and links to nothing that would not open.
	 */
	let {
		preview,
		project = null,
		now
	}: { preview: ChatPreview; project?: string | null; now: number } = $props();

	const task = $derived(preview.task);
	const url = $derived(task.preview?.url ?? null);
	// What LivePreview below found: only a preview that answers gets Full size, and a New tab link
	// only when there is a page to open (it answers, even if it cannot be embedded).
	const checked = $derived(previewChecks.checks[task.id]?.state ?? null);
	const stopped = $derived(checked === 'down');
	// Review opens the PR in a plugin's review tab while one is on for the project, else on GitHub.
	const prLink = $derived(task.pr ? pullRequests.review(task.projectId, task.pr) : null);
	let full = $state(false);
	// Full size grows out of the picture of the page, and shrinks back into it.
	let picture = $state<HTMLElement>();
	let from = $state<Box | null>(null);
	function open() {
		from = picture?.getBoundingClientRect() ?? null;
		full = true;
	}

	const CHECKS = {
		green: { icon: CircleCheck, text: 'Checks passed', tone: 'text-success' },
		pending: { icon: CircleDashed, text: 'Checks running', tone: 'text-muted-foreground' },
		red: { icon: CircleX, text: 'Checks failed', tone: 'text-danger' }
	};
	const checks = $derived(task.pipeline?.ci ? CHECKS[task.pipeline.ci] : null);
	const at = $derived(
		preview.landed ? (task.mergedAt ?? task.preview?.reportedAt) : task.preview?.reportedAt
	);
</script>

<div
	class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border border-hair bg-card"
	data-chat-preview={preview.landed ? 'landed' : 'live'}
>
	<header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2.5 pb-2 text-sm">
		<span
			class="flex shrink-0 items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {preview.landed
				? 'bg-success/10 text-success'
				: stopped
					? 'bg-muted text-muted-foreground'
					: 'bg-sea/10 text-sea'}"
			>{#if preview.landed}<GitMerge
					class="size-3"
					aria-hidden="true"
				/>Landed{:else if stopped}<MonitorOff class="size-3" aria-hidden="true" />Preview stopped{:else}<MonitorPlay
					class="size-3"
					aria-hidden="true"
				/>Live preview{/if}</span
		>
		{#if project}
			<span
				class="shrink-0 rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>{project}</span
			>
		{/if}
		<a
			href="/tasks/{encodeURIComponent(task.id)}"
			class="order-last min-w-0 basis-full truncate font-medium hover:underline sm:order-none sm:basis-auto"
			>{task.shortTitle}</a
		>
		{#if at}
			<span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{ago(at, now)}</span
			>
		{/if}
	</header>

	<div class="border-y border-hair" bind:this={picture}>
		<LivePreview taskId={task.id} compact toolbar={false} onopen={open} />
	</div>

	<footer class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
		{#if task.pr}
			<a
				href={task.pr.url}
				target="_blank"
				rel="noreferrer"
				class="inline-flex min-w-0 items-center gap-1 text-sea hover:underline"
				>{#if preview.landed}<GitMerge
						class="size-3.5 shrink-0"
						aria-hidden="true"
					/>{:else}<GitPullRequest class="size-3.5 shrink-0" aria-hidden="true" />{/if}<span
					class="truncate"
					>{task.pr.number ? `Pull request #${task.pr.number}` : 'Pull request'}</span
				></a
			>
		{/if}
		{#if checks}
			<span class="inline-flex items-center gap-1 {checks.tone}"
				><checks.icon class="size-3.5" aria-hidden="true" />{checks.text}</span
			>
		{/if}
		<span class="ml-auto flex items-center gap-1">
			<!-- Only a plugin's review tab: the pull request on GitHub is linked beside it already. -->
			{#if prLink && !prLink.external}
				<a
					href={prLink.href}
					class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-accent"
					data-review-pr><Compass class="size-3.5" aria-hidden="true" />Review</a
				>
			{/if}
			{#if checked === 'live'}
				<button
					type="button"
					class="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-accent"
					onclick={open}><Maximize2 class="size-3.5" aria-hidden="true" />Full size</button
				>
			{/if}
			{#if url && (checked === 'live' || checked === 'blocked')}
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
					title={url}>New tab<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
		</span>
	</footer>
</div>

{#if full && url}
	<PreviewStudio
		taskId={task.id}
		title={task.shortTitle}
		{url}
		talk={!preview.landed}
		{from}
		onclose={() => (full = false)}
	/>
{/if}
