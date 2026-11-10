<script lang="ts">
	import { onMount } from 'svelte';
	import type { Pointer } from '$lib/previewhelper';
	import { zoom, type Box } from '$lib/motion';
	import { MessageSquare, PanelRightClose, X } from '@lucide/svelte';
	import LivePreview from './LivePreview.svelte';
	import PreviewHelper from './PreviewHelper.svelte';

	/**
	 * A task's live preview full screen: the page on the left, the preview
	 * helper on the right, to talk it through and build the feedback list that
	 * goes to Firstmate as one message (PreviewHelper). The conversation and
	 * list are the same as on the task page's Preview tab.
	 *
	 * The helper sits beside the page rather than floating over it: a panel over
	 * the page hides the very part being talked about and reads as one more
	 * layer, while a docked panel never covers the page and folds away to give
	 * it the full width. `talk={false}` (work that has landed) leaves it out.
	 * `from` is where it was opened from (a thumbnail, a button): it grows out
	 * of that place and shrinks back into it when closed. A preview no task
	 * reported (`taskId` null: one Firstmate linked, a review board) has no
	 * helper: there is no worker to send its feedback to.
	 */
	let {
		taskId,
		title,
		url,
		talk = true,
		from = null,
		onclose
	}: {
		taskId: string | null;
		title: string;
		url: string;
		talk?: boolean;
		from?: Box | null;
		onclose: () => void;
	} = $props();

	const helper = $derived(talk && !!taskId);
	let panel = $state(true);
	let pointing = $state(false);
	let pointed = $state<{ pointer: Pointer; at: { x: number; y: number } } | null>(null);
	let dialog = $state<HTMLElement | null>(null);

	onMount(() => {
		const before = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.focus();
		return () => {
			document.body.style.overflow = overflow;
			before?.focus?.();
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Esc while pointing stops pointing; in a half-written message it clears focus first.
		if (pointing) {
			e.preventDefault();
			pointing = false;
			return;
		}
		const el = e.target as HTMLElement;
		if (el instanceof HTMLTextAreaElement && el.value.trim()) {
			el.blur();
			return;
		}
		e.preventDefault();
		onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	bind:this={dialog}
	class="fixed inset-0 z-50 flex flex-col bg-background outline-none"
	role="dialog"
	aria-modal="true"
	aria-label="Live preview of {title}, full screen"
	tabindex="-1"
	data-preview-studio
	transition:zoom={{ from }}
>
	<div class="flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
		<p class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium">{title}</span>
			<span class="text-muted-foreground">· Live preview</span>
		</p>
		{#if helper && panel}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				onclick={() => (panel = false)}
				><PanelRightClose class="size-4" aria-hidden="true" />Hide the helper</button
			>
		{/if}
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
			onclick={onclose}
			aria-label="Close full screen (Esc)"
			title="Close (Esc)"><X class="size-4" aria-hidden="true" />Close</button
		>
	</div>

	<div class="relative flex min-h-0 flex-1">
		<div class="min-w-0 flex-1 p-3">
			<LivePreview
				{taskId}
				url={taskId ? null : url}
				fill
				pointing={helper && panel && pointing}
				pin={helper && panel ? (pointed?.at ?? null) : null}
				onpoint={(p, at) => {
					pointed = { pointer: p, at };
					pointing = false;
				}}
			/>
		</div>

		{#if helper && panel && taskId}
			<aside class="flex min-h-0 w-[24rem] shrink-0 border-l bg-panel p-3 xl:w-[26rem]">
				<div class="flex min-h-0 w-full flex-col">
					<PreviewHelper
						task={{ id: taskId, shortTitle: title }}
						{url}
						bind:pointing
						bind:attached={pointed}
					/>
				</div>
			</aside>
		{:else if helper}
			<button
				type="button"
				class="absolute right-5 bottom-5 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-lg hover:bg-accent"
				onclick={() => (panel = true)}
				><MessageSquare class="size-4" aria-hidden="true" />Talk it through</button
			>
		{/if}
	</div>
</div>
