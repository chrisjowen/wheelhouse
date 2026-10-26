<script lang="ts">
	import type { TaskOutput, TaskSummary } from '$lib/types';
	import { clock } from '$lib/format';
	import { TerminalSquare, X } from '@lucide/svelte';

	/**
	 * A worker's live console filling the viewport: the same read-only sample as the card's
	 * window, with more lines, still refreshing while it is open. Esc or the close button
	 * returns to the page, which keeps its scroll position; the console keeps the captain's
	 * place too, following the newest line only while they are at the bottom.
	 */
	let { task, open = $bindable(false) }: { task: TaskSummary; open?: boolean } = $props();

	const LINES = 200;
	const POLL_MS = 3_000;
	let dialog = $state<HTMLDialogElement | null>(null);
	let scroller = $state<HTMLPreElement | null>(null);
	let out = $state<TaskOutput | null>(null);
	let failed = $state(false);
	let following = true;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			following = true;
			dialog.showModal();
		} else if (!open && dialog.open) dialog.close();
	});

	$effect(() => {
		if (!open) return;
		const id = task.id;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			if (!document.hidden) {
				try {
					const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/output?lines=${LINES}`);
					if (!r.ok) throw new Error(`HTTP ${r.status}`);
					out = await r.json();
					failed = false;
				} catch {
					failed = true;
				}
			}
			if (!stop) timer = setTimeout(load, POLL_MS);
		};
		void load();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});

	// New output keeps the newest line in view only if the captain has not scrolled up to read.
	$effect(() => {
		void out;
		if (scroller && following) scroller.scrollTop = scroller.scrollHeight;
	});

	const onscroll = () => {
		if (scroller)
			following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
	};
</script>

<dialog
	bind:this={dialog}
	class="m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden bg-terminal p-0 text-terminal-foreground backdrop:bg-black/70"
	onclose={() => (open = false)}
	aria-label="{task.shortTitle}: live console"
	data-console-fullscreen={task.id}
>
	{#if open}
		<div class="flex h-full flex-col">
			<div
				class="flex shrink-0 items-center gap-2 border-b border-terminal-foreground/15 px-4 py-2.5 text-sm sm:px-6"
			>
				<TerminalSquare class="size-4 text-terminal-foreground/70" aria-hidden="true" />
				<span class="min-w-0 truncate font-medium">{task.shortTitle}</span>
				<span class="hidden text-terminal-foreground/60 sm:inline"
					>· live console, read-only{out?.capturedAt ? ` · ${clock(out.capturedAt)}` : ''}</span
				>
				<span class="ml-auto hidden text-xs text-terminal-foreground/60 sm:inline"
					>Esc to close</span
				>
				<button
					type="button"
					class="-mr-2 flex size-8 items-center justify-center rounded-md text-terminal-foreground/80 hover:bg-terminal-foreground/10 hover:text-terminal-foreground sm:ml-2"
					aria-label="Close the full-screen console"
					onclick={() => (open = false)}><X class="size-4" /></button
				>
			</div>
			{#if out?.available && out.lines.length}
				<pre
					bind:this={scroller}
					{onscroll}
					class="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-[1.5] whitespace-pre sm:px-6"
					aria-label="The worker’s terminal">{out.lines.join('\n')}</pre>
			{:else}
				<p
					class="grid flex-1 place-items-center px-4 text-center text-sm text-terminal-foreground/60"
				>
					{#if failed}Could not reach the Wheelhouse server.
					{:else if !out}Reading the worker’s terminal…
					{:else if !out.available}{out.reason}
					{:else}The terminal is empty.{/if}
				</p>
			{/if}
		</div>
	{/if}
</dialog>
