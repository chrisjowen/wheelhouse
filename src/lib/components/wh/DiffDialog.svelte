<script lang="ts">
	import type { FileDiff } from '$lib/types';
	import { X } from '@lucide/svelte';

	/** One changed file's diff, read-only, in the page. `file` opens it; null closes it. */
	let { taskId, file = $bindable(null) }: { taskId: string; file?: string | null } = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let diff = $state<FileDiff | null>(null);
	let failed = $state<string | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (file && !dialog.open) dialog.showModal();
		else if (!file && dialog.open) dialog.close();
	});

	$effect(() => {
		const want = file;
		diff = null;
		failed = null;
		if (!want) return;
		let stale = false;
		fetch(`/api/tasks/${encodeURIComponent(taskId)}/diff?path=${encodeURIComponent(want)}`)
			.then(async (r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const d: FileDiff = await r.json();
				if (!stale) diff = d;
			})
			.catch((e) => {
				if (!stale) failed = `Could not reach the Wheelhouse server (${(e as Error).message}).`;
			});
		return () => (stale = true);
	});

	const lineClass = (l: string) =>
		l.startsWith('@@')
			? 'bg-sea/10 text-sea'
			: l.startsWith('+')
				? 'bg-success/10 text-success'
				: l.startsWith('-')
					? 'bg-danger/10 text-danger'
					: l.startsWith('\\')
						? 'text-muted-foreground italic'
						: '';
</script>

<dialog
	bind:this={dialog}
	class="m-auto h-[88vh] w-[min(94vw,1100px)] max-w-none overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60"
	onclose={() => (file = null)}
	onclick={(e) => e.target === dialog && dialog?.close()}
	aria-label={file ? `Changes to ${file}` : 'Changes'}
>
	{#if file}
		<div class="flex h-full flex-col">
			<div class="flex items-center gap-3 border-b px-4 py-2.5 text-sm">
				<span class="min-w-0 flex-1 truncate font-mono text-xs" title={file}>{file}</span>
				{#if diff?.available}
					{@const add = diff.value.lines.filter((l) => l.startsWith('+')).length}
					{@const del = diff.value.lines.filter((l) => l.startsWith('-')).length}
					<span class="tabular text-xs"
						><span class="text-success">+{add}</span>
						<span class="text-danger">−{del}</span></span
					>
				{/if}
				<span class="text-xs text-muted-foreground">read-only</span>
				<button
					type="button"
					class="rounded p-1 hover:bg-accent"
					onclick={() => dialog?.close()}
					aria-label="Close"><X class="size-4" /></button
				>
			</div>
			<div class="min-h-0 flex-1 overflow-auto">
				{#if failed}
					<p class="p-4 text-sm text-warning">{failed}</p>
				{:else if !diff}
					<p class="p-4 text-sm text-muted-foreground">Reading the diff…</p>
				{:else if !diff.available}
					<p class="p-4 text-sm text-muted-foreground" data-diff="unavailable">
						Diff not available. {diff.reason}
					</p>
				{:else if !diff.value.lines.length}
					<p class="p-4 text-sm text-muted-foreground">No text changes in this file.</p>
				{:else}
					<div
						class="min-w-max py-2 font-mono text-xs leading-relaxed whitespace-pre"
						role="presentation"
					>
						{#each diff.value.lines as l, i (i)}<div class="px-4 {lineClass(l)}">
								{l || ' '}
							</div>{/each}
					</div>
				{/if}
			</div>
			{#if diff?.available}
				<p class="border-t px-4 py-1.5 text-xs text-muted-foreground">
					From {diff.source}.{diff.value.truncated
						? ` Showing the first ${diff.value.lines.length} lines.`
						: ''}
				</p>
			{/if}
		</div>
	{/if}
</dialog>
