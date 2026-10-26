<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import DictateTextarea from '../DictateTextarea.svelte';
	import { clock } from '$lib/format';
	import { MessageCircleQuestionMark, ScanSearch, Send } from '@lucide/svelte';

	/**
	 * Ask the review agent about the PR (or one hunk), ask it for a focused
	 * review, or ask Firstmate for a change. The agent only reads and answers;
	 * a change request is a note to Firstmate, never straight to the worker.
	 */
	let {
		scope,
		agentProblem = null,
		busy = false,
		onask,
		onreview,
		onchange
	}: {
		/** "this pull request" or "this hunk". */
		scope: string;
		/** Why the agent cannot run now, if it cannot. */
		agentProblem?: string | null;
		busy?: boolean;
		onask: (question: string) => Promise<string | null>;
		onreview: () => Promise<string | null>;
		onchange: (text: string) => Promise<{ ok: boolean; error?: string; pending?: boolean }>;
	} = $props();
	const id = $props.id();

	let mode = $state<'ask' | 'change'>('ask');
	let text = $state('');
	let sending = $state(false);
	let error = $state<string | null>(null);
	let sent = $state<{ at: string; pending: boolean } | null>(null);

	async function submit() {
		if (!text.trim() || sending) return;
		sending = true;
		error = null;
		sent = null;
		if (mode === 'ask') {
			error = await onask(text);
			if (!error) text = '';
		} else {
			const r = await onchange(text);
			if (r.ok) {
				sent = { at: new Date().toISOString(), pending: !!r.pending };
				text = '';
			} else error = r.error ?? 'Not sent.';
		}
		sending = false;
	}

	async function review() {
		sending = true;
		error = await onreview();
		sending = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void submit();
		}
	}
</script>

<form
	class="space-y-2"
	onsubmit={(e) => {
		e.preventDefault();
		void submit();
	}}
	data-ask-box
>
	<div
		class="flex flex-wrap items-center gap-1 text-xs"
		role="radiogroup"
		aria-label="What to send"
	>
		<button
			type="button"
			role="radio"
			aria-checked={mode === 'ask'}
			class="rounded-full border px-2.5 py-0.5 {mode === 'ask'
				? 'border-foreground/30 bg-accent font-medium text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (mode = 'ask')}>Ask the review agent</button
		>
		<button
			type="button"
			role="radio"
			aria-checked={mode === 'change'}
			class="rounded-full border px-2.5 py-0.5 {mode === 'change'
				? 'border-foreground/30 bg-accent font-medium text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (mode = 'change')}>Ask Firstmate for a change</button
		>
	</div>
	<label class="sr-only" for="ask-{id}"
		>{mode === 'ask' ? `Question about ${scope}` : `Change to ${scope}`}</label
	>
	<DictateTextarea
		id="ask-{id}"
		bind:value={text}
		{onkeydown}
		rows={2}
		maxlength={4000}
		placeholder={mode === 'ask'
			? `Why was ${scope} done this way? What happens when…?`
			: `What should change in ${scope}? Firstmate passes it to the worker.`}
		class="min-h-14 text-sm"
	/>
	<div class="flex flex-wrap items-center gap-2">
		{#if mode === 'ask'}
			<Button type="submit" size="sm" disabled={!text.trim() || sending || busy || !!agentProblem}
				><MessageCircleQuestionMark />{sending ? 'Asking…' : 'Ask'}</Button
			>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={sending || busy || !!agentProblem}
				onclick={review}
				title="A focused review of {scope}: bugs, risks, missing tests"
				><ScanSearch />Request review</Button
			>
		{:else}
			<Button type="submit" size="sm" disabled={!text.trim() || sending}
				><Send />{sending ? 'Sending…' : 'Send to Firstmate'}</Button
			>
		{/if}
		{#if error}
			<p class="text-xs text-danger" role="alert">{error}</p>
		{:else if sent}
			<p class="text-xs text-muted-foreground" role="status" data-change-sent>
				{sent.pending
					? `Saved at ${clock(sent.at)}; Wheelhouse is confirming Firstmate has it.`
					: `Sent at ${clock(sent.at)}. Firstmate passes it to the worker.`}
			</p>
		{:else if mode === 'ask' && agentProblem}
			<p class="text-xs text-muted-foreground">{agentProblem}</p>
		{:else}
			<p class="text-xs text-muted-foreground">
				{mode === 'ask'
					? 'The agent reads the diff and the task’s records; it never changes code.'
					: 'Goes to Firstmate as a note about this task.'}
			</p>
		{/if}
	</div>
</form>
