<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { composerKey } from '$lib/bridge';
	import { ArrowUp } from '@lucide/svelte';

	let {
		text = $bindable(''),
		taskId = null,
		disabled = false,
		disabledReason = null,
		onSend
	}: {
		text?: string;
		/** The thread's task: every message sent here is about it. */
		taskId?: string | null;
		disabled?: boolean;
		disabledReason?: string | null;
		onSend: (text: string) => void;
	} = $props();

	let field: HTMLTextAreaElement | null = $state(null);
	const MAX_HEIGHT = 200;

	/** Focus the field with the caret after any prefilled text. */
	export function focus() {
		field?.focus();
		field?.setSelectionRange(text.length, text.length);
	}

	// Grow with the text up to a cap; past it the field scrolls without a scrollbar.
	$effect(() => {
		void text;
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
	});

	const canSend = $derived(!disabled && text.trim().length > 0);

	function send() {
		if (!canSend) return;
		onSend(text.trim());
		text = '';
		field?.focus();
	}

	// Enter sends, Shift+Enter is a new line (see composerKey).
	function keydown(e: KeyboardEvent) {
		if (composerKey(e) === 'send') {
			e.preventDefault();
			send();
		}
	}
</script>

<div
	class="rounded-2xl border bg-card shadow-xs transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/20"
>
	<label for="composer" class="sr-only">Message Firstmate</label>
	<textarea
		id="composer"
		bind:this={field}
		bind:value={text}
		onkeydown={keydown}
		rows="1"
		placeholder={disabled
			? 'Messaging is unavailable'
			: taskId
				? 'Message Firstmate about this task…'
				: 'Message Firstmate…'}
		{disabled}
		class="no-scrollbar block max-h-[200px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
	></textarea>
	<div class="flex items-center gap-2 px-2 pb-2">
		{#if taskId}
			<span class="inline-flex h-8 min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground">
				About <span class="truncate font-mono text-foreground">{taskId}</span>
			</span>
		{/if}
		<span class="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
			<kbd class="rounded border bg-muted px-1.5 py-0.5 font-sans">Enter</kbd> to send,
			<kbd class="ml-1 rounded border bg-muted px-1.5 py-0.5 font-sans">Shift</kbd>
			<kbd class="rounded border bg-muted px-1.5 py-0.5 font-sans">Enter</kbd> for a new line
		</span>
		<Button size="sm" onclick={send} disabled={!canSend} class="ml-auto sm:ml-0"
			><ArrowUp />Send</Button
		>
	</div>
</div>
{#if disabled && disabledReason}
	<p class="mt-2 text-xs text-danger">{disabledReason}</p>
{/if}
