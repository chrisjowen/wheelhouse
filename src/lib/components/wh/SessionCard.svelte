<script lang="ts">
	import { page } from '$app/state';
	import { currentHealth, currentMessages, live } from '$lib/client/live.svelte';
	import { postMessage } from '$lib/client/messages';
	import { openSession } from '$lib/client/sessions';
	import { newRequestId, type LocalMessage } from '$lib/bridge';
	import { ago, clock } from '$lib/format';
	import { handoffBody, handoffPrefill, sessionLabel } from '$lib/sessions';
	import type { SessionOutput, SessionSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import DeliveryState from './DeliveryState.svelte';
	import { ChevronRight, LoaderCircle, Send, SquareTerminal } from '@lucide/svelte';

	let { session: s }: { session: SessionSummary } = $props();

	const token = () => page.data.sessionToken as string;

	// Re-attach the captain's terminal.
	let opening = $state(false);
	let openError = $state<string | null>(null);
	async function reopen() {
		opening = true;
		openError = null;
		const r = await openSession(s.id, token());
		opening = false;
		if (!r.ok) openError = r.error;
	}

	// Read-only preview, sampled only while it is open.
	const LINES = 40;
	const POLL_MS = 3_000;
	let previewing = $state(false);
	let out = $state<SessionOutput | null>(null);
	let previewError = $state<string | null>(null);
	$effect(() => {
		if (!previewing) return;
		const id = s.id;
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			try {
				const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/preview?lines=${LINES}`);
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				out = await r.json();
				previewError = null;
			} catch (e) {
				previewError = `Could not reach the Wheelhouse server (${(e as Error).message}).`;
			}
			if (!stop) timer = setTimeout(load, POLL_MS);
		};
		void load();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});

	// Hand to Firstmate: an ordinary Bridge message with a stable request id.
	let composing = $state(false);
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

	function compose() {
		composing = !composing;
		if (composing && !text) text = handoffPrefill(s);
	}

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

	const status = $derived(
		s.state === 'alive'
			? { dot: 'bg-success', label: 'Running' }
			: s.state === 'ended'
				? { dot: 'bg-muted-foreground', label: 'Ended' }
				: { dot: 'bg-warning', label: 'Unknown' }
	);
</script>

<li class="rounded-xl border">
	<div class="flex flex-wrap items-start gap-x-6 gap-y-3 p-4">
		<div class="min-w-0 flex-1">
			<p class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span class="font-medium">{sessionLabel(s)}</span>
				<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
					<span class="size-2 rounded-full {status.dot}" aria-hidden="true"></span>{status.label}
				</span>
				<time datetime={s.createdAt} title={s.createdAt} class="text-xs text-muted-foreground"
					>started {ago(s.createdAt, live.now)}</time
				>
			</p>
			{#if s.prompt}
				<p class="mt-1 line-clamp-2 text-sm break-words text-muted-foreground">{s.prompt}</p>
			{/if}
			<p class="mt-2 truncate font-mono text-xs text-muted-foreground" title={s.dir}>{s.dir}</p>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={reopen}
				disabled={opening || s.state === 'ended'}
				title={s.state === 'ended' ? 'This session has ended' : 'Open it in your terminal'}
			>
				{#if opening}<LoaderCircle class="animate-spin" />{:else}<SquareTerminal />{/if}Open
			</Button>
			<Button variant="outline" size="sm" onclick={compose} aria-expanded={composing}
				><Send />Hand to Firstmate</Button
			>
		</div>
	</div>

	{#if openError}
		<p class="px-4 pb-3 text-xs text-danger" role="alert">
			{openError} To attach yourself, run <code class="font-mono">{s.attach}</code>.
		</p>
	{/if}

	{#if composing}
		<div class="border-t p-4">
			<label for="handoff-{s.id}" class="text-sm font-medium">Hand this session to Firstmate</label>
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

	<details class="group border-t" bind:open={previewing}>
		<summary
			class="flex list-none items-center gap-2 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight
				class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
				aria-hidden="true"
			/>
			<span>Preview</span>
			<span class="text-xs text-muted-foreground">read-only, last {LINES} lines</span>
		</summary>
		<div class="px-4 pb-4">
			{#if previewError}
				<p class="text-sm text-warning">{previewError}</p>
			{:else if !out}
				<p class="text-sm text-muted-foreground">Reading the session…</p>
			{:else if !out.available}
				<p class="text-sm text-muted-foreground">{out.reason}</p>
			{:else}
				<pre
					class="max-h-96 overflow-auto rounded-lg bg-terminal p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-terminal-foreground">{out
						.lines.length
						? out.lines.join('\n')
						: '(the screen is empty)'}</pre>
				<p class="mt-2 text-xs text-muted-foreground">
					Captured {clock(out.capturedAt)}, refreshed every {POLL_MS / 1000} s while open. Type in your
					terminal; Wheelhouse cannot send anything to the session.
				</p>
			{/if}
		</div>
	</details>
</li>
