<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import {
		CircleCheck,
		CircleX,
		Compass,
		ExternalLink,
		Hand,
		LoaderCircle,
		MessageSquare,
		MessagesSquare,
		RefreshCw,
		RotateCw,
		Undo2,
		X
	} from '@lucide/svelte';
	import type { ChatDecision } from '$lib/chat/decisions';
	import { byQuestion, refinedForm, type Thread, type ThreadMsg } from '$lib/chat/discuss';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel, type Pending } from '$lib/chat/outbox';
	import { inbox } from '$lib/client/inbox.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import { answerWith } from '$lib/client/agree';
	import {
		cardForm,
		decidedLabel,
		formIn,
		withoutForm,
		type DecisionForm as Form
	} from '$lib/decisionform';
	import { chatAboutHref } from '$lib/handled';
	import {
		cardContext,
		cardTaskHref,
		choiceLabel,
		escalated,
		type InboxKind,
		type InboxView
	} from '$lib/inbox';
	import { ago } from '$lib/format';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import DecisionDetails from '$lib/components/wh/inbox/DecisionDetails.svelte';
	import DecisionLinks from '$lib/components/wh/inbox/DecisionLinks.svelte';
	import DismissPicker from '$lib/components/wh/inbox/DismissPicker.svelte';
	import Avatar from './Avatar.svelte';
	import DecisionForm from './DecisionForm.svelte';

	/**
	 * A decision in the chat: at the time it was asked, or where Firstmate
	 * asked it again with a decision-form (`asked`, that form's options).
	 * Open, it shows the same as on the Decisions page: a short question, its
	 * task and what it rests on, Firstmate's recommendation, and the form that
	 * fits it (lib/decisionform.ts), which always takes the captain's own words
	 * too (Other). Answered or dismissed, here or anywhere else in Wheelhouse,
	 * it folds to what was decided. Chat with Firstmate about this starts a
	 * message about it in the main chat and keeps it as followed up there;
	 * Dismiss closes it without an answer, with a reason. Talk about it from
	 * before is kept under it, folded (lib/chat/discuss.ts): a reply there
	 * that ends with a decision-form block still replaces the form. `focus`
	 * (On deck's Chat about this) brings it into view; onFocused says it has.
	 */
	let {
		decision,
		project = null,
		now,
		thread = null,
		pending = [],
		asked = null,
		focus = false,
		onFocused,
		onRetry,
		onDismiss
	}: {
		decision: ChatDecision;
		project?: string | null;
		now: number;
		thread?: Thread | null;
		/** The captain's questions about it still on their way. */
		pending?: { pending: Pending; body: string }[];
		/** The form Firstmate asked it with in the conversation, when it did. */
		asked?: Form | null;
		/** Bring it into view (once; then onFocused). */
		focus?: boolean;
		onFocused?: () => void;
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

	const head = $derived(decision.head);
	const answer = $derived(decision.answer);
	const count = $derived((thread?.messages.length ?? 0) + pending.length);
	/** The talk about it from before, opened by the captain; open while an unanswered one is still being talked about. */
	let opened = $state<boolean | null>(null);
	const open = $derived(count > 0 && (opened ?? (!answer && pending.length > 0)));
	let root = $state<HTMLElement | null>(null);
	let expanded = $state(false);
	let dismissing = $state(false);

	const card = $derived(decision.card);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const canAnswer = $derived(
		inbox.view(page.data.inbox as InboxView | undefined)?.canAnswer ?? false
	);
	// Firstmate's latest form in the talk about this question replaces the one read from it.
	const refined = $derived(refinedForm(thread, head.question));
	// A card id asked again with a new question: the talk about earlier ones folds away above it.
	const parts = $derived(byQuestion(thread, head.question));
	const plain = (s: string | null) =>
		(s ?? '')
			.replace(/[\s?.:]+$/, '')
			.trim()
			.toLowerCase();
	// The form, without its question when that is the heading already above it.
	const form = $derived.by(() => {
		const f = refined?.form ?? asked ?? (card ? cardForm(card) : null);
		return f && f.prompt && plain(f.prompt) === plain(head.question) ? { ...f, prompt: null } : f;
	});
	// A new form starts over; the same form redrawn (a fresh inbox read) keeps the captain's picks.
	const formKey = $derived(refined?.id ?? (asked ? 'asked' : `card:${card?.question ?? ''}`));
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
	const quiet =
		'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11 sm:min-h-9';

	// On deck's Chat about this: into view.
	$effect(() => {
		if (!focus) return;
		void tick().then(() => {
			// Only the conversation scrolls: scrollIntoView would move the fixed page around it too.
			const list = root?.closest<HTMLElement>('.overflow-y-auto');
			if (root && list) {
				const top = root.getBoundingClientRect().top - list.getBoundingClientRect().top;
				// At once: a smooth scroll loses to the chat following its latest message meanwhile.
				list.scrollTo({ top: list.scrollTop + top - 24 });
			}
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

{#snippet talk()}
	{#if count}
		<button
			class="{quiet} {open ? 'bg-accent text-foreground' : ''}"
			aria-expanded={open}
			title="What you and Firstmate said about it under this card before"
			onclick={() => (opened = !open)}
			data-discuss
			><MessagesSquare class="size-3.5" aria-hidden="true" />Earlier talk<span
				class="text-xs tabular-nums">· {count}</span
			></button
		>
	{/if}
{/snippet}

<div
	bind:this={root}
	class="flex w-full max-w-[min(100%,40rem)] scroll-mt-24 flex-col"
	data-chat-decision={decision.id}
>
	{#if card && form && !answer}
		{@const mine = escalated(card)}
		{@const following = !!card.following}
		<article
			class="rounded-lg border border-l-[3px] bg-card px-4 pt-3.5 pb-3 sm:px-5 {following
				? 'border-l-sea/50'
				: mine
					? 'border-l-sea'
					: 'border-l-brass'}"
			data-open-decision={card.owner}
			data-following={following || undefined}
		>
			<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
				{#if project}
					<span
						class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>{project}</span
					>
				{/if}
				{#if following}
					<span
						class="flex items-center gap-1 rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-sea"
						><MessagesSquare class="size-3" aria-hidden="true" />Following up</span
					>
				{:else}
					<span
						class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {mine
							? 'bg-sea/10 text-sea'
							: 'bg-muted text-foreground/80'}"
						><Hand class="size-3" aria-hidden="true" />{KIND[card.kind]}</span
					>
				{/if}
				<span class="text-xs text-muted-foreground"
					>{following
						? 'Following up with Firstmate separately'
						: mine
							? 'Waiting on you'
							: 'Firstmate is handling it; yours to take over'}</span
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
			{#if cardContext(card)}
				<p class="mt-0.5 line-clamp-3 text-sm leading-snug text-muted-foreground" data-context>
					<LinkedText text={cardContext(card) ?? ''} />
				</p>
			{/if}
			<p class="mt-0.5 text-xs text-muted-foreground">{head.taskTitle}</p>
			<DecisionLinks {card} />
			{#if card.recommendation}
				<p class="mt-2.5 border-l-2 border-brass pl-2.5 text-sm leading-snug">
					<span class="font-medium">Firstmate recommends</span><span class="text-muted-foreground">
						· <LinkedText text={card.recommendation.text} /></span
					>
				</p>
			{/if}
			{#if refined}
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
				<a
					href={chatAboutHref(card)}
					class={quiet}
					title="Start a message to Firstmate about this; it waits as following up meanwhile"
					onclick={() => {
						if (!following) void inbox.follow(card, true, token);
					}}
					data-chat-about
					><MessageSquare class="size-3.5" aria-hidden="true" />Chat with Firstmate about this</a
				>
				{#if following}
					<button
						class={quiet}
						title="It waits on you again, and counts as waiting"
						onclick={() => inbox.follow(card, false, token)}
						data-unfollow><Undo2 class="size-3.5" aria-hidden="true" />Back to waiting</button
					>
				{/if}
				{@render talk()}
				{#if prLink}
					<a
						class={quiet}
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
				<button
					class="{quiet} ml-auto"
					disabled={!canAnswer}
					aria-expanded={dismissing}
					title="No answer needed: Firstmate records it closed, with your reason"
					onclick={() => (dismissing = !dismissing)}
					data-dismiss><X class="size-3.5" aria-hidden="true" />Dismiss</button
				>
			</div>
			{#if dismissing}
				<DismissPicker
					name={decision.id}
					disabled={!canAnswer}
					onDismiss={(reason) => {
						dismissing = false;
						void inbox.answer(card, 'close', reason, token);
					}}
					onCancel={() => (dismissing = false)}
				/>
			{/if}
			<DecisionDetails {card} {expanded} onToggle={() => (expanded = !expanded)} />
		</article>
	{:else if answer}
		{@const closed = answer.choice === 'close'}
		<article
			class="rounded-lg border border-l-[3px] bg-card px-4 pt-3 pb-2 sm:px-5 {closed
				? 'border-l-hair'
				: 'border-l-success/70'}"
			data-answered={closed ? 'dismissed' : 'answered'}
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
				{#if closed}
					<span class="flex items-center gap-1 text-xs text-muted-foreground"
						><CircleX class="size-3.5" aria-hidden="true" />Dismissed</span
					>
				{:else}
					<span class="flex items-center gap-1 text-xs text-success"
						><CircleCheck class="size-3.5" aria-hidden="true" />Answered</span
					>
				{/if}
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
				{#if closed}You dismissed it without an answer{:else}You decided
					<span class="font-semibold">{decided}</span>{/if}
			</p>
			{#if answer.note}
				<p
					class="mt-1 border-l-2 border-hair pl-2.5 text-sm whitespace-pre-line text-muted-foreground"
				>
					{closed ? `Why: ${answer.note}` : answer.note}
				</p>
			{/if}
			<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span role="status" class="inline-flex items-center gap-1"
					>{#if answer.delivery === 'sending'}<LoaderCircle
							class="size-3 animate-spin"
							aria-hidden="true"
						/>{/if}{delivered}{answer.at ? ` · ${time(answer.at)}` : ''}</span
				>
				<span class="ml-auto">{@render talk()}</span>
			</div>
		</article>
	{/if}

	{#if open}
		<!-- Talk about it from before hangs off the card, so it never crowds the conversation. -->
		<div
			class="mt-1 ml-4 border-l-2 border-hair pt-2 pl-4"
			role="region"
			aria-label="What was said about this question before"
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
				<p class="text-xs text-muted-foreground">Nothing was said about it here.</p>
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
		</div>
	{/if}
</div>
