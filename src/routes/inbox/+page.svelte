<script lang="ts">
	/**
	 * Decisions: every open question in one stack (review findings, worker
	 * decisions, captain holds and merge calls), each with its evidence, its
	 * options and Firstmate's recommendation. An answer goes to Firstmate as a
	 * message, which relays it to the worker under its own rules, and the card
	 * leaves the stack at once (it stays, with the reason, if the answer was not
	 * taken). Close takes a question off the stack without an answer and asks
	 * Firstmate to record it resolved. A link to one card (#card-<id>, as the
	 * ship's bell's Open decision gives) opens it, showing it even if snoozed.
	 * Keyboard: j/k move, a/f/s answer, l asks again later, c closes, Enter opens the evidence.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { closable, keyAction, type InboxAction, type InboxCard, type Picks } from '$lib/inbox';
	import DecisionCard from '$lib/components/wh/inbox/DecisionCard.svelte';
	import { Check, Keyboard } from '@lucide/svelte';

	let { data } = $props();

	$effect(() => inbox.seed(data.inbox));
	const view = $derived(inbox.value ?? data.inbox);
	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const all = $derived(inbox.shown(live.now));
	const cards = $derived(all.shown.filter((c) => !scope || c.projectId === scope));
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (fleet?.projects.find((p) => p.id === id)?.name ?? id);

	let activeId = $state<string | null>(null);
	let expanded = $state<Record<string, boolean>>({});
	let notes = $state<Record<string, string>>({});
	/** The captain's picks on cards with choices, by card (recommended ones fill the rest). */
	let picks = $state<Record<string, Picks>>({});
	const activeIndex = $derived(
		Math.max(
			0,
			cards.findIndex((c) => c.id === activeId)
		)
	);
	const active = $derived(cards[activeIndex] ?? null);

	/** The card to move on to once this one leaves the stack: the next, else the one before. */
	function after(from: InboxCard): InboxCard | null {
		const i = cards.findIndex((c) => c.id === from.id);
		return cards[i + 1] ?? cards[i - 1] ?? null;
	}

	async function moveTo(c: InboxCard | null) {
		if (!c) return;
		activeId = c.id;
		await tick();
		document.getElementById(`card-${c.id}`)?.scrollIntoView({ block: 'nearest' });
	}

	const focus = (i: number) => moveTo(cards[Math.min(Math.max(i, 0), cards.length - 1)] ?? null);

	async function answer(c: InboxCard, choice: InboxAction) {
		if (!view.canAnswer) return;
		const next = after(c);
		const note = notes[c.id]?.trim() || null;
		const sent = inbox.answer(c, choice, note, data.sessionToken, picks[c.id] ?? null);
		// The card leaves at once; one still missing a pick stays in focus, saying which.
		if (!inbox.errors[c.id]) void moveTo(next);
		if (await sent) {
			notes[c.id] = '';
			picks[c.id] = {};
		}
	}

	function later(c: InboxCard) {
		void moveTo(after(c));
		inbox.later(c.id);
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		// Enter on a focused link or button keeps its own meaning.
		if (e.key === 'Enter' && t && /^(A|BUTTON|SUMMARY)$/.test(t.tagName)) return;
		const a = keyAction(e.key);
		if (!a || !cards.length) return;
		e.preventDefault();
		const c = active ?? cards[0];
		if (a.do === 'move') void focus(activeIndex + a.by);
		else if (a.do === 'evidence') expanded[c.id] = !expanded[c.id];
		else if (a.do === 'later') later(c);
		else if (a.do === 'close') {
			if (closable(c)) void answer(c, 'close');
		} else void answer(c, a.choice);
	}

	/** Open the card a link names (#card-<id>), on arrival or when the link changes here. */
	function openLinked(hash: string) {
		if (!hash.startsWith('#card-')) return;
		const id = decodeURIComponent(hash.slice('#card-'.length));
		if (!id) return;
		inbox.wake(id);
		activeId = id;
		expanded[id] = true;
		void tick().then(() => document.getElementById(`card-${id}`)?.scrollIntoView());
	}

	onMount(() => {
		inbox.load();
		void inbox.read();
	});
	$effect(() => {
		const hash = page.url.hash;
		untrack(() => openLinked(hash));
	});
</script>

<svelte:head><title>Decisions · Wheelhouse</title></svelte:head>
<svelte:window onkeydown={onKey} />

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-4 py-5 sm:px-8 sm:py-8">
		<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
			<div>
				<h1 class="text-2xl">Decisions</h1>
				<p class="mt-1 max-w-prose text-sm text-muted-foreground">
					Every open question in one place: review findings, decisions the crew raised, work held
					for you and pull requests waiting for the word to merge. Your answer goes to Firstmate,
					which passes it on to the worker.
				</p>
			</div>
			<p class="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
				<Keyboard class="size-3.5" aria-hidden="true" />
				<kbd class="kbd">j</kbd><kbd class="kbd">k</kbd> move ·
				<kbd class="kbd">a</kbd> approve · <kbd class="kbd">f</kbd> fix ·
				<kbd class="kbd">s</kbd> skip · <kbd class="kbd">l</kbd> later ·
				<kbd class="kbd">c</kbd> close ·
				<kbd class="kbd">Enter</kbd> evidence
			</p>
		</div>

		{#if !view.available}
			<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{view.reason}
			</p>
		{:else}
			{#if !view.canAnswer}
				<p class="mt-6 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
					Answers cannot be sent right now: {view.reason ?? 'messaging to Firstmate is off.'}
				</p>
			{/if}
			<div class="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
				<span class="font-medium"
					>{cards.length === 0
						? 'Nothing waiting'
						: `${cards.length} ${cards.length === 1 ? 'question' : 'questions'} waiting`}</span
				>
				{#if all.snoozed}
					<button
						class="cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						onclick={() => inbox.wake()}>· {all.snoozed} for later: show them now</button
					>
				{/if}
				{#if scope}
					<a href="/inbox" class="text-muted-foreground hover:text-foreground"
						>· {projectName(scope) ?? scope} only: show all projects</a
					>
				{/if}
			</div>

			{#if cards.length === 0}
				<p
					class="mt-6 flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
				>
					<Check class="size-4 text-success" aria-hidden="true" />No open questions. Firstmate will
					put the next one here.
				</p>
			{:else}
				<ol class="mt-4 flex max-w-3xl flex-col gap-3" aria-label="Open questions">
					{#each cards as c, i (c.id)}
						<li>
							<DecisionCard
								card={c}
								project={projectName(c.projectId)}
								active={i === activeIndex}
								expanded={!!expanded[c.id]}
								shortcuts
								canAnswer={view.canAnswer}
								error={inbox.errors[c.id] ?? null}
								bind:note={() => notes[c.id] ?? '', (v) => (notes[c.id] = v)}
								bind:picks={() => picks[c.id] ?? {}, (v) => (picks[c.id] = v)}
								now={live.now}
								onAnswer={(choice) => answer(c, choice)}
								onLater={() => later(c)}
								onClose={() => answer(c, 'close')}
								onToggle={() => (expanded[c.id] = !expanded[c.id])}
								onFocus={() => (activeId = c.id)}
							/>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
	</div>
</main>
