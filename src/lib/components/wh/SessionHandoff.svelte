<script lang="ts">
	import { page } from '$app/state';
	import { currentHealth, currentMessages } from '$lib/client/live.svelte';
	import { postMessage } from '$lib/client/messages';
	import { newRequestId, type LocalMessage } from '$lib/bridge';
	import { clock } from '$lib/format';
	import { handoffBody, handoffPrefill } from '$lib/sessions';
	import type { SessionSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import DeliveryState from './DeliveryState.svelte';
	import { Send } from '@lucide/svelte';

	/**
	 * Hand a session to Firstmate: an ordinary Bridge message with a stable
	 * request id. The parent owns the button that toggles `composing`.
	 */
	let {
		session: s,
		composing = $bindable(false),
		class: className = ''
	}: { session: SessionSummary; composing?: boolean; class?: string } = $props();

	const token = () => page.data.sessionToken as string;

	let text = $state('');
	let sent = $state<LocalMessage | null>(null);
	const health = $derived(currentHealth());
	const unavailable = $derived(
		health && !health.messaging.available
			? (health.messaging.reason ?? 'Messaging is unavailable.')
			: null
	);
	// Once Wheelhouse has it, the live message view carries its delivery and acknowledgement.
	const tracked = $derived.by((): LocalMessage | null => {
		if (!sent) return null;
		const id = sent.requestId;
		return currentMessages()?.messages.find((m) => m.requestId === id) ?? sent;
	});

	$effect(() => {
		if (composing && !text) text = handoffPrefill(s);
	});

	async function deliver(m: LocalMessage) {
		sent = { ...m, delivery: 'sending', deliveryDetail: null };
		const r = await postMessage({ requestId: m.requestId, text: m.text, taskId: null }, token());
		sent = r.ok ? r.message : { ...m, delivery: 'unsent', deliveryDetail: r.error };
	}

	function handOff() {
		const body = handoffBody(text, s);
		if (!body.trim() || unavailable) return;
		composing = false;
		void deliver({
			requestId: newRequestId(),
			text: body,
			taskId: null,
			submittedAt: new Date().toISOString(),
			delivery: 'sending',
			deliveryDetail: null,
			acknowledged: null,
			noteId: null,
			reply: null
		});
	}
</script>

{#if composing || tracked}
	<div class={className}>
		{#if composing}
			<div class="border-t p-4">
				<label for="handoff-{s.id}" class="text-sm font-medium"
					>Hand this session to Firstmate</label
				>
				<p class="mt-0.5 text-xs text-muted-foreground">
					Sent to Firstmate’s inbox like any Bridge message, with the session’s scratch directory so
					it can read the notes the session left there.
				</p>
				<Textarea
					id="handoff-{s.id}"
					bind:value={text}
					rows={5}
					class="mt-3 max-h-72 font-mono text-xs"
					disabled={!!unavailable}
				/>
				{#if unavailable}<p class="mt-2 text-xs text-danger">{unavailable}</p>{/if}
				<div class="mt-3 flex justify-end gap-2">
					<Button variant="ghost" size="sm" onclick={() => (composing = false)}>Cancel</Button>
					<Button size="sm" onclick={handOff} disabled={!!unavailable || !text.trim()}
						><Send />Send to Firstmate</Button
					>
				</div>
			</div>
		{/if}

		{#if tracked}
			<p
				class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-3 text-xs text-muted-foreground"
			>
				<span>Handed to Firstmate {clock(tracked.submittedAt)}</span>
				<DeliveryState message={tracked} onRetry={() => sent && void deliver(sent)} />
				<a href="/bridge" class="ml-auto hover:text-foreground hover:underline"
					>See it on the Bridge</a
				>
			</p>
			{#if tracked.deliveryDetail && tracked.delivery !== 'delivered'}
				<p class="px-4 pb-3 text-xs text-muted-foreground">{tracked.deliveryDetail}</p>
			{/if}
		{/if}
	</div>
{/if}
