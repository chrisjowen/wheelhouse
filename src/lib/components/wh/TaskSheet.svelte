<script lang="ts">
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { taskSheet } from '$lib/client/tasksheet.svelte';
	import { consoleInImage } from '$lib/card';
	import { fadeQuick, rise, slideFromRight, type Box } from '$lib/motion';
	import type { TaskDetail } from '$lib/types';
	import { ArrowUpRight, X } from '@lucide/svelte';
	import ConsoleWindow from './ConsoleWindow.svelte';
	import PreviewStudio from './PreviewStudio.svelte';
	import TaskOverview from './TaskOverview.svelte';

	/**
	 * A task in a side panel that slides out over the page it was opened from,
	 * so looking at work never means leaving what the captain was doing. It
	 * shows the task page's overview (TaskOverview), what the worker was asked
	 * to do (the captain's intent from its brief, as the page's timeline starts)
	 * and, for work under way, the worker's live terminal; Live preview opens the
	 * preview in place, and Open full page goes to the task page for its
	 * timeline, tabs and plugin sections.
	 * Esc, the close button, a click beside it or Back closes it, and focus
	 * returns to what opened it. Which task is open is in the address
	 * (`?task=`, lib/client/tasksheet.svelte.ts).
	 */

	const id = $derived(taskSheet.id);
	let fetched = $state<TaskDetail | null>(null);
	let problem = $state<{ id: string; message: string } | null>(null);
	let lastFetch = { id: '', at: 0 };

	// The live summary from the fleet stream shows at once; the evidence follows, refreshed at
	// most every 10 s while the fleet changes.
	$effect(() => {
		void live.revision;
		const want = id;
		if (!want || (lastFetch.id === want && Date.now() - lastFetch.at < 10_000)) return;
		lastFetch = { id: want, at: Date.now() };
		fetch(`/api/tasks/${encodeURIComponent(want)}`)
			.then(async (r) => {
				if (r.ok) return (await r.json()) as TaskDetail;
				const body = (await r.json().catch(() => null)) as { message?: string } | null;
				problem = {
					id: want,
					message: body?.message ?? `Wheelhouse could not read it (${r.status}).`
				};
				return null;
			})
			.then((d) => {
				if (d && d.task.id === want) fetched = d;
			})
			.catch(() => {});
	});

	const detail = $derived(fetched && fetched.task.id === id ? fetched : null);
	const task = $derived(
		(id ? currentFleet()?.tasks.find((t) => t.id === id) : null) ?? detail?.task ?? null
	);
	const missing = $derived(problem && problem.id === id && !task ? problem.message : null);

	$effect(() => {
		if (task?.preview) return previewChecks.watch(task.id);
	});

	// What the open preview shows, kept as it was opened so it can shrink away after the task goes.
	let studio = $state<{
		from: Box | null;
		taskId: string;
		title: string;
		url: string;
		talk: boolean;
	} | null>(null);
	function openPreview(from: HTMLElement) {
		if (!task?.preview) return;
		studio = {
			from: from.getBoundingClientRect(),
			taskId: task.id,
			title: task.shortTitle,
			url: task.preview.url,
			talk: task.status !== 'landed'
		};
	}
	$effect(() => {
		if (!id) studio = null;
	});

	/** Focus moves into the panel and, once it has gone, back to what opened it. */
	function holdFocus(node: HTMLElement) {
		const before = document.activeElement as HTMLElement | null;
		node.focus({ preventScroll: true });
		return () => {
			const now = document.activeElement;
			if (!now || now === document.body || node.contains(now))
				before?.focus?.({ preventScroll: true });
		};
	}

	function onkeydown(e: KeyboardEvent) {
		// Keys in something opened over the panel (a preview, a screenshot) are that one's own.
		const within = (e.target as Element | null)?.closest('dialog, [role="dialog"]');
		if (within && within !== e.currentTarget) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			taskSheet.close();
			return;
		}
		if (e.key !== 'Tab') return;
		// Keep Tab inside the panel while it is open.
		const panel = e.currentTarget as HTMLElement;
		const all = [
			...panel.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null || el === document.activeElement);
		if (!all.length) return;
		const first = all[0];
		const last = all[all.length - 1];
		if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

{#if id}
	<div
		class="fixed inset-0 z-40 bg-foreground/15 dark:bg-black/40"
		transition:fadeQuick
		onclick={() => taskSheet.close()}
		aria-hidden="true"
	></div>
	<div
		class="fixed inset-y-0 right-0 z-40 flex w-[min(36rem,100vw)] flex-col border-l border-hair bg-panel shadow-[-12px_0_32px_-16px_rgb(20_33_61/0.35)] outline-none"
		role="dialog"
		aria-modal="true"
		aria-label={task ? task.title : 'Task'}
		tabindex="-1"
		transition:slideFromRight
		{onkeydown}
		{@attach holdFocus}
		data-task-sheet={id}
	>
		<div class="flex h-14 shrink-0 items-center gap-1 border-b border-hair px-4 sm:px-6">
			<span class="section-label flex-1 pr-2 text-[1.05rem]">Task</span>
			<a
				href="/tasks/{encodeURIComponent(id)}"
				class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
				data-full-page>Open full page<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
			>
			<button
				type="button"
				class="-mr-2 flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Close (Esc)"
				title="Close (Esc)"
				onclick={() => taskSheet.close()}><X class="size-4" aria-hidden="true" /></button
			>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 sm:px-6">
			{#key id}
				<div in:rise={{ y: 6 }}>
					{#if task}
						<TaskOverview {task} {detail} heading="h2" onpreview={openPreview} />
						{#if detail?.brief.available && detail.brief.value.intent}
							<!-- The first thing the page's timeline shows: what the worker was asked. -->
							<section class="mt-6 border-t pt-5" aria-label="Instructions" data-brief>
								<h3 class="text-sm font-medium">What the worker was asked</h3>
								<blockquote
									class="mt-2 line-clamp-4 border-l-2 border-brass pl-3 font-reading leading-relaxed whitespace-pre-line"
								>
									{detail.brief.value.intent}
								</blockquote>
								<a
									href="/tasks/{encodeURIComponent(task.id)}?tab=timeline"
									class="mt-2 inline-block text-sm text-sea hover:underline"
									>The full instructions and timeline</a
								>
							</section>
						{/if}
						{#if consoleInImage(task)}
							<!-- What the worker's terminal shows right now, sampled while on screen. -->
							<section class="mt-6 border-t pt-5" aria-label="Live terminal" data-terminal>
								<h3 class="mb-3 text-sm font-medium">Live terminal</h3>
								<ConsoleWindow {task} lines={12} class="rounded-xl" />
							</section>
						{/if}
					{:else}
						<p class="mt-6 text-sm text-muted-foreground">{missing ?? 'Loading…'}</p>
					{/if}
				</div>
			{/key}
		</div>
	</div>
	{#if studio}
		<PreviewStudio
			taskId={studio?.taskId ?? ''}
			title={studio?.title ?? ''}
			url={studio?.url ?? ''}
			talk={studio?.talk ?? false}
			from={studio?.from ?? null}
			onclose={() => (studio = null)}
		/>
	{/if}
{/if}
