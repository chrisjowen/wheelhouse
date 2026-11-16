<script lang="ts">
	import { AudioLines, FileText, LoaderCircle, Send } from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { liveCall, type CrewReply, type LiveEntry } from '$lib/client/livecall.svelte';
	import { parseReply } from '$lib/live/reply';
	import type { TaskSummary } from '$lib/types';
	import LiveVisual from './LiveVisual.svelte';

	/**
	 * Live mode in the chat's own feed: the captain's words as their usual
	 * bubbles (with a way to fix what was misheard), the discussion crew as its
	 * own participant (its reply lit as it is spoken, and what it puts up drawn
	 * under it), notices, and at the end the Captain's briefing, which the
	 * captain sends to Firstmate from here.
	 */
	let {
		tasks,
		token,
		now,
		projectName,
		onsendbrief
	}: {
		tasks: TaskSummary[];
		token: string;
		now: number;
		projectName: (id: string | null) => string | null;
		/** Send the briefing to Firstmate as the captain's message; false when it cannot be sent. */
		onsendbrief: (text: string) => Promise<boolean>;
	} = $props();

	const time = (iso: string) =>
		new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	let fixing = $state<string | null>(null);
	let fixText = $state('');

	/** The reply's parts, with each prose part's place in the spoken text. */
	function parts(r: CrewReply) {
		let off = 0;
		let block = 0;
		return parseReply(r.text).map((p) => {
			if (p.type === 'prose') {
				const start = off;
				off += p.text.length + 1;
				return { ...p, start };
			}
			return { ...p, start: -1, index: p.closed ? block++ : -1 };
		});
	}
	const speaking = (r: CrewReply) => liveCall.state === 'speaking' && r.spoken < r.queued;

	function briefText(e: Extract<LiveEntry, { kind: 'brief' }>) {
		return `Captain’s briefing from a Live mode discussion (${e.minutes} min):\n\n${e.briefing ?? ''}`;
	}
	let sending = $state<string | null>(null);
	async function send(e: Extract<LiveEntry, { kind: 'brief' }>) {
		sending = e.id;
		if (await onsendbrief(briefText(e))) liveCall.markSent(e);
		sending = null;
	}
</script>

