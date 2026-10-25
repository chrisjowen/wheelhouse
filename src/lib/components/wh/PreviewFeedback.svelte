<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { sendToInbox } from '$lib/client/chat.svelte';
	import { clock } from '$lib/format';
	import { feedbackNote } from '$lib/preview';
	import { Send } from '@lucide/svelte';

	/**
	 * Review feedback typed under a preview. It goes the way every Wheelhouse
	 * message does: a note in Firstmate's inbox about this task, which Firstmate
	 * passes to the task's worker. `onsent` lets a comment thread above it refresh.
	 */
	let {
		taskId,
		url,
		rows = 2,
		onsent
	}: { taskId: string; url: string; rows?: number; onsent?: () => void } = $props();
	const id = $props.id();

	let text = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let sent = $state<{ at: string; pending: boolean } | null>(null);

	async function send() {
		if (!text.trim() || sending) return;
		sending = true;
		error = null;
		const r = await sendToInbox(feedbackNote(url, text), page.data.sessionToken as string, taskId);
		sending = false;
		if (!r.ok) {
			error = r.error;
			return;
		}
		sent = { at: new Date().toISOString(), pending: !!r.pending };
		text = '';
		onsent?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void send();
		}
	}
</script>

<form
	class="mt-3"
	onsubmit={(e) => {
		e.preventDefault();
		void send();
	}}
	data-preview-feedback
>
	<label class="text-xs font-medium text-muted-foreground" for="feedback-{id}"
		>Feedback on this preview</label
	>
	<Textarea
		id="feedback-{id}"
		bind:value={text}
		{onkeydown}
		{rows}
		maxlength={8000}
		placeholder="What should change? It goes to the worker through Firstmate."
		class="mt-1 min-h-14 text-sm"
	/>
	<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
		<Button type="submit" size="sm" disabled={!text.trim() || sending}
			><Send />{sending ? 'Sending…' : 'Send feedback'}</Button
		>
		{#if error}
			<p class="text-xs text-danger" role="alert">{error}</p>
		{:else if sent}
			<p class="text-xs text-muted-foreground" role="status" data-feedback-sent>
				{sent.pending
					? `Saved at ${clock(sent.at)}; Wheelhouse is confirming Firstmate has it.`
					: `Sent at ${clock(sent.at)}. Firstmate passes it to the worker.`}
			</p>
		{:else}
			<p class="text-xs text-muted-foreground">⌘/Ctrl+Enter sends.</p>
		{/if}
	</div>
</form>
