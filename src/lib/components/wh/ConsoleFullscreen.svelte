<script lang="ts">
	import { untrack } from 'svelte';
	import type { TaskOutput, TaskSummary } from '$lib/types';
	import { clock } from '$lib/format';
	import {
		CONSOLE_LINE_HEIGHT,
		CONSOLE_POLL_MS,
		consoleColumns,
		fitConsole,
		pollTaskOutput
	} from '$lib/console';
	import { consoleFocus, enterFullscreen, leaveFullscreen } from '$lib/client/fullscreen.svelte';
	import { TerminalSquare, X } from '@lucide/svelte';

	/**
	 * A worker's live console filling the screen: the same read-only sample as the card's
	 * window, with more lines, refreshing every second while it is open. It asks the browser
	 * for real full screen, and since the worker's pane is not Wheelhouse's to resize, the
	 * capture is drawn larger instead: the font grows until the pane's width fills the
	 * screen, refitting whenever the screen changes size. Esc or the close button returns to
	 * the page, which keeps its scroll position; the console keeps the captain's place too,
	 * following the newest line only while they are at the bottom.
	 */
	let { task, open = $bindable(false) }: { task: TaskSummary; open?: boolean } = $props();

	const LINES = 200;
	/** The console's side padding, in pixels, left out of the width the text fills. */
	const PAD_X = 16;
	let dialog = $state<HTMLDialogElement | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);
	let out = $state<TaskOutput | null>(null);
	let failed = $state(false);
	let width = $state(0);
	let height = $state(0);
	let charWidth = $state(0.6);
	let following = true;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			following = true;
			dialog.showModal();
			// A dialog cannot itself go full screen; the page can, and the dialog covers it.
			void enterFullscreen(document.documentElement);
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// The browser's own Esc (or its exit button) leaves full screen; that closes the console too.
	$effect(() => {
		if (!open) return;
		const page = document.documentElement;
		let held = false;
		const onchange = () => {
			if (document.fullscreenElement === page) held = true;
			else if (held) {
				held = false;
				open = false;
			}
		};
		document.addEventListener('fullscreenchange', onchange);
		return () => {
			document.removeEventListener('fullscreenchange', onchange);
			leaveFullscreen(page);
		};
	});

	$effect(() => {
		if (!open) return;
		untrack(() => consoleFocus.open++);
		const stop = pollTaskOutput(task.id, LINES, CONSOLE_POLL_MS.full, {
			onresult: (r) => {
				out = r;
				failed = false;
			},
			onerror: () => (failed = true)
		});
		return () => {
			stop();
			untrack(() => consoleFocus.open--);
		};
	});

	// A monospace cell's width as a fraction of the font size, in the font actually on screen.
	$effect(() => {
		if (!scroller) return;
		const family = getComputedStyle(scroller).fontFamily;
		const ctx = document.createElement('canvas').getContext('2d');
		if (!ctx) return;
		ctx.font = `100px ${family}`;
		const w = ctx.measureText('M'.repeat(10)).width / 1000;
		if (w > 0) charWidth = w;
	});

	const lines = $derived(out?.available ? out.lines : []);
	const fit = $derived(
		fitConsole({
			width: width - 2 * PAD_X,
			height: height - 2 * PAD_X,
			cols: consoleColumns(lines),
			charWidth
		})
	);

	// New output (or a refit) keeps the newest line in view only if the captain has not scrolled up.
	$effect(() => {
		void out;
		void fit;
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
	onclose={() => {
		leaveFullscreen(document.documentElement);
		open = false;
	}}
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
			<div
				bind:this={scroller}
				bind:clientWidth={width}
				bind:clientHeight={height}
				{onscroll}
				class="flex min-h-0 flex-1 flex-col overflow-auto font-mono"
			>
				{#if lines.length}
					<!-- Bottom-anchored like a terminal: the newest line sits on the last row. -->
					<pre
						class="mt-auto whitespace-pre"
						style:padding="{PAD_X}px"
						style:font-size="{fit.fontSize}px"
						style:line-height={CONSOLE_LINE_HEIGHT}
						data-cols={fit.cols}
						data-rows={fit.rows}
						aria-label="The worker’s terminal">{lines.join('\n')}</pre>
				{:else}
					<p
						class="grid flex-1 place-items-center px-4 text-center font-sans text-sm text-terminal-foreground/60"
					>
						{#if failed}Could not reach the Wheelhouse server.
						{:else if !out}Reading the worker’s terminal…
						{:else if !out.available}{out.reason}
						{:else}The terminal is empty.{/if}
					</p>
				{/if}
			</div>
		</div>
	{/if}
</dialog>