{#each liveCall.entries as e (e.id)}
	{#if e.kind === 'notice'}
		<p
			class="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"
			data-live-notice
		>
			<AudioLines class="size-3.5 shrink-0 text-sea" aria-hidden="true" />{e.text}
		</p>
	{:else if e.kind === 'captain'}
		<article
			class="msg msg-captain"
			aria-label="You, {time(e.at)}"
			data-live-captain={e.pending ? 'pending' : 'sent'}
		>
			<span class="captain-avatar">C</span>
			<div class="min-w-0 flex-1">
				<header class="msg-head">
					<span class="msg-name">You</span><time datetime={e.at}>{time(e.at)}</time>
					<span
						class="rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
						>LIVE</span
					>
					{#if e.how === 'typed' || e.how === 'fixed'}<span
							class="rounded border px-1 font-mono text-[0.65rem] tracking-wider"
							>{e.how.toUpperCase()}</span
						>{/if}
				</header>
				{#if fixing === e.id}
					<form
						class="flex w-full max-w-[min(85%,62ch)] gap-2"
						onsubmit={(ev) => {
							ev.preventDefault();
							if (e.kind === 'captain') liveCall.fix(e, fixText);
							fixing = null;
						}}
					>
						<input
							class="min-w-0 flex-1 rounded-md border border-sea bg-card px-3 py-1.5 text-sm"
							bind:value={fixText}
							aria-label="What you said"
						/>
						<button class="cursor-pointer rounded-md bg-sea px-3 text-sm font-medium text-on-accent"
							>Send fix</button
						>
					</form>
				{:else}
					<div class="bubble bubble-captain {e.pending ? 'border-dashed opacity-60' : ''}">
						{e.text}
					</div>
					{#if !e.pending && e.how !== 'typed'}
						<button
							class="mt-1 cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
							onclick={() => {
								fixing = e.id;
								fixText = e.kind === 'captain' ? e.text : '';
							}}>Fix what I said</button
						>
					{/if}
				{/if}
			</div>
		</article>
	{:else}
		<article class="msg msg-firstmate" aria-label="Discussion crew, {time(e.at)}" data-live-crew>
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-brass bg-sea/10 text-sea"
			>
				<AudioLines class="size-4" aria-hidden="true" />
			</span>
			<div class="flex min-w-0 flex-1 flex-col items-start gap-2">
				<header class="msg-head">
					<span class="msg-name">Discussion crew</span><time datetime={e.at}>{time(e.at)}</time>
					<span
						class="rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
						>LIVE</span
					>
				</header>
				{#if e.kind === 'writing'}
					<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
						<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Writing the Captain’s
						briefing for Firstmate…
					</p>
				{:else if e.kind === 'brief'}
					{#if e.briefing}
						<div
							class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border border-sea/45 bg-card"
							data-live-brief
						>
							<div
								class="flex items-center gap-2 border-b border-sea/25 bg-sea/10 px-4 py-2.5 text-sm font-semibold text-sea"
							>
								<FileText class="size-4" aria-hidden="true" />Captain’s briefing · for Firstmate
								<span class="ml-auto font-mono text-[0.7rem] font-normal">{e.minutes} min</span>
							</div>
							<div class="chat-md bg-paper px-5 py-4 font-reading text-ink">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
								{@html markdown(e.briefing)}
							</div>
							<div class="flex items-center gap-3 border-t border-hair px-4 py-2.5">
								<span class="text-xs text-muted-foreground"
									>{e.sent
										? 'Sent to Firstmate.'
										: 'Read it over, then send it to Firstmate as your message.'}</span
								>
								<button
									class="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-md bg-sea px-3 py-1.5 text-sm font-medium text-on-accent disabled:cursor-default disabled:opacity-50"
									disabled={e.sent || sending === e.id}
									onclick={() => e.kind === 'brief' && send(e)}
									><Send class="size-3.5" aria-hidden="true" />{e.sent
										? 'Sent'
										: 'Send to Firstmate'}</button
								>
							</div>
						</div>
					{:else}
						<div class="bubble bubble-firstmate">
							Nothing was discussed, so there is no briefing to hand over.
						</div>
					{/if}
					<p class="text-xs text-muted-foreground" data-live-catchup>
						{#if e.catchUp.length}While you talked:
							{#each e.catchUp as c, i (i)}{i ? ' · ' : ''}<b class="font-medium text-foreground"
									>{c.title || c.task}</b
								>
								{c.text}{/each}
						{:else}While you talked ({e.minutes} min), nothing changed state. Firstmate is still on watch:
							{e.fleet.live} under way, {e.fleet.decisions} decision{e.fleet.decisions === 1
								? ''
								: 's'} open.{/if}
					</p>
				{:else if e.kind === 'crew'}
					{#each parts(e) as p, i (i)}
						{#if p.type === 'prose'}
							{@const shown = e.interrupted
								? p.text.slice(0, Math.max(0, e.spoken - p.start))
								: p.text}
							{#if shown.trim()}
								{#if speaking(e) || e.streaming}
									{@const lit = Math.max(0, Math.min(shown.length, e.spoken - p.start))}
									<div class="bubble bubble-firstmate border-sea/30">
										{shown.slice(0, lit)}<span class="text-muted-foreground"
											>{shown.slice(lit)}</span
										>
									</div>
								{:else}
									<div class="chat-md bubble bubble-firstmate border-sea/30">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(shown.trim())}
									</div>
								{/if}
							{/if}
						{:else if 'index' in p && p.index >= 0 && e.visuals[p.index]}
							<LiveVisual visual={e.visuals[p.index]} {tasks} {token} {now} {projectName} />
						{:else if !e.interrupted}
							<p class="flex items-center gap-2 text-sm text-muted-foreground">
								<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Putting something up…
							</p>
						{/if}
					{/each}
					{#if !e.text && e.streaming}
						<div class="flex gap-1 py-2" role="status" aria-label="The discussion crew is thinking">
							<span class="size-1.5 animate-bounce rounded-full bg-sea [animation-delay:-0.3s]"
							></span>
							<span class="size-1.5 animate-bounce rounded-full bg-sea [animation-delay:-0.15s]"
							></span>
							<span class="size-1.5 animate-bounce rounded-full bg-sea"></span>
						</div>
					{/if}
					{#if e.interrupted}<span class="worked-for w-full">Interrupted</span>{/if}
				{/if}
			</div>
		</article>
	{/if}
{/each}
