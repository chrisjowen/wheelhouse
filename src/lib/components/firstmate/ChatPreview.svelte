<script lang="ts">
	import {
		CircleCheck,
		CircleDashed,
		CircleX,
		ExternalLink,
		GitMerge,
		GitPullRequest,
		Maximize2,
		MonitorPlay
	} from '@lucide/svelte';
	import type { ChatPreview } from '$lib/chat/previews';
	import { ago } from '$lib/format';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';

	/**
	 * A task's live preview under the Firstmate reply about it: the page,
	 * scaled down from desktop size as a Harbour card draws it, as a picture
	 * that opens full size (with the feedback thread, while the work has not
	 * landed), and the pull request and its checks underneath. Landed work says
	 * so. The server checks the preview is on this machine and answering before
	 * a frame is drawn (LivePreview), and says plainly when it is not.
	 */
	let {
		preview,
		project = null,
		now
	}: { preview: ChatPreview; project?: string | null; now: number } = $props();

	const task = $derived(preview.task);
	const url = $derived(task.preview?.url ?? null);
	let full = $state(false);

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
				: 'bg-sea/10 text-sea'}"
			>{#if preview.landed}<GitMerge class="size-3" aria-hidden="true" />Landed{:else}<MonitorPlay
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

	<div class="border-y border-hair">
		<LivePreview
			taskId={task.id}
			compact
			toolbar={false}
			feedback={false}
			onopen={() => (full = true)}
		/>
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
			<button
				type="button"
				class="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-accent"
				onclick={() => (full = true)}
				><Maximize2 class="size-3.5" aria-hidden="true" />Full size</button
			>
			{#if url}
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
		feedback={!preview.landed}
		onclose={() => (full = false)}
	/>
{/if}
