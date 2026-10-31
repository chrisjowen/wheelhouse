<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowUp,
		CircleCheck,
		CircleX,
		LoaderCircle,
		MessagesSquare,
		RotateCw
	} from '@lucide/svelte';
	import type { ChatDecision } from '$lib/chat/decisions';
	import type { Thread } from '$lib/chat/discuss';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel, type Pending } from '$lib/chat/outbox';
	import type { InboxKind } from '$lib/inbox';
	import { ago } from '$lib/format';
	import OpenDecision from '$lib/components/wh/inbox/OpenDecision.svelte';
	import Avatar from './Avatar.svelte';

	/**
	 * A decision in the chat, at the time it was asked. Open, it is the
	 * Decisions page's own decision box (OpenDecision: the same picks, note and
	 * answers, sent the same way), with Discuss added to its answers. Answered,
	 * here or anywhere else in Wheelhouse, it folds to the answer. Discuss opens
	 * a thread under the card for asking Firstmate about the question before (or
	 * after) answering: each question goes to Firstmate as a chat message naming
	 * the task and decision (lib/chat/discuss.ts), and its reply shows here
	 * rather than in the conversation. Asking answers nothing.
	 */
	let {
		decision,
		project = null,
		now,
		thread = null,
		pending = [],
		canAsk,
		onAsk,
		onRetry,
		onDismiss
	}: {
		decision: ChatDecision;
		project?: string | null;
		now: number;
		thread?: Thread | null;
		/** The captain's questions about it still on their way. */
		pending?: { pending: Pending; body: string }[];
		/** Firstmate can be messaged; without it Discuss is off. */
		canAsk: boolean;
		onAsk: (text: string) => void;
		onRetry: (id: string) => void;
		onDismiss: (id: string) => void;
	} = $props();

	const KIND: Record<InboxKind, string> = {
		review: 'Review question',
		decision: 'Decision',
		blocked: 'Stuck',
		hold: 'Your call',
		merge: 'Merge call',
		preview: 'Preview sign-off'
	};
	const SUGGEST = ['What’s the risk?', 'What would you pick?', 'What if I leave it?'];

	const head = $derived(decision.head);
	const answer = $derived(decision.answer);
	const count = $derived((thread?.messages.length ?? 0) + pending.length);
	/** Opened or closed by the captain; until then, open while an unanswered question is being discussed. */
	let opened = $state<boolean | null>(null);
	const open = $derived(opened ?? (!answer && count > 0));
	let draft = $state('');
	let input = $state<HTMLTextAreaElement | null>(null);

	const time = (at: string | null) =>
		at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
	const delivered = $derived(
		!answer
			? ''
			: answer.delivery === 'sending'
				? 'Sending to Firstmate…'
				: answer.delivery === 'delivered'
					? 'Firstmate has your answer'
					: 'Sent to Firstmate'
	);

	async function toggle() {
		opened = !open;
		if (opened) {
			await tick();
			input?.focus();
		}
	}
	function send(text = draft) {
		const t = text.trim();
		if (!t || !canAsk) return;
		draft = '';
		onAsk(t);
	}
</script>

