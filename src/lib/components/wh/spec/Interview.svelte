<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ArrowUp, Compass, LoaderCircle, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import DictateTextarea from '$lib/components/wh/DictateTextarea.svelte';
	import { markdown } from '$lib/chat/markdown';
	import { dictation } from '$lib/voice/dictation.svelte';
	import type { SpecDraft } from '$lib/spec';

	/**
	 * The interview: the agent asks one question at a time, offering answers
	 * with the one it recommends; the captain answers in their own words (or
	 * dictates, or picks an offered answer to start from). The agent's message
	 * streams in as it is written.
	 */
	let {
		draft,
		busy,
		streaming,
		activity,
		error,
		pending,
		model,
		effort,
		onAnswer,
		onRetry
	}: {
		draft: SpecDraft;
		busy: boolean;
		/** The agent's message so far, while it writes. */
		streaming: string;
		/** What the agent is looking at in the project, while it does. */
		activity: string | null;
		error: string | null;
		/** What the captain just said, shown until the interview's record of it arrives. */
		pending: string | null;
		model: string;
		effort: string;
		onAnswer: (text: string) => Promise<boolean>;
		onRetry: () => void;
	} = $props();

	let answer = $state('');
	let mounted = $state(false);
	let log: HTMLDivElement | undefined = $state();
	onMount(() => (mounted = true));

	const turns = $derived(draft.interview.turns);
	const started = $derived(turns.length > 0);
	const last = $derived(turns.at(-1));
	const offered = $derived(!busy && last?.role === 'agent' ? last : null);
	// A failed turn leaves the captain's answer without a reply: offer to ask again.
	const unanswered = $derived(!busy && last?.role === 'captain');
	const usage = $derived(draft.interview.usage);

	// Keep the newest message in view as it arrives.
	$effect(() => {
		void turns.length;
		void streaming;
		void busy;
		void pending;
		void tick().then(() => log?.scrollTo({ top: log.scrollHeight }));
	});

	async function send() {
		// Keep any words still being dictated, and stop listening.
		if (dictation.phase !== 'idle') dictation.commit();
		const text = answer.trim();
		if (!text || busy) return;
		const before = answer;
		answer = '';
		if (!(await onAnswer(text))) answer = before;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void send();
		}
	}

	async function pick(option: string) {
		answer = option;
		await tick();
		const box = log?.parentElement?.querySelector<HTMLTextAreaElement>('textarea[data-answer]');
		box?.focus();
		box?.setSelectionRange(box.value.length, box.value.length);
	}

	const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
	const usageNote = $derived(
		usage.turns
			? ` · ${usage.turns} turn${usage.turns === 1 ? '' : 's'}, ${tokens(usage.inputTokens)} tokens in, ${tokens(usage.outputTokens)} out${usage.costUsd > 0 ? `, about $${usage.costUsd.toFixed(2)} at API prices` : ''}`
			: ''
	);
</script>

