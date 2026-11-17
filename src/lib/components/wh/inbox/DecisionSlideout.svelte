<script lang="ts">
	/**
	 * The Decisions slide-out, over any page: the open decisions a badge or link
	 * is about (a task's, a project's, or every one), sorted as on the Decisions
	 * page, or one of them in full, answered here. The full decision is the
	 * Decisions page's own card (DecisionCard): its question, what it rests on,
	 * Firstmate's recommendation and the form that fits it, Chat with Firstmate
	 * about this, Ask me later and Dismiss. An answer goes through the inbox as
	 * everywhere else (one request, its own Idempotency-Key), so the card leaves
	 * every list at once and the slide-out moves on to the next one, then says
	 * when nothing is left. A dialog, as the task slide-out is: Escape, a click
	 * outside or Close shut it, and Back returns to what it replaced.
	 */
	import { onMount } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ArrowLeft, ArrowRight, ArrowUpRight, Check, X } from '@lucide/svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { agreeWith } from '$lib/client/agree';
	import { slideout } from '$lib/client/slideout.svelte';
	import { decisionCount, openDecisions, standing } from '$lib/decisionhome';
	import { awaitsAnswer, type InboxCard, type InboxView } from '$lib/inbox';
	import { fadeQuick } from '$lib/motion';
	import DecisionCard from './DecisionCard.svelte';
	import DecisionRow from './DecisionRow.svelte';

	const panel = $derived(slideout.panel?.kind === 'decisions' ? slideout.panel : null);
	// A dialog drawn already open does not show: a link that opens the page on a decision
	// (`/inbox#card-<id>`) opens it as the page loads, so it opens once this is drawn.
	let drawn = $state(false);
	onMount(() => {
		drawn = true;
	});
	const seed = $derived(page.data.inbox as InboxView | undefined);
	const view = $derived(inbox.view(seed));
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const cards = $derived(panel ? openDecisions(inbox.cards(seed), panel.filter) : []);
	// One already answered is never offered again: its answer is with Firstmate.
	const card = $derived(
		panel?.cardId
			? (inbox.cards(seed).find((c) => c.id === panel.cardId && awaitsAnswer(c)) ?? null)
			: null
	);
	// The card shown: the one asked for, or the only one there is.
	const shown = $derived(card ?? (!panel?.cardId && cards.length === 1 ? cards[0] : null));
	const index = $derived(shown ? cards.findIndex((c) => c.id === shown.id) : -1);
	const next = $derived(index >= 0 ? (cards[index + 1] ?? null) : (cards[0] ?? null));
	// An answer sent from here moves on; with nothing left, the slide-out says so.
	let answered = $state(false);
	let expanded = $state<Record<string, boolean>>({});

	const fleet = $derived(currentFleet());
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (fleet?.projects.find((p) => p.id === id)?.name ?? id);
	const scope = $derived.by(() => {
		if (!panel) return '';
		if (panel.label) return panel.label;
		const f = panel.filter;
		if (f.taskId) {
			const t = fleet?.tasks.find((x) => x.id === f.taskId);
			return t?.shortTitle ?? f.taskId;
		}
		if (f.projectId) return projectName(f.projectId) ?? f.projectId;
		return 'Every open decision';
	});
	const waiting = $derived(cards.filter((c) => standing(c) === 'waiting').length);
	const backLabel = $derived(
		shown && cards.length > 1 ? 'All' : slideout.back?.kind === 'task' ? 'Back to the task' : null
	);

	function back() {
		if (shown && cards.length > 1) slideout.pick(null);
		else slideout.goBack();
	}
	function open(c: InboxCard) {
		answered = false;
		slideout.pick(c.id);
	}
	/** An answer, dismissal or Ask me later from the card: on to the next one, if any. */
	function moveOn(from: InboxCard) {
		const i = cards.findIndex((c) => c.id === from.id);
		const n = cards[i + 1] ?? cards[i - 1] ?? null;
		answered = !n || n.id === from.id;
		slideout.pick(answered ? null : n!.id);
	}
	function later(c: InboxCard) {
		moveOn(c);
		inbox.later(c.id);
	}
	function agree(c: InboxCard) {
		void agreeWith(c, token);
	}

	let content = $state<HTMLElement | null>(null);
	// Escape leaves a decision's full-screen preview first (the dialog keeps the key from the
	// preview's own handler, so it is closed here); the slide-out stays.
	function escape(e: KeyboardEvent) {
		const open = document.querySelector('[data-preview-studio]');
		if (!open) return;
		e.preventDefault();
		open.querySelector<HTMLButtonElement>('button[aria-label^="Close full screen"]')?.click();
	}
	// A new card starts at its top.
	$effect(() => {
		void shown?.id;
		content?.querySelector('[data-decision-scroll]')?.scrollTo({ top: 0 });
	});
	$effect(() => {
		if (!panel) answered = false;
	});
	const onDecisionsPage = $derived(page.url.pathname === '/inbox');
	const pageHref = $derived(
		panel?.filter.projectId
			? `/inbox?project=${encodeURIComponent(panel.filter.projectId)}`
			: '/inbox'
	);
</script>

