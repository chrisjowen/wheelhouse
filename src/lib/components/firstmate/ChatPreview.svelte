<script lang="ts">
	import {
		CircleCheck,
		CircleDashed,
		CircleX,
		Compass,
		ExternalLink,
		LayoutDashboard,
		GitMerge,
		GitPullRequest,
		Maximize2,
		MonitorOff,
		MonitorPlay
	} from '@lucide/svelte';
	import type { ChatPreview } from '$lib/chat/previews';
	import { ago } from '$lib/format';
	import { pullRequests } from '$lib/client/pullrequests';
	import { previewChecks, urlKey } from '$lib/client/previewchecks.svelte';
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import PreviewActions from '$lib/components/wh/plugins/PreviewActions.svelte';
	import type { Box } from '$lib/motion';
	import type { PreviewContext } from '$lib/plugins/types';

	/**
	 * A task's live preview under the Firstmate reply about it: the page,
	 * scaled down from desktop size as a Harbour card draws it, as a picture
	 * that opens full size (with the preview helper, while the work has not
	 * landed), and the pull request and its checks underneath. Landed work says
	 * so. The server checks the preview is on this machine and answering before
	 * a frame is drawn (LivePreview); until it answers the card says the preview
	 * has stopped, as one quiet line, and links to nothing that would not open.
	 * A preview no task reported (one Firstmate linked: a server of its own, a
	 * forwarded port, a review board) is a box of its own, with its address in
	 * place of the task. Plugins' preview actions (Share for review) sit in the
	 * footer, given the address shown here.
	 */
	let {
		preview,
		project = null,
		now
	}: { preview: ChatPreview; project?: string | null; now: number } = $props();

	const task = $derived(preview.task);
	// A task's card shows its preview, else its board; a box of its own, the address its reply links.
	const url = $derived(task ? (task.preview?.url ?? task.board?.url ?? null) : preview.url);
	// A task's preview is checked as the task's (a remote one through its forward); its board, as an address.
	const key = $derived(task?.preview ? task.id : urlKey(url ?? ''));
	const byTask = $derived(!!task?.preview);
	// What LivePreview below found: only a preview that answers gets Full size, and a New tab link
	// only when there is a page to open (it answers, even if it cannot be embedded).
	const check = $derived(previewChecks.checks[key] ?? null);
	const checked = $derived(check?.state ?? null);
	const stopped = $derived(checked === 'down');
	// Where it opens: the address as checked (a remote preview's forward), else as written.
	const shown = $derived(check?.url ?? url);
	// A task's board beside its preview gets a link of its own.
	const board = $derived(task?.preview && task.board ? task.board.url : null);
	const title = $derived(
		task?.shortTitle ?? (preview.board ? 'Review board' : (URL.parse(url ?? '')?.host ?? 'Preview'))
	);
	const action = $derived<PreviewContext | null>(
		shown && checked === 'live'
			? {
					url: shown,
					taskId: task?.id ?? null,
					title: task?.shortTitle ?? null,
					projectId: task?.projectId ?? null,
					board: preview.board
				}
			: null
	);
	// Review opens the PR in a plugin's review tab while one is on for the project, else on GitHub.
	const prLink = $derived(task?.pr ? pullRequests.review(task.projectId, task.pr) : null);
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
	const checks = $derived(task?.pipeline?.ci ? CHECKS[task.pipeline.ci] : null);
	const reported = $derived(task?.preview?.reportedAt ?? task?.board?.reportedAt ?? null);
	const at = $derived(preview.landed ? (task?.mergedAt ?? reported) : reported);
</script>

<div
	class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border border-hair bg-card"
	data-chat-preview={preview.landed ? 'landed' : 'live'}
	data-chat-preview-for={task ? 'task' : 'link'}
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
				/>Landed{:else if stopped}<MonitorOff class="size-3" aria-hidden="true" />{preview.board
					? 'Board stopped'
					: 'Preview stopped'}{:else if preview.board}<LayoutDashboard
					class="size-3"
					aria-hidden="true"
				/>Review board{:else}<MonitorPlay class="size-3" aria-hidden="true" />Live preview{/if}</span
		>
		{#if project}
			<span
				class="shrink-0 rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>{project}</span
			>
		{/if}
		{#if task}
			<a
				href="/tasks/{encodeURIComponent(task.id)}"
				class="order-last min-w-0 basis-full truncate font-medium hover:underline sm:order-none sm:basis-auto"
				>{task.shortTitle}</a
			>
		{:else}
			<span
				class="order-last min-w-0 basis-full truncate font-mono text-xs text-muted-foreground sm:order-none sm:basis-auto"
				title={url}>{url}</span
			>
		{/if}
		{#if at}
			<span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{ago(at, now)}</span
			>
		{/if}
	</header>

	<div class="border-y border-hair" bind:this={picture}>
		{#if byTask}
			<LivePreview taskId={task?.id} compact toolbar={false} onopen={open} />
		{:else}
			<LivePreview {url} compact toolbar={false} onopen={open} />
		{/if}
	</div>

	<footer class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
		{#if task?.pr}
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
		{#if board}
			<a
				href={board}
				target="_blank"
				rel="noreferrer"
				class="inline-flex min-w-0 items-center gap-1 text-sea hover:underline"
				title={board}
				data-open-board
				><LayoutDashboard class="size-3.5 shrink-0" aria-hidden="true" /><span class="truncate"
					>Open the board</span
				></a
			>
		{/if}
		<span class="ml-auto flex flex-wrap items-center justify-end gap-1">
			{#if action}<PreviewActions preview={action} />{/if}
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
			{#if shown && (checked === 'live' || checked === 'blocked')}
				<a
					href={shown}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
					title={shown}>New tab<ExternalLink class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
		</span>
	</footer>
</div>

{#if full && url}
	<PreviewStudio
		taskId={byTask ? (task?.id ?? null) : null}
		{title}
		{url}
		talk={!preview.landed}
		{from}
		onclose={() => (full = false)}
	/>
{/if}
