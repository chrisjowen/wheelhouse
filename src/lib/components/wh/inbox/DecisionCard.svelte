<script lang="ts">
	/**
	 * One open question outside the chat (the Decisions page, On deck, the task
	 * page): its project, a short question, a link to its task (and the task
	 * it came from), the documents, previews and screenshots it rests on,
	 * Firstmate's recommendation, and the form it is answered with
	 * (lib/decisionform.ts), which always takes the captain's own words too
	 * (Other). Every answer goes to Firstmate through the inbox, never to a
	 * worker directly. Chat with Firstmate about this opens the main chat with
	 * a message about it started, and marks it as followed up there: still
	 * listed, no longer counted as waiting, until it is answered or put back.
	 * Dismiss takes it off the stack without an answer, with a reason, and
	 * Ask me later (onLater) is offered where the parent passes it. The
	 * internals (its id, Firstmate's own words, findings) sit under Details.
	 * `shortcuts` shows each action's key, where the page binds the keys.
	 */
	import {
		Clock,
		Compass,
		ExternalLink,
		GitPullRequest,
		Hand,
		MessageSquare,
		MessagesSquare,
		MonitorPlay,
		OctagonAlert,
		Scale,
		Undo2,
		X
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { ago } from '$lib/format';
	import { inbox } from '$lib/client/inbox.svelte';
	import { answerWith } from '$lib/client/agree';
	import { pullRequests } from '$lib/client/pullrequests';
	import { cardForm, type FormAnswer } from '$lib/decisionform';
	import { chatAboutHref } from '$lib/handled';
	import { cardContext, choiceLabel, type InboxCard, type InboxKind } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import DecisionForm from '$lib/components/firstmate/DecisionForm.svelte';
	import DecisionDetails from './DecisionDetails.svelte';
	import DecisionLinks from './DecisionLinks.svelte';
	import DismissPicker from './DismissPicker.svelte';

	let {
		card,
		project = null,
		active = false,
		expanded = false,
		shortcuts = false,
		canAnswer = true,
		error = null,
		now,
		other = $bindable(false),
		dismissing = $bindable(false),
		onSent,
		onLater,
		onToggle,
		onFocus
	}: {
		card: InboxCard;
		project?: string | null;
		active?: boolean;
		expanded?: boolean;
		shortcuts?: boolean;
		canAnswer?: boolean;
		error?: string | null;
		now: number;
		/** The captain's own answer is open (Other). */
		other?: boolean;
		/** Asking why it is being dismissed. */
		dismissing?: boolean;
		/** An answer or a dismissal is on its way: the card is leaving the list. */
		onSent?: () => void;
		onLater?: () => void;
		onToggle?: () => void;
		onFocus?: () => void;
	} = $props();

	const KIND: Record<InboxKind, { label: string; icon: typeof Hand }> = {
		review: { label: 'Review question', icon: Scale },
		decision: { label: 'Decision', icon: Hand },
		blocked: { label: 'Stuck', icon: OctagonAlert },
		hold: { label: 'Your call', icon: Hand },
		merge: { label: 'Merge call', icon: GitPullRequest },
		preview: { label: 'Preview sign-off', icon: MonitorPlay }
	};

	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const kind = $derived(KIND[card.kind]);
	const mine = $derived(card.owner === 'captain');
	const following = $derived(!!card.following);
	const rec = $derived(card.recommendation);
	const context = $derived(cardContext(card));
	const form = $derived(cardForm(card));
	const chatHref = $derived(chatAboutHref(card));
	// Review opens the PR in a plugin's review tab while one is on for the project, else on GitHub.
	const prLink = $derived(
		card.evidence.pr ? pullRequests.review(card.projectId, card.evidence.pr) : null
	);
	const kbd =
		'ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline';
	const quiet =
		'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9';

	function answer(a: FormAnswer, note: string | null) {
		onSent?.();
		void answerWith(card, a, note, token);
	}
	function dismiss(reason: string | null) {
		dismissing = false;
		onSent?.();
		void inbox.answer(card, 'close', reason, token);
	}
	/** Chat with Firstmate about this: the link opens the chat; this keeps it as followed up there. */
	function chat() {
		if (!following) void inbox.follow(card, true, token);
	}
</script>

<article
	id="card-{card.id}"
	class="scroll-mt-24 rounded-lg border border-l-[3px] bg-card text-card-foreground transition-shadow {following
		? 'border-l-sea/50'
		: mine
			? 'border-l-sea'
			: 'border-l-brass'} {active ? 'shadow-[0_0_0_2px_var(--ring)]' : ''} px-4 pt-3.5 pb-3 sm:px-5"
	aria-current={active ? 'true' : undefined}
	onfocusin={onFocus}
	onpointerdown={onFocus}
	data-decision-card={card.owner}
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
				><kind.icon class="size-3" aria-hidden="true" />{kind.label}</span
			>
		{/if}
		{#if card.secondMate}
			<span
				class="rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-foreground/80"
				data-second-mate={card.secondMate.id}>From second mate {card.secondMate.id}</span
			>
		{/if}
		<span class="text-xs text-muted-foreground"
			>{following
				? 'Following up with Firstmate separately'
				: mine
					? 'Waiting on you'
					: card.secondMate
						? 'Its second mate is handling it; yours to take over if you want'
						: 'Firstmate is handling it; yours to take over if you want'}</span
		>
		{#if card.askedAt}
			<span class="ml-auto text-xs text-muted-foreground tabular-nums"
				>{ago(card.askedAt, now)}</span
			>
		{/if}
	</header>

	<h3 class="mt-2 font-sans text-base leading-snug font-medium text-foreground sm:text-[1.05rem]">
		<LinkedText text={card.title} />
	</h3>
	{#if context}
		<p class="mt-0.5 line-clamp-3 text-sm leading-snug text-muted-foreground" data-context>
			<LinkedText text={context} />
		</p>
	{/if}
	<p class="mt-0.5 text-xs text-muted-foreground">{card.taskTitle}</p>

	<DecisionLinks {card} />

	{#if rec}
		<p class="mt-2.5 border-l-2 border-brass pl-2.5 text-sm leading-snug">
			<span class="font-medium">Firstmate recommends</span><span class="text-muted-foreground">
				· <LinkedText text={rec.text} /></span
			>
		</p>
	{/if}

	<DecisionForm
		{form}
		name={card.id}
		{canAnswer}
		bind:other
		onAnswer={(a, note) => answer(a, note)}
	/>

	{#if card.sent?.delivery === 'failed' && !error}
		<p class="mt-3 text-sm text-danger" role="alert">
			Not delivered to Firstmate: {card.sent.picks ?? choiceLabel(card, card.sent.choice)}. {card
				.sent.detail ?? 'Try again.'}
		</p>
	{/if}

	<div
		class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hair/70 pt-2.5"
		role="group"
		aria-label="More"
	>
		<a
			href={chatHref}
			class="inline-flex min-h-11 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent sm:min-h-9"
			title="Open the Firstmate chat with a message about this started; it waits as following up meanwhile"
			onclick={chat}
			data-chat-about
			><MessageSquare class="size-3.5" aria-hidden="true" />Chat with Firstmate about this{#if shortcuts}<kbd
					class={kbd}>c</kbd
				>{/if}</a
		>
		{#if following}
			<button
				class={quiet}
				title="It waits on you again, and counts as waiting"
				onclick={() => inbox.follow(card, false, token)}
				data-unfollow><Undo2 class="size-3.5" aria-hidden="true" />Back to waiting</button
			>
		{/if}
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
		<span class="flex-1"></span>
		{#if onLater}
			<button class={quiet} onclick={onLater}
				><Clock class="size-3.5" aria-hidden="true" />Ask me later{#if shortcuts}<kbd class={kbd}
						>l</kbd
					>{/if}</button
			>
		{/if}
		<button
			class={quiet}
			disabled={!canAnswer}
			aria-expanded={dismissing}
			title="No answer needed: Firstmate records it closed, with your reason"
			onclick={() => (dismissing = !dismissing)}
			data-dismiss
			><X class="size-3.5" aria-hidden="true" />Dismiss{#if shortcuts}<kbd class={kbd}>d</kbd
				>{/if}</button
		>
	</div>
	{#if dismissing}
		<DismissPicker
			name={card.id}
			disabled={!canAnswer}
			onDismiss={dismiss}
			onCancel={() => (dismissing = false)}
		/>
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{/if}

	<DecisionDetails {card} {expanded} {onToggle} />
</article>
