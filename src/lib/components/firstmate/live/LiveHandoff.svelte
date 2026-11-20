<script lang="ts">
	import { Check, LoaderCircle, Send, Trash2, Undo2 } from '@lucide/svelte';
	import { liveCall } from '$lib/client/livecall.svelte';

	/**
	 * Something the discussion crew passed on for Firstmate, held as a card:
	 * it goes to Firstmate with the briefing when the call ends, unless the
	 * captain sends it now or deletes it. With Settings → Discussion set to
	 * send at once, it says it has gone.
	 */
	let { handoffKey, note }: { handoffKey: string; note: string } = $props();

	const h = $derived(liveCall.handoff(handoffKey));
	const phase = $derived(h?.state ?? 'pending');
	const held = $derived(phase === 'pending' || phase === 'failed');
	const gone = $derived(phase === 'deleted' || phase === 'discarded');

	const LINE: Record<string, string> = {
		pending: 'This will be sent to Firstmate when the call ends.',
		sending: 'Sending to Firstmate…',
		sent: 'Sent to Firstmate.',
		failed: 'Could not send it. It will still go with the briefing when the call ends.',
		deleted: 'Deleted. Firstmate will not hear of it.',
		briefing: 'Goes to Firstmate with the Captain’s briefing below.',
		briefed: 'Sent to Firstmate with the Captain’s briefing.',
		discarded: 'Discarded when you quit. Firstmate did not hear of it.'
	};
	const line = $derived(
		phase === 'sent' && h?.direct
			? 'Sent to Firstmate straight away, as Settings → Discussion says.'
			: LINE[phase]
	);
</script>

<div
	class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border text-sm {held ||
	phase === 'sending'
		? 'border-sea/45 bg-card'
		: 'border-hair bg-card/60'}"
	data-live-handoff={phase}
>
	<header
		class="flex items-center gap-2 px-4 pt-2.5 pb-1 text-xs font-medium tracking-wider uppercase {held
			? 'text-sea'
			: 'text-muted-foreground'}"
	>
		<Send class="size-3.5" aria-hidden="true" />For Firstmate
		{#if held}<span class="font-normal tracking-normal normal-case">· held until the call ends</span
			>{/if}
	</header>
	<p class="px-4 pb-2.5 leading-snug {gone ? 'text-muted-foreground line-through' : ''}">
		{note}
	</p>
	<footer
		class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair px-4 py-2 {phase ===
		'failed'
			? 'bg-danger/5'
			: 'bg-muted/30'}"
	>
		<span
			class="flex min-w-[13rem] flex-1 items-center gap-1.5 text-xs {phase === 'failed'
				? 'text-danger'
				: 'text-muted-foreground'}"
			role="status"
		>
			{#if phase === 'sending'}<LoaderCircle
					class="size-3.5 shrink-0 animate-spin"
					aria-hidden="true"
				/>{:else if phase === 'sent' || phase === 'briefed'}<Check
					class="size-3.5 shrink-0 text-success"
					aria-hidden="true"
				/>{/if}{line}
		</span>
		{#if held}
			<span class="ml-auto flex shrink-0 gap-2">
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => liveCall.deleteHandoff(handoffKey)}
					><Trash2 class="size-3.5" aria-hidden="true" />Delete</button
				>
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sea px-3 text-xs font-medium text-on-accent"
					onclick={() => void liveCall.sendHandoff(handoffKey)}
					><Send class="size-3.5" aria-hidden="true" />{phase === 'failed'
						? 'Try again'
						: 'Send now'}</button
				>
			</span>
		{:else if phase === 'deleted' && liveCall.on}
			<button
				class="ml-auto inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sea hover:bg-sea/10"
				onclick={() => liveCall.restoreHandoff(handoffKey)}
				><Undo2 class="size-3.5" aria-hidden="true" />Undo</button
			>
		{/if}
	</footer>
</div>
