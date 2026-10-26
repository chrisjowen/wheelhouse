<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { diffLines, linesOf } from '$lib/linediff';
	import { X } from '@lucide/svelte';

	/** The changes about to be saved, as a line diff, with what saving does. */
	let {
		open = $bindable(false),
		before,
		after,
		target,
		defaultRef,
		busy,
		error,
		onsave
	}: {
		open?: boolean;
		before: string;
		after: string;
		target: 'project' | 'captain';
		defaultRef: string | null;
		busy: boolean;
		error: string | null;
		onsave: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
	const lines = $derived(open ? diffLines(linesOf(before), linesOf(after)) : []);
	const added = $derived(lines.filter((l) => l.op === '+').length);
	const removed = $derived(lines.filter((l) => l.op === '-').length);
	const branch = $derived(defaultRef?.replace(/^origin\//, '') ?? 'the default branch');
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[90vh] w-[min(94vw,980px)] max-w-none overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60"
	onclose={() => (open = false)}
	aria-labelledby="review-title"
>
	{#if open}
		<div class="flex max-h-[90vh] flex-col">
			<div class="flex items-start gap-3 border-b px-5 py-4">
				<div class="min-w-0 flex-1">
					<h2 id="review-title" class="text-lg">Review and save</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{added} line{added === 1 ? '' : 's'} added, {removed} removed.
					</p>
				</div>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Close"
					onclick={() => (open = false)}><X class="size-4" aria-hidden="true" /></button
				>
			</div>
			<pre
				class="min-h-0 flex-1 overflow-auto bg-card px-0 py-2 font-mono text-xs leading-5"
				aria-label="Changes">{#each lines as l, i (i)}<span
						class="block px-5 {l.op === '+'
							? 'bg-success/10 text-success'
							: l.op === '-'
								? 'bg-danger/10 text-danger'
								: 'text-muted-foreground'}"
						><span class="mr-3 inline-block w-3 select-none" aria-hidden="true"
							>{l.op === ' ' ? '' : l.op}</span
						><span class="sr-only"
							>{l.op === '+' ? 'added: ' : l.op === '-' ? 'removed: ' : ''}</span
						>{l.text}</span
					>{/each}</pre>
			<div class="border-t px-5 py-4">
				<p class="text-sm leading-relaxed" data-save-note>
					{#if target === 'project'}
						<strong class="font-medium">This changes a file in the project’s repository:</strong>
						<code class="font-mono text-xs">.wheelhouse.yaml</code> in Firstmate’s clone of the
						project. It is not committed. Wheelhouse uses it once it is on {branch}, so ask
						Firstmate to ship it.
					{:else}
						<strong class="font-medium">This changes your own Wheelhouse config</strong> for this project,
						outside the repository. Wheelhouse uses it within a minute.
					{/if}
				</p>
				{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
				<div class="mt-4 flex flex-wrap justify-end gap-2">
					<Button variant="outline" onclick={() => (open = false)}>Keep editing</Button>
					<Button disabled={busy || (!added && !removed)} onclick={onsave}
						>{busy
							? 'Saving…'
							: target === 'project'
								? 'Save to the repository file'
								: 'Save to your config'}</Button
					>
				</div>
			</div>
		</div>
	{/if}
</dialog>
