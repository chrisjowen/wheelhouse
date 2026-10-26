<script lang="ts">
	import type { TaskOutput, TaskSummary } from '$lib/types';
	import { clock } from '$lib/format';
	import { ChevronRight, Maximize2 } from '@lucide/svelte';
	import ConsoleFullscreen from './ConsoleFullscreen.svelte';

	let { task, live = true }: { task: TaskSummary; live?: boolean } = $props();

	const LINES = 40;
	const POLL_MS = 5_000;
	let open = $state(false);
	let out = $state<TaskOutput | null>(null);
	let failed = $state<string | null>(null);
	let full = $state(false);

	// Output is sampled only while this inspector is open and on screen.
	$effect(() => {
		if (!open || !live) return;
		const id = task.id;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			try {
				const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/output?lines=${LINES}`);
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				out = await r.json();
				failed = null;
			} catch (e) {
				failed = `Could not reach the Wheelhouse server (${(e as Error).message}).`;
			}
			if (!stop) timer = setTimeout(load, POLL_MS);
		};
		void load();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});
</script>

<details class="group rounded-xl border" bind:open>
	<summary
		class="flex list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden"
	>
		<ChevronRight
			class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
			aria-hidden="true"
		/>
		<span class="font-medium">Raw terminal output</span>
		<span class="text-muted-foreground">read-only sample of the last {LINES} lines</span>
	</summary>
	<div class="border-t p-4">
		{#if !task.outputAvailable}
			<p class="text-sm text-muted-foreground">Not available. {task.outputNote}</p>
		{:else if failed}
			<p class="text-sm text-warning">{failed}</p>
		{:else if !out}
			<p class="text-sm text-muted-foreground">Reading the worker’s terminal…</p>
		{:else if !out.available}
			<p class="text-sm text-muted-foreground">Not available. {out.reason}</p>
		{:else}
			<div class="mb-2 flex justify-end">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
					onclick={() => (full = true)}
					><Maximize2 class="size-3.5" aria-hidden="true" />Full screen</button
				>
			</div>
			<pre
				class="max-h-96 overflow-auto rounded-lg bg-terminal p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground">{out
					.lines.length
					? out.lines.join('\n')
					: '(the terminal is empty)'}</pre>
			<p class="mt-2 text-xs text-muted-foreground">
				Captured {clock(out.capturedAt)}, refreshed every {POLL_MS / 1000} s while open. A bounded sample
				of the screen, not a full transcript. Wheelhouse cannot type into it.
			</p>
		{/if}
	</div>
</details>
<ConsoleFullscreen {task} bind:open={full} />
