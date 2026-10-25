<script lang="ts">
	import type { TaskOutput, TaskSummary } from '$lib/types';
	import { meaningfulConsoleLine, type ConsoleSample } from '$lib/card';
	import { clock } from '$lib/format';
	import { TerminalSquare } from '@lucide/svelte';

	let {
		task,
		lines = 12,
		class: cls = '',
		onsample
	}: {
		task: TaskSummary;
		lines?: number;
		class?: string;
		/** Called with the latest meaningful console line, for the card's "Now:" line. */
		onsample?: (sample: ConsoleSample | null) => void;
	} = $props();

	const POLL_MS = 6_000;
	/** Read a little more than is shown, so the Now line can find the worker's latest narration. */
	const EXTRA = 24;
	let el = $state<HTMLDivElement | null>(null);
	let visible = $state(false);
	let out = $state<TaskOutput | null>(null);
	let failed = $state(false);

	// Sample only while this window is on screen and the page is in front.
	$effect(() => {
		if (!el) return;
		const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), {
			rootMargin: '100px'
		});
		io.observe(el);
		return () => io.disconnect();
	});

	$effect(() => {
		if (!visible) return;
		const id = task.id;
		const n = lines + EXTRA;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			if (!document.hidden) {
				try {
					const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/output?lines=${n}`);
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

	$effect(() => {
		onsample?.(
			out?.available && out.lines.length
				? { line: meaningfulConsoleLine(out.lines), capturedAt: out.capturedAt }
				: null
		);
	});
</script>

<!-- The worker's live console while the work is under way: a bounded, read-only sample. -->
<div
	bind:this={el}
	class="relative flex aspect-[16/10] flex-col overflow-hidden rounded-sm border bg-terminal text-terminal-foreground {cls}"
	data-console={task.id}
>
	<div
		class="flex items-center gap-1.5 border-b border-terminal-foreground/10 px-3 py-1.5 text-[10px] text-terminal-foreground/60"
	>
		<TerminalSquare class="size-3" aria-hidden="true" />
		<span>Live console</span>
		<span class="ml-auto">read-only{out?.capturedAt ? ` · ${clock(out.capturedAt)}` : ''}</span>
	</div>
	{#if out?.available && out.lines.length}
		<pre
			class="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 py-2 font-mono text-[10px] leading-[1.45] whitespace-pre"
			aria-label="Latest lines of the worker’s terminal">{out.lines.slice(-lines).join('\n')}</pre>
	{:else}
		<p class="grid flex-1 place-items-center px-4 text-center text-xs text-terminal-foreground/60">
			{#if failed}Could not reach the Wheelhouse server.
			{:else if !out}Reading the worker’s terminal…
			{:else if !out.available}{out.reason}
			{:else}The terminal is empty.{/if}
		</p>
	{/if}
</div>
