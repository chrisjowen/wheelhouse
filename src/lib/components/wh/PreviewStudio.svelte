<script lang="ts">
	import { onMount } from 'svelte';
	import { clock } from '$lib/format';
	import { previewThread, type PreviewComment } from '$lib/taskpage';
	import type { MessagesView } from '$lib/types';
	import { MessageSquare, PanelRightClose, X } from '@lucide/svelte';
	import LivePreview from './LivePreview.svelte';
	import PreviewFeedback from './PreviewFeedback.svelte';

	/**
	 * A task's live preview full screen: the page on the left, the feedback
	 * thread on the right. Feedback goes the way the inline box sends it (a note
	 * about the task in Firstmate's inbox), and the thread lists what was sent
	 * from this preview, with whether Firstmate has it and any reply.
	 *
	 * The thread sits beside the page rather than floating over it: a panel over
	 * the page hides the very part being commented on and reads as one more
	 * layer, while a docked panel never covers the page and folds away to give
	 * it the full width.
	 */
	let {
		taskId,
		title,
		url,
		feedback = true,
		onclose
	}: {
		taskId: string;
		title: string;
		url: string;
		feedback?: boolean;
		onclose: () => void;
	} = $props();

	const POLL_MS = 8_000;

	let panel = $state(true);
	let thread = $state<PreviewComment[]>([]);
	let threadError = $state<string | null>(null);
	let list = $state<HTMLElement | null>(null);
	let dialog = $state<HTMLElement | null>(null);

	async function loadThread() {
		try {
			const r = await fetch('/api/firstmate/messages');
			if (!r.ok) throw new Error(String(r.status));
			const v = (await r.json()) as MessagesView;
			const next = previewThread(v.messages, taskId);
			const grew = next.length > thread.length;
			thread = next;
			threadError = v.available ? null : v.reason;
			if (grew) requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight }));
		} catch {
			threadError = 'Could not read what was sent; Wheelhouse will try again.';
		}
	}

	onMount(() => {
		const before = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.focus();
		if (feedback) void loadThread();
		const t = feedback ? setInterval(loadThread, POLL_MS) : undefined;
		return () => {
			clearInterval(t);
			document.body.style.overflow = overflow;
			before?.focus?.();
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Esc in a half-written comment clears focus first rather than closing on it.
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
>
	<div class="flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
		<p class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium">{title}</span>
			<span class="text-muted-foreground">· Live preview</span>
		</p>
		{#if feedback}
			{#if panel}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					onclick={() => (panel = false)}
					><PanelRightClose class="size-4" aria-hidden="true" />Hide comments</button
				>
			{/if}
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
			<LivePreview {taskId} fill feedback={false} />
		</div>

		{#if feedback && panel}
			<aside
				class="flex min-h-0 w-[22rem] shrink-0 flex-col border-l xl:w-96"
				aria-label="Feedback on this preview"
			>
				<div class="border-b px-4 py-3">
					<h2 class="flex items-center gap-2 text-sm font-medium">
						<MessageSquare class="size-4 text-muted-foreground" aria-hidden="true" />Feedback
					</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">Goes to the worker through Firstmate.</p>
				</div>
				<ol
					bind:this={list}
					class="no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
					aria-label="Sent from this preview"
					data-preview-thread
				>
					{#each thread as c (c.id)}
						<li>
							<p class="text-sm leading-relaxed whitespace-pre-line">{c.text}</p>
							<p class="mt-1 text-xs {c.failed ? 'text-danger' : 'text-muted-foreground'}">
								{clock(c.at)} · {c.status}
							</p>
							{#if c.reply}
								<p
									class="mt-2 rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-line"
								>
									<span class="font-medium">Firstmate:</span>
									{c.reply}
								</p>
							{/if}
						</li>
					{:else}
						<li class="pt-6 text-center text-sm text-muted-foreground">
							Nothing sent from this preview yet.<br />Say what should change, as you look.
						</li>
					{/each}
					{#if threadError}<li class="text-xs text-warning">{threadError}</li>{/if}
				</ol>
				<div class="border-t px-4 pt-1 pb-4">
					<PreviewFeedback {taskId} {url} rows={3} onsent={loadThread} />
				</div>
			</aside>
		{:else if feedback}
			<button
				type="button"
				class="absolute right-5 bottom-5 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-lg hover:bg-accent"
				onclick={() => (panel = true)}
				><MessageSquare class="size-4" aria-hidden="true" />Comments{thread.length
					? ` (${thread.length})`
					: ''}</button
			>
		{/if}
	</div>
</div>