<Dialog.Root open={drawn && !!panel} onOpenChange={(o) => !o && slideout.close('decisions')}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
		/>
		<!-- bits-ui contains the panel's layout, which would hold a decision's full-screen
		     preview (fixed, inset 0) to the panel: here the panel contains nothing. -->
		<Dialog.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background text-foreground shadow-2xl duration-300 [contain:none]! outline-none md:w-[min(46rem,92vw)] md:border-l md:border-hair data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
			bind:ref={content}
			onEscapeKeydown={escape}
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				content?.focus();
			}}
			data-decision-slideout
		>
			<header
				class="flex h-14 shrink-0 items-center gap-2 border-b bg-header pr-2 pl-3 max-md:pl-2"
			>
				{#if backLabel}
					<button
						type="button"
						class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
						onclick={back}
						data-decision-back><ArrowLeft class="size-4" aria-hidden="true" />{backLabel}</button
					>
					<span class="h-5 w-px shrink-0 bg-hair" aria-hidden="true"></span>
				{/if}
				<div class="min-w-0 flex-1 pl-2">
					<Dialog.Title class="font-title text-xl leading-none">Decisions</Dialog.Title>
					<Dialog.Description class="mt-0.5 truncate text-xs text-muted-foreground"
						>{scope}{cards.length
							? ` · ${decisionCount(cards.length)} open${waiting ? `, ${waiting} waiting on you` : ''}`
							: ''}</Dialog.Description
					>
				</div>
				{#if !onDecisionsPage}
					<a
						href={pageHref}
						class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						onclick={(e) => {
							e.preventDefault();
							slideout.close();
							void goto(pageHref);
						}}
						data-decisions-page
						><ArrowUpRight class="size-4" aria-hidden="true" /><span class="max-sm:sr-only"
							>All decisions</span
						></a
					>
				{/if}
				<Dialog.Close
					class="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					aria-label="Close"><X class="size-5" aria-hidden="true" /></Dialog.Close
				>
			</header>

			<div
				class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
				data-decision-scroll
			>
				{#if view && !view.available}
					<p class="m-5 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
						{view.reason}
					</p>
				{:else if shown}
					{@const asked = slideout.forms[shown.id] ?? null}
					<div class="px-5 pt-5 pb-8 max-md:px-3 max-md:pt-3">
						{#if !view?.canAnswer}
							<p class="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
								Answers cannot be sent right now: {view?.reason ?? 'messaging to Firstmate is off.'}
							</p>
						{/if}
						{#if cards.length > 1 && index >= 0}
							<p class="mb-2 text-xs text-muted-foreground tabular-nums">
								{index + 1} of {cards.length}
							</p>
						{/if}
						{#key `${shown.id}:${asked?.key ?? ''}`}
							<DecisionCard
								card={shown}
								full
								project={projectName(shown.projectId)}
								expanded={!!expanded[shown.id]}
								canAnswer={view?.canAnswer ?? false}
								error={inbox.errors[shown.id] ?? null}
								now={live.now}
								form={asked?.form ?? null}
								refined={asked?.refined ?? false}
								onSent={() => moveOn(shown)}
								onLater={() => later(shown)}
								onToggle={() => (expanded[shown.id] = !expanded[shown.id])}
							/>
						{/key}
						{#if next && next.id !== shown.id}
							<button
								type="button"
								class="mt-4 flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
								onclick={() => open(next)}
								data-decision-next
							>
								<span class="shrink-0 text-xs text-muted-foreground">Next</span>
								<span class="min-w-0 flex-1 truncate font-medium">{next.title}</span>
								<ArrowRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						{/if}
					</div>
				{:else if cards.length}
					<div class="px-5 pt-4 pb-8 max-md:px-3">
						{#if answered}
							<p
								class="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
								role="status"
								in:fadeQuick
							>
								<Check class="size-4 text-success" aria-hidden="true" />Sent to Firstmate. These are
								still open:
							</p>
						{/if}
						<ol class="flex flex-col gap-2" aria-label="Open decisions">
							{#each cards as c (c.id)}
								<li>
									<DecisionRow
										card={c}
										project={projectName(c.projectId)}
										now={live.now}
										error={inbox.errors[c.id] ?? null}
										onOpen={() => open(c)}
										onAgree={view?.canAnswer && standing(c) === 'waiting'
											? () => agree(c)
											: undefined}
									/>
								</li>
							{/each}
						</ol>
					</div>
				{:else}
					<div class="grid place-items-center px-6 py-16 text-center" in:fadeQuick>
						<span
							class="grid size-12 place-items-center rounded-full bg-success/10 text-success"
							aria-hidden="true"><Check class="size-6" /></span
						>
						<p class="mt-4 font-title text-2xl">
							{answered ? 'All answered' : 'Nothing open here'}
						</p>
						<p class="mt-1 max-w-sm text-sm text-muted-foreground">
							{answered
								? 'Your answers are with Firstmate, which passes them on to the crew.'
								: 'No decision is waiting here. Firstmate will put the next one in Decisions.'}
						</p>
						<Dialog.Close
							class="mt-6 inline-flex h-10 cursor-pointer items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
							>Close</Dialog.Close
						>
					</div>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
