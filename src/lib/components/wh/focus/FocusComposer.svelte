<script lang="ts">
	/**
	 * Focus mode's box for telling Firstmate something: what to work on, typed
	 * in a large rounded box, with + to attach files (uploaded as the chat's
	 * are, and named in the message), the mic to dictate into the box (as the
	 * chat's does, never sending for you), **Live** to talk it through out loud
	 * in a Live call (when Live mode is on; it opens in the full app's chat),
	 * and a round send button. Above it, the
	 * latest exchange in a line (no chat log). `draft` is bindable, so the
	 * quick starts can begin a message.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ArrowUp, AudioLines, Plus, X } from '@lucide/svelte';
	import { fieldTarget } from '$lib/voice/dictation.svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import { calls } from '$lib/client/calls.svelte';
	import MicButton from '$lib/components/wh/MicButton.svelte';
	import { currentHealth } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { attachments } from '$lib/client/attach.svelte';
	import { expandAttachment } from '$lib/chat/attachments';

	let {
		draft = $bindable(''),
		big = false,
		placeholder = 'Describe a goal, task or issue…'
	}: { draft?: string; big?: boolean; placeholder?: string } = $props();

	let box = $state<HTMLTextAreaElement | null>(null);
	let files = $state<HTMLInputElement | null>(null);
	let error = $state<string | null>(null);
	let listening = $state(false);
	// Live mode (the `discussion` feature): a voice call, held in the full app's chat.
	const liveOn = $derived(
		(page.data.features as { discussion?: boolean } | undefined)?.discussion === true
	);
	function talkLive() {
		// Started on this click, so the call may use the microphone and speak.
		void liveCall.start(token);
		calls.setFocus(false);
		void goto('/');
	}

	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const session = $derived(firstmateChat.session);
	const via = $derived(
		session?.canSend
			? ('session' as const)
			: session?.state === 'external' && currentHealth()?.messaging.available
				? ('inbox' as const)
				: null
	);
	const sendable = $derived(
		!!via && !attachments.uploading && (!!draft.trim() || attachments.ready)
	);

	/** Put the cursor in the box, at the end of what is there. */
	export function focus() {
		box?.focus();
		const n = box?.value.length ?? 0;
		box?.setSelectionRange(n, n);
	}

	async function send(e?: Event) {
		e?.preventDefault();
		if (!sendable || !via) return;
		const words = draft.trim();
		const body = [words, ...attachments.take().map(expandAttachment)].filter(Boolean).join('\n');
		draft = '';
		error = null;
		const r = await firstmateChat.send(body, via, token, firstmateChat.working);
		if (!r.ok) {
			error = r.error;
			draft = words;
		}
	}

	const firstLine = (s: string) =>
		s
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/\[attached file [^\]]*\]/g, '')
			.replace(/[*_`#>]/g, '')
			.split('\n')
			.map((l) => l.trim())
			.find(Boolean) ?? '';
	// The latest exchange: the captain's last message and the first line of Firstmate's reply.
	const exchange = $derived.by(() => {
		const pending = firstmateChat.pending[firstmateChat.pending.length - 1];
		if (pending) return { you: firstLine(pending.text), firstmate: null, waiting: true };
		const items = firstmateChat.chat.items;
		const u = items.findLastIndex((i) => i.kind === 'user' && !i.command);
		if (u < 0) return null;
		const you = items[u];
		if (you.kind !== 'user') return null;
		const reply = items.slice(u + 1).find((i) => i.kind === 'turn' && i.trigger === 'captain');
		const text =
			reply?.kind === 'turn' ? reply.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])) : [];
		const last = text.length ? firstLine(text[text.length - 1]) : null;
		return { you: firstLine(you.text), firstmate: last, waiting: !last && firstmateChat.working };
	});
</script>

<div data-focus-composer>
	{#if exchange}
		<p class="mb-1.5 truncate px-1 text-xs text-muted-foreground" data-focus-exchange>
			You: <span class="font-medium text-foreground">{exchange.you}</span>
			{#if exchange.firstmate}· Firstmate: {exchange.firstmate}{:else if exchange.waiting}·
				Firstmate is on it…{/if}
		</p>
	{/if}
	<form
		class="rounded-2xl border bg-card px-4 pt-3 pb-2.5 shadow-sm focus-within:border-gold/60 dark:bg-card/70 dark:backdrop-blur"
		onsubmit={send}
	>
		<textarea
			bind:this={box}
			bind:value={draft}
			rows={big ? 2 : 1}
			class="block max-h-40 w-full resize-none bg-transparent text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground max-md:text-base"
			placeholder={via ? placeholder : 'Firstmate cannot take messages right now'}
			aria-label="Tell Firstmate"
			disabled={!via}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) void send(e);
			}}></textarea>
		{#if attachments.drafts.length}
			<ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Attached files">
				{#each attachments.drafts as d (d.id)}
					<li
						class="flex max-w-56 items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs {d.state ===
						'failed'
							? 'border-danger/50 text-danger'
							: 'text-muted-foreground'}"
						title={d.error ?? d.name}
					>
						<span class="truncate"
							>{d.name}{d.state === 'uploading' ? ` · ${Math.round(d.progress * 100)}%` : ''}</span
						>
						<button
							type="button"
							class="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-muted"
							aria-label="Remove {d.name}"
							onclick={() => attachments.remove(d.id)}><X class="size-3" /></button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="mt-1.5 flex items-center gap-2">
			<button
				type="button"
				class="grid size-8 cursor-pointer place-items-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:size-10"
				aria-label="Attach files"
				title="Attach files"
				disabled={!via}
				onclick={() => files?.click()}><Plus class="size-4" aria-hidden="true" /></button
			>
			<input
				bind:this={files}
				type="file"
				multiple
				class="hidden"
				onchange={(e) => {
					const picked = [...(e.currentTarget.files ?? [])];
					if (picked.length) attachments.add(picked, token);
					e.currentTarget.value = '';
				}}
			/>
			<span class="ml-auto"></span>
			{#if liveOn}
				<button
					type="button"
					class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:h-10"
					title="Talk it through out loud in a Live call, in the full app's chat"
					disabled={!via}
					onclick={talkLive}
					data-focus-live><AudioLines class="size-4" aria-hidden="true" />Live</button
				>
			{/if}
			<MicButton
				field={box}
				target={() => fieldTarget(box!)}
				bind:listening
				size="sm"
				disabled={!via}
			/>
			<button
				type="submit"
				class="grid size-9 cursor-pointer place-items-center rounded-full bg-gold text-background transition-opacity disabled:cursor-default disabled:opacity-35 max-md:size-10"
				disabled={!sendable}
				aria-label="Send"><ArrowUp class="size-4" aria-hidden="true" /></button
			>
		</div>
	</form>
	{#if error}<p class="mt-1 text-xs text-danger" role="alert">{error}</p>{/if}
</div>
