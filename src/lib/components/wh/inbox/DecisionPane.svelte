<script lang="ts">
	/**
	 * One decision in full, the right of the Decisions inbox (on a
	 * phone, the screen, with the way back), read like a letter: a line of
	 * facts, who it is from and the task it is on (and the task it came from),
	 * the question, what is needed from the captain in Firstmate's own words
	 * and a link down to the answer. Then what it rests on, each part folded
	 * away at will (PaneSection): Background (the crew's summary once its brief
	 * comes back, and Firstmate's whole note), the live preview, the documents
	 * (the report at the part it points at, DecisionSource, and the rest), and
	 * last the answer (Firstmate's recommendation, the full form when the calls
	 * need one, the internals folded), then the captain's questions with the
	 * discussion crew's short answers. Pinned under it, like
	 * a chat's message box: the options as quick picks (the question's own,
	 * when the brief finds them and the form only had plain answers), Other for
	 * the captain's own words, and a box to ask about it, typed or dictated.
	 * When the talk comes to a clear pick or conclusion, it can be sent as the
	 * answer. Every answer goes through the decision inbox, as anywhere else.
	 */
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import {
		ArrowDown,
		ArrowLeft,
		ArrowUp,
		AudioLines,
		Check,
		Clock,
		MessageSquare,
		PenLine,
		RotateCw,
		Sparkles,
		X
	} from '@lucide/svelte';
	import { fieldTarget } from '$lib/voice/dictation.svelte';
	import MicButton from '$lib/components/wh/MicButton.svelte';
	import { ago, clock } from '$lib/format';
	import { markdown } from '$lib/chat/markdown';
	import { bodyMarkdown } from '$lib/docsection';
	import { inbox } from '$lib/client/inbox.svelte';
	import { answerWith } from '$lib/client/agree';
	import { decisionDrafts } from '$lib/client/decisiondrafts.svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import { briefs } from '$lib/client/decisionbrief.svelte';
	import {
		cardForm,
		type DecisionForm as Form,
		type FormAnswer,
		type FormOption
	} from '$lib/decisionform';
	import { KIND_LABEL, standing } from '$lib/decisionhome';
	import { plainOptions, type TalkOption } from '$lib/decisiontalk';
	import { chatAboutHref } from '$lib/handled';
	import { answered, cardContext, cardTaskHref, choiceLabel, type InboxCard } from '$lib/inbox';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import DecisionForm from '$lib/components/firstmate/DecisionForm.svelte';
	import DecisionDetails from './DecisionDetails.svelte';
	import DecisionLinks from './DecisionLinks.svelte';
	import DecisionRecords from './DecisionRecords.svelte';
	import DecisionSource from './DecisionSource.svelte';
	import DecisionWhere from './DecisionWhere.svelte';
	import PaneSection from './PaneSection.svelte';
	import DismissPicker from './DismissPicker.svelte';

	let {
		card,
		project = null,
		now,
		canAnswer = true,
		error = null,
		back = null,
		onSent,
		onLater
	}: {
		card: InboxCard;
		project?: string | null;
		now: number;
		canAnswer?: boolean;
		error?: string | null;
		/** On a phone, where the way back to the list goes. */
		back?: string | null;
		/** An answer or a dismissal is on its way: the page moves on. */
		onSent?: () => void;
		onLater?: () => void;
	} = $props();

	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const own = $derived(cardForm(card));
	// The options as numbered for the crew: the form's own.
	const ownOptions = $derived.by((): TalkOption[] =>
		own.kind === 'buttons' || own.kind === 'choice'
			? own.options.map((o, i) => ({
					n: i + 1,
					label: o.label,
					detail: o.detail,
					recommended: o.recommended
				}))
			: []
	);
	const brief = $derived(briefs.byCard[card.id] ?? null);
	// The question's own options, read by the brief, when the form only had plain answers.
	const named = $derived(
		brief?.state === 'ok' && plainOptions(ownOptions) && brief.options.length >= 2
			? brief.options
			: []
	);
	const form = $derived.by((): Form => {
		if (!named.length) return own;
		const options: FormOption[] = named.map((o) => ({
			id: `n${o.n}`,
			label: o.label,
			detail: o.detail,
			recommended: o.recommended,
			answer: {
				choice: 'approve',
				picks: null,
				decided: o.detail ? `${o.label}: ${o.detail}` : o.label
			}
		}));
		return { kind: 'choice', prompt: null, options, from: 'firstmate' };
	});
	const options = $derived(named.length ? named : ownOptions);
	const context = $derived(cardContext(card));
	const ev = $derived(card.evidence);
	// Who wrote to the captain, and the task it is on.
	const from = $derived(card.secondMate ? `Second mate ${card.secondMate.id}` : 'Firstmate');
	// The task by its title, or by its id when the title is the question itself.
	const taskName = $derived.by(() => {
		const name = card.secondMate?.taskTitle ?? card.taskTitle;
		const same = (x: string) =>
			x
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, ' ')
				.trim();
		return same(name) === same(card.title) ? (card.secondMate?.taskId ?? card.taskId) : name;
	});
	// Firstmate's whole note as Markdown, rendered in the browser (sanitising needs its DOM).
	const note = $derived(
		browser && ev.text ? markdown(bodyMarkdown(ev.text), { docLinks: true }) : null
	);
	// Where the work can be seen, shown in place.
	const where = $derived(!!(ev.preview || ev.board || ev.screenshots.length));
	const mine = $derived(standing(card) === 'waiting');
	// Answered, and Firstmate still has it open: what was sent, so it can be answered again.
	const sent = $derived(answered(card) ? card.sent : null);
	const thread = $derived(briefs.thread(card.id));

	// The brief starts in the background as the decision opens.
	$effect(() => {
		briefs.load(card.id, ownOptions, token);
	});

	// Live mode (the `discussion` feature): talk it through out loud, in the Firstmate chat.
	const liveOn = $derived(
		(page.data.features as { discussion?: boolean } | undefined)?.discussion === true
	);
	function talkLive() {
		// Started on this click, so the call may use the microphone and speak.
		void liveCall.start(token, { decision: card.id, title: card.title });
		void goto('/');
	}
	// What a Live talk about it came to: it fills in the answer, nothing is sent.
	const draft = $derived(decisionDrafts.byCard[card.id] ?? null);

	let answerOpen = $state(true);
	let expanded = $state(false);
	let dismissing = $state(false);
	let question = $state('');
	let list = $state<HTMLElement | null>(null);
	let box = $state<HTMLTextAreaElement | null>(null);
	let listening = $state(false);
	// The quick pick chosen, or the captain's own words (Other).
	let picked = $state<string | null>(null);
	let written = $state<string | null>(null);
	const quick = $derived(form.kind === 'buttons' || form.kind === 'choice' ? form.options : []);
	// The recommended pick starts chosen, as the form does.
	$effect(() => {
		if (written === null && !quick.some((o) => o.id === picked))
			picked = quick.find((o) => o.recommended)?.id ?? null;
	});
	const choice = $derived(quick.find((o) => o.id === picked) ?? null);
	// A Live outcome on a decision answered with quick picks: its one call's pick, or its words.
	let drafted = 0;
	$effect(() => {
		if (!draft || draft.at === drafted || !quick.length) return;
		drafted = draft.at;
		const only = card.choices?.calls.length === 1 ? card.choices.calls[0].id : null;
		const pick = only ? draft.picks[only] : undefined;
		const words = only ? draft.words[only] : undefined;
		if (pick && quick.some((o) => o.id === pick)) {
			picked = pick;
			written = null;
		} else if (words) written = words.slice(0, 300);
	});
	function decide() {
		if (written !== null) {
			const t = written.trim();
			if (t)
				answer({ choice: 'approve', picks: null, decided: t.slice(0, 300), other: true }, null);
		} else if (choice) answer(choice.answer, null);
	}

	const SUGGESTED = [
		'What are the options?',
		'What is the risk?',
		'Why does Firstmate recommend that?'
	];

	/** Down to the answer, opened: the options pinned below when it has them, else its form. */
	async function toAnswer() {
		answerOpen = true;
		await tick();
		document
			.getElementById('decision-answer')
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		const first =
			document.querySelector<HTMLElement>('[data-quick-pick]') ??
			document.querySelector<HTMLElement>('#decision-answer-body :is(input, button)');
		first?.focus({ preventScroll: true });
	}

	async function ask(text: string) {
		const t = text.trim();
		if (!t) return;
		question = '';
		const sent = briefs.ask(card.id, t, options, token);
		await tick();
		list?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
		await sent;
		await tick();
		list?.lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	function answer(a: FormAnswer, note: string | null) {
		onSent?.();
		decisionDrafts.clear(card.id);
		void answerWith(card, a, note, token);
	}

	// What the talk came to, as an answer that can be sent.
	const agreed = $derived.by((): { label: string; answer: FormAnswer } | null => {
		const o = thread.outcome;
		if (!o && draft?.answer)
			return {
				label: draft.answer,
				answer: { choice: 'approve', picks: null, decided: draft.answer.slice(0, 300) }
			};
		if (!o) return null;
		if ('option' in o) {
			const opt =
				form.kind === 'buttons' || form.kind === 'choice' ? form.options[o.option - 1] : null;
			return opt ? { label: opt.label, answer: opt.answer } : null;
		}
		return {
			label: o.conclusion,
			answer: { choice: 'approve', picks: null, decided: o.conclusion.slice(0, 300) }
		};
	});

	/** The answer's buttons, one family: the options, Other and Decide. */
	const pill =
		'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm leading-none transition-colors max-md:h-11';
	const quiet =
		'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11';
</script>

<article
	class="flex h-full min-h-0 flex-col"
	aria-labelledby="decision-title"
	data-decision-pane={card.id}
>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-pane-scroll>
		<div class="mx-auto max-w-3xl px-8 pt-6 pb-8 max-md:px-4 max-md:pt-4">
			<!-- The facts in a line, and the ways out that answer nothing. -->
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
				{#if back}<a
						href={back}
						class="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm hover:text-foreground"
						data-back-to-list><ArrowLeft class="size-4" aria-hidden="true" />Decisions</a
					>{/if}
				<span
					class="rounded px-1.5 leading-[1.15rem] font-medium {mine
						? 'bg-sea/10 text-sea'
						: 'bg-muted text-foreground/80'}">{KIND_LABEL[card.kind]}</span
				>
				{#if project}<span>{project}</span>{/if}
				{#if card.askedAt}<span aria-hidden="true">·</span><span class="tabular-nums"
						>asked {ago(card.askedAt, now)}</span
					>{/if}
				<span class="ml-auto flex items-center gap-0.5">
					{#if liveOn}
						<button
							type="button"
							class="{quiet} font-medium text-sea"
							disabled={!canAnswer}
							onclick={talkLive}
							title="Talk it through out loud with a discussion crew member, who has read it in full; what you settle fills in the answer here"
							data-talk-live
							><AudioLines class="size-3.5" aria-hidden="true" />Talk it through in Live</button
						>
					{/if}
					{#if onLater}
						<button type="button" class={quiet} onclick={onLater}
							><Clock class="size-3.5" aria-hidden="true" />Later</button
						>
					{/if}
					<button
						type="button"
						class={quiet}
						disabled={!canAnswer}
						aria-expanded={dismissing}
						onclick={() => (dismissing = !dismissing)}
						data-dismiss><X class="size-3.5" aria-hidden="true" />Dismiss</button
					>
				</span>
			</div>
			{#if dismissing}
				<DismissPicker
					name={card.id}
					disabled={!canAnswer}
					onDismiss={(reason) => {
						dismissing = false;
						onSent?.();
						void inbox.answer(card, 'close', reason, token);
					}}
					onCancel={() => (dismissing = false)}
				/>
			{/if}

			<p class="mt-3 text-sm text-muted-foreground" data-decision-from>
				<span class="font-medium text-foreground">{from}</span>, on
				<a href={cardTaskHref(card)} class="hover:text-foreground hover:underline">{taskName}</a>
				{#if card.origin}
					<span aria-hidden="true">·</span> from
					<a
						href="/tasks/{encodeURIComponent(card.origin)}"
						class="font-mono text-[0.8rem] hover:text-foreground hover:underline">{card.origin}</a
					>
				{/if}
			</p>

			<h2
				id="decision-title"
				class="mt-1 font-title text-[1.9rem] leading-tight text-balance max-md:text-2xl"
			>
				<LinkedText text={card.title} />
			</h2>

			{#if sent}
				<p
					class="mt-4 rounded-lg border border-brass/60 bg-brass/[0.08] px-3.5 py-2.5 text-sm leading-snug"
					role="status"
					data-answered-open
				>
					You answered “{sent.picks ?? choiceLabel(card, sent.choice)}” at {clock(sent.at)}
					<span class="text-muted-foreground">({ago(sent.at, now)})</span>. Firstmate hasn’t closed
					this yet.
					<span class="text-muted-foreground"
						>Answer again below, or chat with Firstmate about it.</span
					>
				</p>
			{/if}

			<!-- What is asked, in Firstmate's own words, whole, and the way down to the answer. -->
			{#if context}
				<div
					class="mt-4 rounded-lg border border-brass/45 bg-brass/[0.07] px-4 py-3"
					data-decision-ask
				>
					<p class="text-[0.68rem] font-bold tracking-[0.12em] text-brass uppercase">
						{mine ? 'What I need from you' : 'What was asked'}
					</p>
					<p
						class="mt-1 text-[1.02rem] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line"
					>
						<LinkedText text={context} />
					</p>
				</div>
			{/if}
			<a
				href="#decision-answer"
				class="mt-2 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-sea hover:underline max-md:min-h-11"
				onclick={(e) => {
					e.preventDefault();
					toAnswer();
				}}
				data-jump-answer><ArrowDown class="size-3.5" aria-hidden="true" />Jump to your answer</a
			>

			<!-- What it rests on, each part folded away at will: Firstmate's note, the work, the documents. -->
			{#if brief?.state === 'ok' || brief?.state === 'loading' || ev.text}
				<PaneSection id="background" title="Background">
					<div data-in-short>
						{#if brief?.state === 'ok'}
							<p class="text-[1.02rem] leading-relaxed">
								{brief.summary}
								<span
									class="ml-1 inline-flex items-center gap-1 align-middle text-xs text-muted-foreground"
									><Sparkles class="size-3" aria-hidden="true" />crew summary</span
								>
							</p>
						{:else if brief?.state === 'loading'}
							<p class="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
								<Sparkles class="size-3 animate-pulse" aria-hidden="true" />Reading what it rests
								on…
							</p>
						{/if}
					</div>
					{#if ev.text}
						<div class="chat-md mt-3 text-[0.95rem]" data-decision-background>
							{#if note}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
								{@html note}
							{:else}
								<p class="whitespace-pre-line">{ev.text}</p>
							{/if}
						</div>
					{/if}
				</PaneSection>
			{/if}

			{#if where}
				<PaneSection id="preview" title={ev.preview ? 'Live preview' : 'Where it is'}>
					<div data-decision-preview><DecisionWhere {card} inline /></div>
				</PaneSection>
			{/if}

			<PaneSection id="documents" title="Documents">
				<DecisionSource {card} />
				<DecisionLinks {card} where={false} />
				<DecisionRecords {card} />
			</PaneSection>

			<!-- The answer, last: the recommendation, and the full form when the calls need one. -->
			<PaneSection id="answer" title="Your answer" bind:open={answerOpen}>
				{#if draft}
					<p
						class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-sea/40 bg-sea/[0.07] px-3 py-2 text-sm"
						role="status"
						data-live-draft
					>
						<AudioLines class="size-3.5 text-sea" aria-hidden="true" />
						<span class="flex-1"
							>Filled in from your Live talk. Check it, then send it when you are ready.</span
						>
						<button
							type="button"
							class="cursor-pointer rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
							onclick={() => decisionDrafts.clear(card.id)}>Hide</button
						>
					</p>
				{/if}
				{#if card.recommendation}
					<p class="border-l-2 border-brass pl-3 text-sm leading-snug">
						<span class="font-medium">Firstmate recommends</span><span
							class="text-muted-foreground"
						>
							· <LinkedText text={card.recommendation.text} /></span
						>
					</p>
				{/if}
				{#if !quick.length}
					<!-- A question with several calls of its own is answered with its full form. -->
					<div class="mt-3" aria-label="Your answer">
						<DecisionForm {form} name={card.id} {canAnswer} {draft} onAnswer={answer} />
					</div>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground" data-answer-below>
						Pick an option below, or talk it over first.
					</p>
				{/if}
				<DecisionDetails
					{card}
					{expanded}
					withText={false}
					onToggle={() => (expanded = !expanded)}
				/>
			</PaneSection>

			<!-- The captain's questions, and the crew's short answers. -->
			{#if thread.messages.length || thread.thinking || thread.failed}
				<section class="mt-4 border-t border-hair pt-4" aria-label="Talking it over" data-ask>
					<ol bind:this={list} class="flex flex-col gap-4" aria-label="Questions and answers">
						{#each thread.messages as m, i (i)}
							{#if m.who === 'captain'}
								<li
									class="max-w-[85%] self-end rounded-2xl rounded-br-md bg-sea/10 px-3.5 py-2 text-[0.95rem]"
									data-ask-captain
								>
									{m.text}
								</li>
							{:else}
								<li class="flex gap-3" data-ask-crew>
									<span
										class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-brass/70 text-sea"
										aria-hidden="true"><AudioLines class="size-3.5" /></span
									>
									<div class="chat-md min-w-0 text-[0.95rem] leading-relaxed">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(m.text)}
									</div>
								</li>
							{/if}
						{/each}
						{#if thread.thinking}
							<li
								class="flex items-center gap-1.5 pl-10 text-xs text-muted-foreground"
								role="status"
							>
								<Sparkles class="size-3 animate-pulse" aria-hidden="true" />Thinking…
							</li>
						{/if}
					</ol>
					{#if thread.failed}
						<p class="mt-3 flex items-center gap-2 text-sm text-danger" role="alert">
							{thread.failed}
							<button
								type="button"
								class="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
								onclick={() => void briefs.retry(card.id, options, token)}
								><RotateCw class="size-3" aria-hidden="true" />Try again</button
							>
						</p>
					{/if}
				</section>
			{/if}

			<div class="mt-6 border-t border-hair/70 pt-2">
				<a
					href={chatAboutHref(card)}
					class={quiet}
					title="Start a message to Firstmate about this in the main chat; it waits as following up meanwhile"
					onclick={() => {
						if (!card.following) void inbox.follow(card, true, token);
					}}
					data-chat-about
					><MessageSquare class="size-3.5" aria-hidden="true" />Talk to Firstmate about this instead</a
				>
			</div>
		</div>
	</div>

	<!-- Pinned, like a chat's message box: pick an option, or talk about it. -->
	<footer class="shrink-0 border-t bg-panel px-8 pt-3 pb-3 max-md:px-3" data-pane-composer>
		<div class="mx-auto max-w-3xl">
			{#if agreed}
				<div
					class="mb-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-sea/40 bg-sea/[0.07] px-3 py-2"
					data-agreed
				>
					<p class="min-w-0 flex-1 text-sm">
						<span class="text-xs text-muted-foreground">The talk came to</span>
						<span class="block font-medium"
							><Check
								class="mr-1 inline size-3.5 text-success"
								aria-hidden="true"
							/>{agreed.label}</span
						>
					</p>
					<button
						type="button"
						class="inline-flex h-9 cursor-pointer items-center rounded-md bg-sea px-3 text-sm font-semibold text-on-accent hover:bg-sea/90 disabled:opacity-50"
						disabled={!canAnswer}
						onclick={() => agreed && answer(agreed.answer, null)}
						data-send-agreed>Send this answer</button
					>
				</div>
			{/if}
			{#if quick.length}
				<div
					class="mb-2.5 flex flex-wrap items-center gap-2"
					role="radiogroup"
					aria-label="Options"
					data-quick-picks
				>
					{#each quick as o, i (o.id)}
						{@const on = written === null && picked === o.id}
						<button
							type="button"
							role="radio"
							aria-checked={on}
							class="{pill} max-w-full {on
								? 'border-sea bg-sea/10 font-medium text-foreground'
								: 'bg-background text-foreground/85 hover:border-foreground/30'}"
							title={o.detail ?? o.label}
							onclick={() => {
								picked = o.id;
								written = null;
							}}
							data-quick-pick={i + 1}
							><span
								class="grid size-5 shrink-0 place-items-center rounded-md text-[0.72rem] leading-none font-semibold tabular-nums {on
									? 'bg-sea text-on-accent'
									: 'bg-muted text-muted-foreground'}">{i + 1}</span
							><span class="truncate">{o.label}</span>{#if o.recommended}<span
									class="text-xs leading-none font-normal text-brass">recommended</span
								>{/if}</button
						>
					{/each}
					<button
						type="button"
						role="radio"
						aria-checked={written !== null}
						class="{pill} {written !== null
							? 'border-sea bg-sea/10 font-medium text-foreground'
							: 'bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground'}"
						onclick={() => (written = written ?? '')}
						data-quick-other><PenLine class="size-3.5" aria-hidden="true" />Other</button
					>
					<button
						type="button"
						class="{pill} ml-auto border-sea bg-sea font-semibold text-on-accent hover:bg-sea/90 disabled:cursor-default disabled:opacity-40 max-md:w-full max-md:justify-center"
						disabled={!canAnswer || (written !== null ? !written.trim() : !choice)}
						onclick={decide}
						data-decide
						><Check class="size-4" aria-hidden="true" /><span class="max-w-[16rem] truncate"
							>{written !== null
								? 'Send your answer'
								: `Decide${choice ? `: ${choice.label}` : ''}`}</span
						></button
					>
				</div>
				{#if written !== null}
					<textarea
						bind:value={written}
						rows="2"
						maxlength={300}
						placeholder="Your own answer, in your words"
						aria-label="Your own answer"
						class="mb-2.5 block w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-sea/60 max-md:text-base"
						data-other-text></textarea>
				{/if}
			{/if}
			{#if error}<p class="mb-2 text-sm text-danger" role="alert">{error}</p>{/if}
			<form
				class="flex items-end gap-2 rounded-xl border bg-background py-1.5 pr-1.5 pl-3 focus-within:border-sea/60"
				onsubmit={(e) => {
					e.preventDefault();
					void ask(question);
				}}
			>
				<textarea
					bind:this={box}
					bind:value={question}
					rows="1"
					class="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground max-md:text-base"
					placeholder={thread.messages.length
						? 'Ask a follow-up…'
						: 'Talk about it: ask anything about this decision…'}
					aria-label="Ask the discussion crew about this decision"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							void ask(question);
						}
					}}></textarea>
				<MicButton field={box} target={() => fieldTarget(box!)} bind:listening size="sm" />
				<button
					type="submit"
					class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-sea text-on-accent disabled:cursor-default disabled:opacity-40"
					disabled={!question.trim() || thread.thinking}
					aria-label="Ask"><ArrowUp class="size-4" /></button
				>
			</form>
			{#if !thread.messages.length}
				<div class="mt-2 flex flex-wrap gap-1.5 max-sm:hidden">
					{#each SUGGESTED as s (s)}
						<button
							type="button"
							class="cursor-pointer rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							onclick={() => void ask(s)}>{s}</button
						>
					{/each}
				</div>
			{/if}
		</div>
	</footer>
</article>
