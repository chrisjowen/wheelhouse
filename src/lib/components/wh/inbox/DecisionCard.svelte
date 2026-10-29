<script lang="ts">
	/**
	 * One open question in the decision inbox: the project and task, the question
	 * in plain words, Firstmate's recommendation when one is recorded, the evidence
	 * (findings, the pull request, preview, screenshots) and one-tap answers.
	 * `compact` is the home rail's version: the question, the recommendation and
	 * the buttons. The answer is sent by the parent (onAnswer), which goes to
	 * Firstmate, never to the worker directly. Close (onClose) takes a question
	 * Firstmate keeps under a decision key off the stack without an answer.
	 *
	 * A question whose text names its options (card.choices) shows each call as
	 * a set of choices, the recommended one picked; Approve then sends the picks
	 * (bound as `picks`). The compact card links to the full one to pick.
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
		ThumbsUp,
		X
	} from '@lucide/svelte';
	import { ago } from '$lib/format';
	import { markdown } from '$lib/chat/markdown';
	import {
		WRITTEN_MAX,
		awaitsAnswer,
		callName,
		choiceLabel,
		closable,
		resolvePicks,
		unpicked,
		type InboxCall,
		type InboxCard,
		type InboxChoice,
		type InboxKind,
		type Picks
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
		picks = $bindable({}),
		now,
		onAnswer,
		onLater,
		onClose,
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
		picks?: Picks;
		now: number;
		onAnswer: (choice: InboxChoice) => void;
		onLater: () => void;
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
	const canClose = $derived(!!onClose && closable(card));
	const CLOSE_MEANING = 'No answer needed: Firstmate records it closed.';
	const choices = $derived(card.choices);
	const heading = $derived(choices?.intro || card.question);
	const chosen = $derived(choices ? resolvePicks(choices, picks) : {});
	const missing = $derived(choices ? unpicked(choices, picks) : []);
	/** Short options sit in a row; longer ones stack. */
	const inRow = (call: InboxCall) => call.options.every((o) => !o.detail && o.label.length <= 28);
	const pick = (call: InboxCall, value: string) => (picks = { ...picks, [call.id]: value });
	const hasEvidence = $derived(
		!!(
			ev.text ||
			ev.findings.length ||
			ev.pr ||
			ev.preview ||
			ev.screenshots.length ||
			ev.file ||
			choices
		)
	);

	/** The report the question names, read on demand. */
	let report = $state<{ open: boolean; text: string | null; error: string | null }>({
		open: false,
		text: null,
		error: null
	});
	async function toggleReport() {
		report.open = !report.open;
		const url = ev.report?.url;
		if (!report.open || report.text !== null || !url) return;
		try {
			const r = await fetch(url);
			if (!r.ok) throw new Error();
			report.text = await r.text();
			report.error = null;
		} catch {
			report.error = 'The report could not be read.';
		}
	}

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
		{heading}
	</h3>
	<a
		{href}
		class="mt-0.5 block text-xs text-muted-foreground hover:text-foreground hover:underline {compact
			? 'truncate'
			: ''}">{card.taskTitle}</a
	>

	{#if ev.report && !compact}
		<div class="mt-2 text-xs">
			{#if ev.report.url}
				<button
					class="inline-flex cursor-pointer items-center gap-1 text-sea hover:underline"
					aria-expanded={report.open}
					onclick={toggleReport}
					><FileText class="size-3.5 shrink-0" aria-hidden="true" />{report.open
						? 'Hide the report'
						: 'Read the report'}<span class="ml-1 font-mono break-all text-muted-foreground"
						>{ev.report.path}</span
					></button
				>
			{:else}
				<span class="inline-flex items-center gap-1 text-muted-foreground"
					><FileText class="size-3.5 shrink-0" aria-hidden="true" />Report
					<span class="font-mono break-all">{ev.report.path}</span> (not found)</span
				>
			{/if}
			{#if report.open}
				<div
					class="mt-2 max-h-[28rem] overflow-y-auto rounded-md border bg-background/60 px-3 py-2 text-sm"
				>
					{#if report.error}
						<p class="text-danger" role="alert">{report.error}</p>
					{:else if report.text === null}
						<p class="text-muted-foreground">Reading the report…</p>
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
						<div class="chat-md">{@html markdown(report.text)}</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

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
				{#if choices}
					<div>
						<p class="text-xs font-medium text-muted-foreground">As Firstmate wrote it</p>
						<p class="mt-0.5 leading-relaxed text-muted-foreground">{card.question}</p>
					</div>
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
			<span class="font-medium"
				>Sent to Firstmate: {card.sent.picks
					? 'your picks'
					: choiceLabel(card, card.sent.choice)}</span
			>
			<span class="text-xs">({DELIVERY[card.sent.delivery] ?? card.sent.delivery})</span>
			{#if !compact}
				<button
					class="ml-auto cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					onclick={() => (again = true)}>Answer again</button
				>
				{#if canClose}
					<button
						class="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
						disabled={!canAnswer}
						title={CLOSE_MEANING}
						onclick={onClose}>Close</button
					>
				{/if}
			{/if}
		</div>
		{#if card.sent.picks && !compact}
			<p class="mt-1 text-xs text-muted-foreground">
				{card.sent.picks.split(/\s{2,}/).join(' · ')}
			</p>
		{/if}
		{#if card.sent.note && !compact}
			<p class="mt-1 text-xs text-muted-foreground">Your note: {card.sent.note}</p>
		{/if}
	{/if}

	{#if answering}
		{#if choices && !compact}
			<div class="mt-3 flex flex-col gap-3" role="group" aria-label="Your picks">
				{#each choices.calls as call (call.id)}
					<fieldset class="min-w-0">
						<legend class="text-sm leading-snug font-medium">
							{#if call.number !== null}<span class="mr-1 text-muted-foreground tabular-nums"
									>{call.number}.</span
								>{/if}{call.prompt ?? 'Pick one'}{#if !call.required}<span
									class="ml-1 font-normal text-muted-foreground"
								>
									· optional</span
								>{/if}
						</legend>
						{#if call.options.length}
							<div class="mt-1.5 flex gap-1.5 {inRow(call) ? 'flex-wrap' : 'flex-col'}">
								{#each call.options as o (o.id)}
									<label
										class="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent has-[:checked]:border-sea has-[:checked]:bg-sea/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
									>
										<input
											type="radio"
											name="pick-{card.id}-{call.id}"
											value={o.id}
											checked={chosen[call.id] === o.id}
											disabled={!canAnswer}
											onchange={() => pick(call, o.id)}
											class="mt-[0.2rem] shrink-0 accent-sea"
										/>
										<span class="min-w-0 leading-snug"
											>{#if o.detail}<span class="font-semibold">{o.label}</span><span
													class="text-foreground/85">{` · ${o.detail}`}</span
												>{:else}{o.label}{/if}{#if o.recommended}<span
													class="ml-1.5 text-xs font-medium whitespace-nowrap text-brass"
													>Recommended</span
												>{/if}</span
										>
									</label>
								{/each}
							</div>
						{:else}
							<input
								type="text"
								value={picks[call.id] ?? ''}
								maxlength={WRITTEN_MAX}
								disabled={!canAnswer}
								placeholder="Your answer (optional)"
								aria-label="Your answer to {callName(call) || 'this call'}"
								oninput={(e) => pick(call, e.currentTarget.value)}
								class="mt-1.5 block h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							/>
						{/if}
					</fieldset>
				{/each}
				{#if choices.after}
					<p class="text-xs leading-relaxed text-muted-foreground">{choices.after}</p>
				{/if}
			</div>
		{/if}
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
				{@const recommended = choices ? o.choice === 'approve' : rec?.choice === o.choice}
				{#if choices && compact && o.choice === 'approve'}
					<a
						href="/inbox#card-{card.id}"
						class="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-sea bg-sea px-2.5 text-xs font-medium text-white hover:bg-sea/90 sm:min-h-8 dark:text-slate-950"
						><Icon class="size-3.5" aria-hidden="true" />Pick options</a
					>
				{:else}
					<button
						class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 {recommended
							? 'border-sea bg-sea text-white hover:bg-sea/90 dark:text-slate-950'
							: 'bg-background hover:bg-accent'} {compact
							? 'min-h-9 px-2.5 text-xs sm:min-h-8'
							: ''}"
						disabled={!canAnswer || (o.choice === 'approve' && missing.length > 0)}
						title={o.meaning}
						onclick={() => answer(o.choice)}
						><Icon class="size-3.5" aria-hidden="true" />{o.label}{#if !compact}<kbd
								class="ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline"
								>{KEY[o.choice]}</kbd
							>{/if}</button
					>
				{/if}
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
			{#if canClose}
				<button
					class="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 {compact
						? 'min-h-9 text-xs sm:min-h-8'
						: ''}"
					disabled={!canAnswer}
					title={CLOSE_MEANING}
					onclick={onClose}
					><X class="size-3.5" aria-hidden="true" />Close{#if !compact}<kbd
							class="ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[0.7rem] leading-4 opacity-70 sm:inline"
							>c</kbd
						>{/if}</button
				>
			{/if}
			{#if compact}
				<a
					href="/inbox#card-{card.id}"
					class="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					><ArrowUpRight class="size-3.5" aria-hidden="true" />Evidence</a
				>
			{/if}
		</div>
		{#if choices && !compact && missing.length}
			<p class="mt-1.5 text-xs text-muted-foreground">
				Pick one for {missing.map(callName).join(', ')} to send your picks.
			</p>
		{/if}
		{#if !compact && active}
			<p class="mt-1.5 text-xs text-muted-foreground">
				{#each card.options as o, i (o.choice)}{i ? ' · ' : ''}<span class="font-medium"
						>{o.label}</span
					>: {meaning(o.choice)}{/each}{canClose ? ' · ' : ''}{#if canClose}<span
						class="font-medium">Close</span
					>: {CLOSE_MEANING}{/if}
			</p>
		{/if}
	{/if}
	{#if error}
		<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{/if}
</article>
