<script lang="ts">
	/**
	 * One open question in the decision inbox: the project and task, the question
	 * in plain words, Firstmate's recommendation when one is recorded, the evidence
	 * (findings, the pull request, preview, screenshots) and one-tap answers.
	 * `compact` is the home rail's version: the question, the recommendation and
	 * the buttons. The answer is sent by the parent (onAnswer), which goes to
	 * Firstmate, never to the worker directly.
	 */
	import {
		ArrowUpRight,
		Check,
		ChevronDown,
		Clock,
		ExternalLink,
		FileText,
		GitPullRequest,
		Hammer,
		Hand,
		MonitorPlay,
		OctagonAlert,
		Scale,
		SkipForward,
		ThumbsUp
	} from '@lucide/svelte';
	import { ago } from '$lib/format';
	import {
		awaitsAnswer,
		choiceLabel,
		type InboxCard,
		type InboxChoice,
		type InboxKind
	} from '$lib/inbox';

	let {
		card,
		project = null,
		active = false,
		expanded = false,
		compact = false,
		canAnswer = true,
		error = null,
		note = $bindable(''),
		now,
		onAnswer,
		onLater,
		onToggle,
		onFocus
	}: {
		card: InboxCard;
		project?: string | null;
		active?: boolean;
		expanded?: boolean;
		compact?: boolean;
		canAnswer?: boolean;
		error?: string | null;
		note?: string;
		now: number;
		onAnswer: (choice: InboxChoice) => void;
		onLater: () => void;
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
	const ICON: Record<InboxChoice, typeof Hand> = {
		approve: ThumbsUp,
		fix: Hammer,
		skip: SkipForward
	};
	const KEY: Record<InboxChoice, string> = { approve: 'a', fix: 'f', skip: 's' };
	const DELIVERY: Record<string, string> = {
		sending: 'sending',
		delivered: 'delivered',
		'saved-unannounced': 'saved; Firstmate not woken yet',
		uncertain: 'confirming delivery',
		failed: 'not delivered'
	};

	const kind = $derived(KIND[card.kind]);
	const rec = $derived(card.recommendation);
	const ev = $derived(card.evidence);
	const href = $derived(`/tasks/${encodeURIComponent(card.taskId)}`);
	let again = $state(false);
	const answering = $derived(awaitsAnswer(card) || again);
	const meaning = (c: InboxChoice) => card.options.find((o) => o.choice === c)?.meaning ?? '';
	const hasEvidence = $derived(
		!!(ev.text || ev.findings.length || ev.pr || ev.preview || ev.screenshots.length || ev.file)
	);

	function answer(c: InboxChoice) {
		again = false;
		onAnswer(c);
	}
</script>

<article
	id="card-{card.id}"
	class="scroll-mt-24 rounded-lg border border-l-[3px] bg-card text-card-foreground transition-shadow {card.owner ===
	'captain'
		? 'border-l-sea'
		: 'border-l-brass'} {active ? 'shadow-[0_0_0_2px_var(--ring)]' : ''} {compact
		? 'px-3 pt-2.5 pb-2'
		: 'px-4 pt-3.5 pb-3 sm:px-5'}"
	aria-current={active ? 'true' : undefined}
	onfocusin={onFocus}
	onpointerdown={onFocus}
