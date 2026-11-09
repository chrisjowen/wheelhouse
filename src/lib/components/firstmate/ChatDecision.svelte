<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import {
		ArrowUp,
		CircleCheck,
		CircleX,
		Compass,
		ExternalLink,
		Hand,
		LoaderCircle,
		MessagesSquare,
		RefreshCw,
		RotateCw,
		X
	} from '@lucide/svelte';
	import type { ChatDecision } from '$lib/chat/decisions';
	import {
		byQuestion,
		canDiscuss,
		refinedForm,
		type Thread,
		type ThreadMsg
	} from '$lib/chat/discuss';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel, type Pending } from '$lib/chat/outbox';
	import { inbox } from '$lib/client/inbox.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import { answerWith } from '$lib/client/agree';
	import { cardForm, decidedLabel, formIn, withoutForm } from '$lib/decisionform';
	import { cardTaskHref, choiceLabel, closable, escalated, type InboxKind, type InboxView } from '$lib/inbox';
	import { ago } from '$lib/format';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import DecisionEvidence from '$lib/components/wh/inbox/DecisionEvidence.svelte';
	import Avatar from './Avatar.svelte';
	import DecisionForm from './DecisionForm.svelte';

	/**
	 * A decision in the chat, at the time it was asked. Open, it says what is
	 * being decided, Firstmate's recommendation and what it rests on, and is
	 * answered with the form that fits it (lib/decisionform.ts): one tap for
	 * two plain answers, pick then Decide for options, or a written answer.
	 * Answered, here or anywhere else in Wheelhouse, it folds to "You decided
	 * X". The discussion under it is for talking it through with Firstmate
	 * before (or after) answering: each question goes to Firstmate as a chat
	 * message naming the task and decision (lib/chat/discuss.ts), its reply
	 * shows here rather than in the conversation, and a reply that ends with a
	 * decision-form block replaces the form. Asking answers nothing. `focus`
	 * (the Decisions page's Chat about this) brings it into view with the
	 * discussion open; onFocused says it has.
	 */
	let {
		decision,
		project = null,
		now,
		thread = null,
		pending = [],
		canAsk,
		focus = false,
		onFocused,
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
		/** Bring it into view with its discussion open (once; then onFocused). */
		focus?: boolean;
		onFocused?: () => void;
		/** Sends a question about it; false when it was not sent, and the draft stays. */
		onAsk: (text: string) => boolean;
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
	const SUGGEST = ['Why that one?', 'What’s the risk?', 'What are the other options?'];

	const head = $derived(decision.head);
	const answer = $derived(decision.answer);
	const count = $derived((thread?.messages.length ?? 0) + pending.length);
	/** A task id or key with spaces or brackets cannot be named in a message to Firstmate. */
	const referable = $derived(canDiscuss(head));
	const askable = $derived(canAsk && referable);
	/** Opened or closed by the captain; until then, open while an unanswered question is being discussed. */
	let opened = $state<boolean | null>(null);
	const open = $derived(opened ?? (!answer && count > 0));
	let draft = $state('');
	let input = $state<HTMLTextAreaElement | null>(null);
	let root = $state<HTMLElement | null>(null);
	let expanded = $state(false);

	const card = $derived(decision.card);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const canAnswer = $derived(
		inbox.view(page.data.inbox as InboxView | undefined)?.canAnswer ?? false
	);
	// Firstmate's latest form in the discussion of this question replaces the one read from it.
	const refined = $derived(refinedForm(thread, head.question));
	// A card id asked again with a new question: the talk about earlier ones folds away above it.
	const parts = $derived(byQuestion(thread, head.question));
	const form = $derived(refined?.form ?? (card ? cardForm(card) : null));
	// A new form starts over; the same form redrawn (a fresh inbox read) keeps the captain's picks.
	const formKey = $derived(refined?.id ?? `card:${card?.question ?? ''}`);
	// Without the card any more, the kind's own answers name it (Merge, Go ahead…).
	const decided = $derived(
		answer
			? decidedLabel(
					cardForm(card ?? { kind: head.kind, choices: null, recommendation: null }),
					answer
				)
			: ''
	);
	// Review opens the PR in a plugin's review tab while one is on for the project, else on GitHub.
	const prLink = $derived(
		card?.evidence.pr ? pullRequests.review(card.projectId, card.evidence.pr) : null
	);

	// Chat about this: into view, with the discussion open and ready to type in.
	$effect(() => {
		if (!focus) return;
		opened = true;
		void tick().then(() => {
			// Only the conversation scrolls: scrollIntoView would move the fixed page around it too.
			const list = root?.closest<HTMLElement>('.overflow-y-auto');
			if (root && list) {
				const top = root.getBoundingClientRect().top - list.getBoundingClientRect().top;
				// At once: a smooth scroll loses to the chat following its latest message meanwhile.
				list.scrollTo({ top: list.scrollTop + top - 24 });
			}
			input?.focus({ preventScroll: true });
			onFocused?.();
		});
	});

	const time = (at: string | null) =>
		at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
	const delivered = $derived(
		!answer
			? ''
			: answer.delivery === 'sending'
				? 'Sending to Firstmate…'
				: answer.delivery === 'delivered'
					? 'Firstmate has it and passes it on'
					: answer.delivery === 'failed'
						? 'Firstmate did not take it'
						: answer.delivery === 'uncertain'
							? 'Sent; Firstmate has not confirmed it yet'
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
		if (!t || !askable) return;
		if (onAsk(t)) draft = '';
	}
</script>

{#snippet message(m: ThreadMsg, current: boolean)}
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
					{@html markdown(withoutForm(m.text), { docLinks: true })}
				</div>
				{#if current && formIn(m.text)}<p class="mt-0.5 text-xs text-muted-foreground">
						Firstmate updated the options above.
					</p>{/if}
			{:else}
				<p class="mt-0.5 text-sm leading-relaxed whitespace-pre-line">{m.text}</p>
			{/if}
		</div>
	</li>
{/snippet}

{#snippet discuss()}
	<button
		class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 {open
			? 'bg-accent text-foreground'
			: ''}"
		aria-expanded={open}
		disabled={!referable || (!canAsk && !count)}
		title={!referable
			? 'This question’s task or key has spaces or brackets, so Firstmate cannot be asked about it here'
			: canAsk
				? 'Ask Firstmate about this question; it answers nothing'
				: 'Firstmate cannot be messaged from here right now'}
		onclick={toggle}
		data-discuss
		><MessagesSquare class="size-3.5" aria-hidden="true" />Discuss{#if count}<span
				class="text-xs tabular-nums">· {count}</span
			>{/if}</button
	>
{/snippet}

<div
	bind:this={root}
	class="flex w-full max-w-[min(100%,40rem)] scroll-mt-24 flex-col"
	data-chat-decision={decision.id}
>
	{#if card && form && !answer}
		{@const mine = escalated(card)}
		<article
			class="rounded-lg border border-l-[3px] bg-card px-4 pt-3.5 pb-3 sm:px-5 {mine
				? 'border-l-sea'
				: 'border-l-brass'}"
			data-open-decision={card.owner}
		>
			<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
				{#if project}
					<span
						class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>{project}</span
					>
				{/if}
				<span
					class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {mine
						? 'bg-sea/10 text-sea'
						: 'bg-muted text-foreground/80'}"
					><Hand class="size-3" aria-hidden="true" />{KIND[card.kind]}</span
				>
				<span class="text-xs text-muted-foreground"
					>{mine ? 'Waiting on you' : 'Firstmate is handling it; yours to take over'}</span
				>
				{#if card.askedAt}
					<span class="ml-auto text-xs text-muted-foreground tabular-nums"
						>{ago(card.askedAt, now)}</span
					>
				{/if}
			</header>
			<h3 class="mt-2 font-sans text-base leading-snug font-medium sm:text-[1.05rem]">
				<LinkedText text={head.question} />
			</h3>
			<a
				href={cardTaskHref(head)}
				class="mt-0.5 block text-xs text-muted-foreground hover:text-foreground hover:underline"
				>{head.taskTitle}</a
			>
			{#if card.recommendation}
				<p class="mt-2.5 border-l-2 border-brass pl-2.5 text-sm leading-snug">
					<span class="font-medium">Firstmate recommends</span><span class="text-muted-foreground">
						· <LinkedText text={card.recommendation.text} /></span
					>
				</p>
			{/if}
			<DecisionEvidence {card} {expanded} onToggle={() => (expanded = !expanded)} />
			{#if form.from === 'firstmate'}
				<p class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-refined>
					<RefreshCw class="size-3.5" aria-hidden="true" />Firstmate changed the options after your
					question.
				</p>
			{/if}
			{#key formKey}
				<DecisionForm
					{form}
					name={decision.id}
					{canAnswer}
					onAnswer={(a, note) => answerWith(card, a, note, token)}
				/>
			{/key}
			{#if card.sent?.delivery === 'failed' && !inbox.errors[card.id]}
				<p class="mt-2 text-sm text-danger" role="alert">
					Not delivered to Firstmate: {card.sent.picks ?? choiceLabel(card, card.sent.choice)}. {card
						.sent.detail ?? 'Try again.'}
				</p>
			{/if}
			{#if inbox.errors[card.id]}
				<p class="mt-2 text-sm text-danger" role="alert">{inbox.errors[card.id]}</p>
			{/if}
			<div class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-hair/70 pt-2">
				{@render discuss()}
				{#if prLink}
					<a
						class="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-9"
						href={prLink.href}
						target={prLink.external ? '_blank' : undefined}
						rel={prLink.external ? 'noreferrer' : undefined}
						title="Open the pull request to review it; this answers nothing"
						data-review-pr
						><Compass class="size-3.5" aria-hidden="true" />Review{#if prLink.external}<ExternalLink
								class="size-3.5"
								aria-hidden="true"
							/>{/if}</a
					>
				{/if}
				{#if closable(card)}
					<button
						class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
						disabled={!canAnswer}
						title="No answer needed: Firstmate records it closed."
						onclick={() => inbox.answer(card, 'close', null, token)}
						><X class="size-3.5" aria-hidden="true" />Close</button
					>
				{/if}
			</div>
		</article>
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
				href={cardTaskHref(head)}
				class="block text-xs text-muted-foreground hover:text-foreground hover:underline"
				>{head.taskTitle}</a
			>
			<p class="mt-1.5 text-sm leading-snug" data-decided>
				{#if answer.choice === 'close'}You closed it without an answer{:else}You decided
					<span class="font-semibold">{decided}</span>{/if}
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
					{#each parts.earlier as e, i (i)}
						<li>
							<details data-earlier>
								<summary class="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
									>Earlier question: “{e.question}”</summary
								>
								<ul class="mt-2 flex flex-col gap-3 border-b border-hair/70 pb-3">
									{#each e.messages as m (m.id)}{@render message(m, false)}{/each}
								</ul>
							</details>
						</li>
					{/each}
					{#each parts.current as m (m.id)}{@render message(m, true)}{/each}
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
			{#if askable}
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