{#snippet discuss()}
	<button
		class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 {open
			? 'bg-accent text-foreground'
			: ''}"
		aria-expanded={open}
		disabled={!canAsk && !count}
		title={canAsk
			? 'Ask Firstmate about this question; it answers nothing'
			: 'Firstmate cannot be messaged from here right now'}
		onclick={toggle}
		data-discuss
		><MessagesSquare class="size-3.5" aria-hidden="true" />Discuss{#if count}<span
				class="text-xs tabular-nums">· {count}</span
			>{/if}</button
	>
{/snippet}

<div class="flex w-full max-w-[min(100%,40rem)] flex-col" data-chat-decision={decision.id}>
	{#if decision.card && !answer}
		<OpenDecision card={decision.card} {project} {now} extra={discuss} />
	{:else if answer}
		<article
			class="rounded-lg border border-l-[3px] border-l-success/70 bg-card px-4 pt-3 pb-2 sm:px-5"
			data-answered
		>
			<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
				{#if project}
					<span
						class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>{project}</span
					>
				{/if}
				<span
					class="rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-foreground/80"
					>{KIND[head.kind]}</span
				>
				<span class="flex items-center gap-1 text-xs text-success"
					><CircleCheck class="size-3.5" aria-hidden="true" />Answered</span
				>
				{#if answer.at}
					<span class="ml-auto text-xs text-muted-foreground tabular-nums"
						>{ago(answer.at, now)}</span
					>
				{/if}
			</header>
			<p class="mt-1.5 text-sm leading-snug text-muted-foreground">{head.question}</p>
			<a
				href="/tasks/{encodeURIComponent(head.taskId)}"
				class="block text-xs text-muted-foreground hover:text-foreground hover:underline"
				>{head.taskTitle}</a
			>
			<p class="mt-1.5 text-sm leading-snug">
				{#if answer.choice === 'close'}You closed it without an answer{:else if answer.picks}You
					picked <span class="font-semibold">{answer.picks}</span>{:else}You answered
					<span class="font-semibold">{answer.label}</span>{/if}
			</p>
			{#if answer.note}
				<p
					class="mt-1 border-l-2 border-hair pl-2.5 text-sm whitespace-pre-line text-muted-foreground"
				>
					{answer.note}
				</p>
			{/if}
			<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span role="status" class="inline-flex items-center gap-1"
					>{#if answer.delivery === 'sending'}<LoaderCircle
							class="size-3 animate-spin"
							aria-hidden="true"
						/>{/if}{delivered}{answer.at ? ` · ${time(answer.at)}` : ''}</span
				>
				<span class="ml-auto">{@render discuss()}</span>
			</div>
		</article>
	{/if}

	{#if open}
		<!-- The thread hangs off the card, so questions about it never crowd the conversation. -->
		<div
			class="mt-1 ml-4 border-l-2 border-hair pt-2 pl-4"
			role="region"
			aria-label="Discussion with Firstmate about this question"
			data-discussion
		>
			{#if thread?.messages.length || pending.length}
				<ul class="flex flex-col gap-3 pb-1">
					{#each thread?.messages ?? [] as m (m.id)}
						<li class="flex gap-2.5">
							{#if m.who === 'firstmate'}<Avatar class="mt-0.5 size-5" />{:else}<span
									class="captain-avatar mt-0.5 !size-5 !text-[0.7rem]">C</span
								>{/if}
							<div class="min-w-0 flex-1">
								<p class="text-xs text-muted-foreground">
									<span class="font-medium text-foreground"
										>{m.who === 'firstmate' ? 'Firstmate' : 'You'}</span
									>{#if m.at}
										· {time(m.at)}{/if}
								</p>
								{#if m.who === 'firstmate'}
									<div class="chat-md mt-0.5 text-sm">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(m.text, { docLinks: true })}
									</div>
								{:else}
									<p class="mt-0.5 text-sm leading-relaxed whitespace-pre-line">{m.text}</p>
								{/if}
							</div>
						</li>
					{/each}
					{#each pending as p (p.pending.id)}
						<li class="flex gap-2.5" data-pending={p.pending.state}>
							<span class="captain-avatar mt-0.5 !size-5 !text-[0.7rem]">C</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm leading-relaxed whitespace-pre-line opacity-60">{p.body}</p>
								<p
									class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs {p.pending.state ===
									'failed'
										? 'text-danger'
										: 'text-muted-foreground'}"
									role="status"
								>
									{#if p.pending.state === 'failed'}
										<CircleX class="size-3.5" aria-hidden="true" />{pendingLabel(p.pending)}
										<button
											class="ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
											onclick={() => onRetry(p.pending.id)}
											><RotateCw class="size-3" aria-hidden="true" />Retry</button
										>
										<button
											class="cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
											onclick={() => onDismiss(p.pending.id)}>Discard</button
										>
									{:else}
										<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />{pendingLabel(
											p.pending
										)}
									{/if}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-muted-foreground">
					Ask Firstmate anything about this question. Asking answers nothing; the answer stays yours
					to give.
				</p>
			{/if}
			{#if thread?.answering}
				<div class="flex gap-1 py-2 pl-7" role="status" aria-label="Firstmate is answering">
					<span
						class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]"
					></span>
					<span
						class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]"
					></span>
					<span class="size-1.5 animate-bounce rounded-full bg-muted-foreground"></span>
				</div>
			{/if}
			{#if canAsk}
				{#if !count && !answer}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each SUGGEST as s (s)}
							<button
								class="cursor-pointer rounded-full border border-hair bg-card px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
								onclick={() => send(s)}>{s}</button
							>
						{/each}
					</div>
				{/if}
				<form
					class="mt-2 flex items-end gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring"
					onsubmit={(e) => {
						e.preventDefault();
						send();
					}}
				>
					<textarea
						bind:this={input}
						bind:value={draft}
						rows="1"
						maxlength="2000"
						placeholder="Ask about this question…"
						aria-label="Ask Firstmate about this question"
						class="field-sizing-content max-h-32 min-h-7 flex-1 resize-none bg-transparent py-0.5 text-sm placeholder:text-muted-foreground focus:outline-none"
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
								e.preventDefault();
								send();
							}
						}}></textarea>
					<button
						type="submit"
						class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-sea text-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-950"
						aria-label="Ask"
						disabled={!draft.trim()}><ArrowUp class="size-4" /></button
					>
				</form>
			{/if}
		</div>
	{/if}
</div>
