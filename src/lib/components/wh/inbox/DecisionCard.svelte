<script lang="ts">
	/**
	 * One open question outside the chat (the Decisions page, On deck, the task
	 * page): the project and task, the question in plain words, Firstmate's
	 * recommendation when one is recorded, and what it rests on (Evidence).
	 * The question is answered in the Firstmate chat, where Chat about this
	 * opens it with the form that fits it and room to talk it through; Agree
	 * sends Firstmate's recommendation from here with one tap. Every answer
	 * goes to Firstmate (the parent sends it, onAgree), never to a worker
	 * directly. Close (onClose) takes a question Firstmate keeps under a
	 * decision key off the stack without an answer, and Ask me later (onLater)
	 * is offered where the parent passes it. `shortcuts` shows each action's
	 * key, where the page binds the keys.
	 */
	import {
		Check,
		Clock,
		Compass,
		ExternalLink,
		GitPullRequest,
		Hand,
		MessageSquare,
		MonitorPlay,
		OctagonAlert,
		Scale,
		X
	} from '@lucide/svelte';
	import { ago } from '$lib/format';
	import { pullRequests } from '$lib/client/pullrequests';
	import { cardForm, optionName, recommendedOption } from '$lib/decisionform';
	import { decisionHref } from '$lib/handled';
	import { cardTaskHref, choiceLabel, closable, type InboxCard, type InboxKind } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import DecisionEvidence from './DecisionEvidence.svelte';

	let {
		card,
		project = null,
		active = false,
		expanded = false,
		shortcuts = false,
		canAnswer = true,
		error = null,
		now,
		onAgree,
		onLater,
		onClose,
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
		/** Send Firstmate's recommendation, as the form's recommended option. */
		onAgree: () => void;
		onLater?: () => void;
		onClose?: () => void;
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

	const kind = $derived(KIND[card.kind]);
	const mine = $derived(card.owner === 'captain');
	const rec = $derived(card.recommendation);
	const href = $derived(cardTaskHref(card));
	const chatHref = $derived(decisionHref(card.id));
	// Review opens the PR in a plugin's review tab while one is on for the project, else on GitHub.
	const prLink = $derived(
		card.evidence.pr ? pullRequests.review(card.projectId, card.evidence.pr) : null
	);
	const canClose = $derived(!!onClose && closable(card));
	const heading = $derived(card.choices?.intro || card.question);
	const agree = $derived(recommendedOption(cardForm(card)));
	const agreeName = $derived(agree ? optionName(agree) : '');
	const kbd =
		'ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline';
</script>

<article
	id="card-{card.id}"
	class="scroll-mt-24 rounded-lg border border-l-[3px] bg-card text-card-foreground transition-shadow {mine
		? 'border-l-sea'
		: 'border-l-brass'} {active ? 'shadow-[0_0_0_2px_var(--ring)]' : ''} px-4 pt-3.5 pb-3 sm:px-5"
	aria-current={active ? 'true' : undefined}
	onfocusin={onFocus}
	onpointerdown={onFocus}
	data-decision-card={card.owner}
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
			><kind.icon class="size-3" aria-hidden="true" />{kind.label}</span
		>
		{#if card.secondMate}
			<span
				class="rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-foreground/80"
				data-second-mate={card.secondMate.id}>From second mate {card.secondMate.id}</span
			>
		{/if}
		<span class="text-xs text-muted-foreground"
			>{mine
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
		<LinkedText text={heading} />
	</h3>
	<a {href} class="mt-0.5 block text-xs text-muted-foreground hover:text-foreground hover:underline"
		>{card.taskTitle}</a
	>

	{#if rec || agree}
		<p class="mt-2.5 border-l-2 border-brass pl-2.5 text-sm leading-snug">
			<span class="font-medium">Firstmate recommends{agree ? `: ${agreeName}` : ''}</span
			>{#if rec}<span class="text-muted-foreground"> · <LinkedText text={rec.text} /></span>{/if}
		</p>
	{/if}

	<DecisionEvidence {card} {expanded} {onToggle} />

	{#if card.sent?.delivery === 'failed' && !error}
		<p class="mt-3 text-sm text-danger" role="alert">
			Not delivered to Firstmate: {card.sent.picks ?? choiceLabel(card, card.sent.choice)}. {card
				.sent.detail ?? 'Try again.'}
		</p>
	{/if}

	<div class="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Answer">
		<a
			href={chatHref}
			class="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-sea bg-sea px-3 text-sm font-medium text-white transition-colors hover:bg-sea/90 sm:min-h-9 dark:text-slate-950"
			title="Open it in the Firstmate chat, with the form that fits it and room to talk it through"
			data-chat-about
			><MessageSquare class="size-3.5" aria-hidden="true" />Chat about this{#if shortcuts}<kbd
					class={kbd}>Enter</kbd
				>{/if}</a
		>
		{#if agree}
			<button
				class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
				disabled={!canAnswer}
				title="Send Firstmate's recommendation: {agreeName}"
				onclick={onAgree}
				data-agree
				><Check class="size-3.5" aria-hidden="true" />Agree: {agreeName}{#if shortcuts}<kbd
						class={kbd}>a</kbd
					>{/if}</button
			>
		{/if}
		{#if prLink}
			<a
				class="inline-flex min-h-10 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent sm:min-h-9"
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
		{#if onLater}
			<button
				class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-9"
				onclick={onLater}
				><Clock class="size-3.5" aria-hidden="true" />Ask me later{#if shortcuts}<kbd class={kbd}
						>l</kbd
					>{/if}</button
			>
		{/if}
		{#if canClose}
			<button
				class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
				disabled={!canAnswer}
				title="No answer needed: Firstmate records it closed."
				onclick={onClose}
				><X class="size-3.5" aria-hidden="true" />Close{#if shortcuts}<kbd class={kbd}>c</kbd
					>{/if}</button
			>
		{/if}
	</div>
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{/if}
</article>