{#snippet agentHead()}
	<span
		class="flex size-7 shrink-0 items-center justify-center rounded-full border border-brass bg-card text-sea"
		aria-hidden="true"><Compass class="size-4" /></span
	>
{/snippet}

<div class="flex min-h-0 flex-col">
	<div
		bind:this={log}
		class="max-h-[65dvh] min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 xl:max-h-[calc(100dvh-20rem)]"
		aria-live="polite"
		aria-busy={busy}
	>
		{#if !started}
			<div class="rounded-lg border border-dashed border-hair p-5">
				<h2 class="font-display text-xl font-medium">What do you want built?</h2>
				<p class="mt-2 max-w-prose text-sm text-muted-foreground">
					Describe the idea in a sentence or two. The interviewer asks one question at a time,
					offers answers with the one it recommends, and writes the spec alongside as you go.
					Comment on anything in the spec and it will be addressed. When it is ready, send it to
					build.
				</p>
			</div>
		{/if}
		{#each turns as t, i (i)}
			{#if t.role === 'agent'}
				<div class="flex items-start gap-3">
					{@render agentHead()}
					<div class="min-w-0 flex-1">
						<p class="mb-1 text-xs text-muted-foreground">
							<span class="font-semibold text-foreground">Interviewer</span>
						</p>
						<div class="bubble bubble-firstmate chat-md text-[0.95rem]">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
							{#if mounted}{@html markdown(t.text)}{:else}{t.text}{/if}
						</div>
						{#if offered === t && t.options.length}
							<div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Suggested answers">
								{#each t.options as o, k (k)}
									<button
										class="rounded-md border px-3 py-1.5 text-left text-sm hover:bg-accent {t.recommended ===
										k
											? 'border-brass bg-card'
											: 'border-hair bg-card'}"
										onclick={() => pick(o)}
									>
										{o}
										{#if t.recommended === k}<span
												class="ml-1.5 text-[0.7rem] font-medium tracking-wide text-brass uppercase"
												>Recommended</span
											>{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<div class="flex justify-end">
					<div class="bubble bubble-captain max-w-[85%] text-[0.95rem]">{t.text}</div>
				</div>
			{/if}
		{/each}
		{#if pending}
			<div class="flex justify-end">
				<div class="bubble bubble-captain max-w-[85%] text-[0.95rem]">{pending}</div>
			</div>
		{/if}
		{#if busy}
			<div class="flex items-start gap-3">
				{@render agentHead()}
				<div class="min-w-0 flex-1">
					<p class="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
						<span class="font-semibold text-foreground">Interviewer</span>
						<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />
						{activity ?? (streaming ? 'Writing…' : 'Thinking…')}
					</p>
					{#if streaming}
						<div class="bubble bubble-firstmate chat-md text-[0.95rem]">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by markdown() -->
							{#if mounted}{@html markdown(streaming)}{:else}{streaming}{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
		{#if draft.interview.done && !busy && last?.role === 'agent'}
			<p class="rounded-md border border-sea/40 bg-sea/5 px-4 py-3 text-sm">
				The interviewer thinks the spec is ready. Read it over, comment on anything that is off, and
				send it to build when you are happy. You can keep answering to add more.
			</p>
		{/if}
		{#if error}
			<div
				class="flex flex-wrap items-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3"
				role="alert"
			>
				<p class="min-w-0 flex-1 text-sm text-danger">{error}</p>
				{#if unanswered}
					<Button variant="outline" size="sm" onclick={onRetry}>
						<RotateCcw aria-hidden="true" />Try again
					</Button>
				{/if}
			</div>
		{:else if unanswered}
			<div class="flex items-center gap-3 text-sm text-muted-foreground">
				Your last answer has no reply yet.
				<Button variant="outline" size="sm" onclick={onRetry}>
					<RotateCcw aria-hidden="true" />Ask the interviewer
				</Button>
			</div>
		{/if}
	</div>

	<div class="mt-4 border-t border-hair pt-4">
		<label for="spec-answer" class="sr-only"
			>{started ? 'Your answer' : 'What you want built'}</label
		>
		<div class="flex items-end gap-2">
			<div class="min-w-0 flex-1">
				<DictateTextarea
					id="spec-answer"
					data-answer
					bind:value={answer}
					rows={started ? 2 : 3}
					placeholder={started
						? 'Answer in your own words, or pick a suggestion…'
						: 'e.g. Let a family add their trip photos to one shared album'}
					{onkeydown}
					class="bg-card text-[0.95rem]"
				/>
			</div>
			<Button
				size="icon"
				onclick={send}
				disabled={busy || !answer.trim()}
				aria-label={started ? 'Send answer' : 'Start the interview'}
				title="Send (Enter)"
			>
				{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else}<ArrowUp
						aria-hidden="true"
					/>{/if}
			</Button>
		</div>
		<p class="mt-2 text-xs text-muted-foreground">
			Enter sends, Shift+Enter starts a new line. Interviewer: Claude {model}, {effort} effort, read-only{usageNote}.
		</p>
	</div>
</div>