>
	<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
		{#if project}
			<span
				class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>{project}</span
			>
		{/if}
		<span
			class="flex items-center gap-1 rounded px-1.5 text-xs leading-[1.15rem] font-medium {card.owner ===
			'captain'
				? 'bg-sea/10 text-sea'
				: 'bg-muted text-foreground/80'}"
			><kind.icon class="size-3" aria-hidden="true" />{kind.label}</span
		>
		<span class="text-xs text-muted-foreground"
			>{card.owner === 'captain'
				? 'Waiting on you'
				: compact
					? 'With Firstmate'
					: 'With Firstmate; yours to call if you want'}</span
		>
		{#if card.askedAt}
			<span class="ml-auto text-xs text-muted-foreground tabular-nums"
				>{ago(card.askedAt, now)}</span
			>
		{/if}
	</header>

	<h3
		class="mt-2 font-sans leading-snug font-medium text-foreground {compact
			? 'line-clamp-3 text-sm'
			: 'text-base sm:text-[1.05rem]'}"
	>
		{card.question}
	</h3>
	<a
		{href}
		class="mt-0.5 block text-xs text-muted-foreground hover:text-foreground hover:underline {compact
			? 'truncate'
			: ''}">{card.taskTitle}</a
	>

	{#if rec}
		<p
			class="mt-2.5 border-l-2 border-brass pl-2.5 text-sm leading-snug {compact
				? 'line-clamp-2 text-xs'
				: ''}"
		>
			<span class="font-medium"
				>Firstmate recommends{rec.choice ? `: ${choiceLabel(card, rec.choice)}` : ''}</span
			><span class="text-muted-foreground">{` · ${rec.text}`}</span>
		</p>
	{/if}

	{#if !compact && hasEvidence}
		<button
			class="mt-3 flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
			aria-expanded={expanded}
			onclick={onToggle}
			>Evidence<ChevronDown
				class="size-3.5 transition-transform {expanded ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>{#if !expanded}<span class="font-normal"
					>{ev.findings.length
						? ` · ${ev.findings.length} ${ev.findings.length === 1 ? 'finding' : 'findings'}`
						: ''}{ev.pr ? ' · pull request' : ''}{ev.preview ? ' · preview' : ''}{ev.screenshots
						.length
						? ` · ${ev.screenshots.length} ${ev.screenshots.length === 1 ? 'screenshot' : 'screenshots'}`
						: ''}</span
				>{/if}</button
		>
		{#if expanded}
			<div class="mt-2 space-y-3 rounded-md border bg-background/60 p-3 text-sm">
				{#if ev.findings.length}
					<ol class="space-y-2.5">
						{#each ev.findings as f (f.id)}
							<li>
								<p class="leading-snug">
									{#if f.serious}<span
											class="mr-1.5 rounded bg-danger/10 px-1 text-xs font-medium text-danger"
											>Serious</span
										>{/if}{f.summary}
								</p>
								{#if f.where}<p class="mt-0.5 font-mono text-xs text-muted-foreground">
										{f.where}
									</p>{/if}
								{#if f.detail}<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
										{f.detail}
									</p>{/if}
							</li>
						{/each}
					</ol>
				{/if}
				{#if ev.text}<p class="leading-relaxed whitespace-pre-line text-muted-foreground">
						{ev.text}
					</p>{/if}
				{#if ev.pr || ev.preview || ev.file}
					<ul class="flex flex-col gap-1 text-xs">
						{#if ev.pr}
							<li>
								<a
									href={ev.pr.url}
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 break-all text-sea hover:underline"
									><GitPullRequest class="size-3.5 shrink-0" aria-hidden="true" />{ev.pr.url}</a
								>{#if ev.checks}<span class="ml-1.5 text-muted-foreground"
										>· checks {ev.checks}</span
									>{/if}
							</li>
						{/if}
						{#if ev.preview}
							<li>
								<a
									href="{href}?tab=preview"
									class="inline-flex items-center gap-1 text-sea hover:underline"
									><MonitorPlay class="size-3.5 shrink-0" aria-hidden="true" />Open in the task's
									preview</a
								>
							</li>
							<li>
								<a
									href={ev.preview}
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 break-all text-sea hover:underline"
									><ExternalLink class="size-3.5 shrink-0" aria-hidden="true" />{ev.preview}</a
								>
							</li>
						{/if}
						{#if ev.file}
							<li class="inline-flex items-center gap-1 text-muted-foreground">
								<FileText class="size-3.5 shrink-0" aria-hidden="true" />Findings file
								<span class="font-mono break-all">{ev.file}</span>
							</li>
						{/if}
					</ul>
				{/if}
				{#if ev.screenshots.length}
					<ul class="flex flex-wrap gap-2">
						{#each ev.screenshots as s (s.url)}
							<li>
								<a href={s.url} target="_blank" rel="noreferrer" class="block">
									<img
										src={s.url}
										alt={s.name}
										class="h-20 w-32 rounded border object-cover object-top"
										loading="lazy"
									/>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/if}

	{#if card.sent?.delivery === 'failed' && !error}
		<p class="mt-3 text-sm text-danger" role="alert">
			Not delivered to Firstmate: {choiceLabel(card, card.sent.choice)}. {card.sent.detail ??
				'Try again.'}
		</p>
	{:else if card.sent && card.sent.delivery !== 'failed' && !again}
		<div
			class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-success/10 px-2.5 py-2 text-sm text-success"
			role="status"
		>
			<Check class="size-4 shrink-0" aria-hidden="true" />
			<span class="font-medium">Sent to Firstmate: {choiceLabel(card, card.sent.choice)}</span>
			<span class="text-xs">({DELIVERY[card.sent.delivery] ?? card.sent.delivery})</span>
			{#if !compact}
				<button
					class="ml-auto cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					onclick={() => (again = true)}>Answer again</button
				>
			{/if}
		</div>
		{#if card.sent.note && !compact}
			<p class="mt-1 text-xs text-muted-foreground">Your note: {card.sent.note}</p>
		{/if}
	{/if}

	{#if answering}
		{#if !compact}
			<label class="mt-3 block">
				<span class="sr-only">Note for Firstmate (optional)</span>
				<textarea
					bind:value={note}
					rows="1"
					maxlength="2000"
					placeholder="Add a note for Firstmate (optional)"
					class="block field-sizing-content max-h-40 min-h-9 w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				></textarea>
			</label>
		{/if}
		<div class="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Answer">
			{#each card.options as o (o.choice)}
				{@const Icon = ICON[o.choice]}
				{@const recommended = rec?.choice === o.choice}
				<button
					class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 {recommended
						? 'border-sea bg-sea text-white hover:bg-sea/90 dark:text-slate-950'
						: 'bg-background hover:bg-accent'} {compact ? 'min-h-9 px-2.5 text-xs sm:min-h-8' : ''}"
					disabled={!canAnswer}
					title={o.meaning}
					onclick={() => answer(o.choice)}
					><Icon class="size-3.5" aria-hidden="true" />{o.label}{#if !compact}<kbd
							class="ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline"
							>{KEY[o.choice]}</kbd
						>{/if}</button
				>
			{/each}
			<button
				class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-9 {compact
					? 'min-h-9 text-xs sm:min-h-8'
					: ''}"
				onclick={onLater}
				><Clock class="size-3.5" aria-hidden="true" />Ask me later{#if !compact}<kbd
						class="ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline"
						>l</kbd
					>{/if}</button
			>
			{#if compact}
				<a
					href="/inbox#card-{card.id}"
					class="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					><ArrowUpRight class="size-3.5" aria-hidden="true" />Evidence</a
				>
			{/if}
		</div>
		{#if !compact && active}
			<p class="mt-1.5 text-xs text-muted-foreground">
				{#each card.options as o, i (o.choice)}{i ? ' · ' : ''}<span class="font-medium"
						>{o.label}</span
					>: {meaning(o.choice)}{/each}
			</p>
		{/if}
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{/if}
</article>
