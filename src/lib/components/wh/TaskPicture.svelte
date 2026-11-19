<script lang="ts">
	import type { Picture } from '$lib/card';
	import { documents } from '$lib/client/documents.svelte';
	import { recordHref } from '$lib/documents';
	import { docHref } from '$lib/docpath';
	import type { TaskSummary } from '$lib/types';
	import { FileText } from '@lucide/svelte';
	import ConsoleWindow from './ConsoleWindow.svelte';
	import LivePreview from './LivePreview.svelte';
	import Thumb from './Thumb.svelte';

	/**
	 * A task's picture, the big square beside its overview (card.ts pictureFor
	 * chooses which): the worker's live console, its live preview (`onpreview`
	 * opens it full size), its report as a page that opens its permanent record
	 * in Documents (else the file), its latest screenshot (`href` opens the
	 * task), or a picture of its diff. Labelled above in the overview's small
	 * caps (`label`).
	 */
	let {
		task,
		picture,
		href,
		label,
		lines = 16,
		onpreview
	}: {
		task: TaskSummary;
		picture: Picture;
		href: string;
		label: string;
		lines?: number;
		onpreview?: () => void;
	} = $props();

	const record = $derived(picture === 'report' ? documents.recordFor(task.id) : null);
	const report = $derived(task.thumb.kind === 'report' ? task.thumb : null);
</script>

<div class="min-w-0 self-start" data-task-picture={picture}>
	<p class="mb-2 flex items-center gap-2 {label}">
		{#if picture === 'preview'}<span
				class="size-2 rounded-full bg-success motion-safe:animate-pulse"
				aria-hidden="true"
			></span>Live preview
		{:else if picture === 'console'}<span
				class="size-2 rounded-full {task.busy
					? 'bg-success motion-safe:animate-pulse'
					: 'bg-muted-foreground/50'}"
				aria-hidden="true"
			></span>The worker’s console, live
		{:else if picture === 'report'}{record ? 'Its report, in Documents' : 'Its report'}
		{:else if picture === 'shot'}Latest screenshot
		{:else}Files changed{/if}
	</p>
	{#if picture === 'preview'}
		<div class="overflow-hidden rounded-xl border bg-card shadow-sm">
			<LivePreview taskId={task.id} compact toolbar={false} onopen={onpreview} />
		</div>
	{:else if picture === 'console'}
		<ConsoleWindow {task} {lines} class="rounded-xl shadow-sm" />
	{:else if picture === 'report' && report}
		<!-- The report as a page: its permanent record when Documents has it, which still opens
		     after the task is closed. -->
		<a
			href={record ? recordHref(record.key) : docHref(report.path)}
			class="group flex aspect-[16/10] flex-col overflow-hidden rounded-xl border bg-card px-6 py-5 shadow-sm hover:border-sea/60"
			data-picture-report={record ? 'record' : 'file'}
		>
			<span class="flex items-center gap-2 text-xs text-muted-foreground">
				<FileText class="size-3.5 shrink-0" aria-hidden="true" />
				<span class="truncate font-mono">{report.path.split('/').pop()}</span>
			</span>
			<span
				class="mt-3 line-clamp-2 shrink-0 font-display text-xl leading-snug font-medium text-foreground"
				>{record?.title ?? report.title ?? 'Report'}</span
			>
			<span class="mt-2 line-clamp-4 min-h-0 text-sm leading-relaxed text-muted-foreground"
				>{report.excerpt}</span
			>
			<span class="mt-auto shrink-0 pt-3 text-sm text-sea group-hover:underline"
				>{record ? 'Open the report' : 'Open the report file'}</span
			>
		</a>
	{:else if picture === 'shot' && task.thumb.kind === 'screenshot'}
		<a {href} class="block overflow-hidden rounded-xl border shadow-sm">
			<img
				src={task.thumb.url}
				alt={task.thumb.name}
				class="aspect-[16/10] w-full object-cover object-top"
			/>
		</a>
	{:else}
		<a {href} class="block rounded-xl shadow-sm"><Thumb {task} class="rounded-xl" /></a>
	{/if}
</div>
