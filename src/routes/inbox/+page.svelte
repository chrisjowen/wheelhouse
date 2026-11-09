<script lang="ts">
	/**
	 * Decisions: what Firstmate escalated to the captain (Needs you), each with
	 * its evidence and Firstmate's recommendation, answered with one tap
	 * (Agree) or opened in the Firstmate chat (Chat about this), where it gets
	 * the form that fits it and can be talked through. Everything Firstmate is
	 * settling or has settled itself sits folded under Handled by Firstmate,
	 * where any of it can be taken over. An answer goes to Firstmate as a
	 * message, which relays it to the worker under its own rules, and the card
	 * leaves the stack at once (it stays, with the reason, if the answer was
	 * not taken). Close takes a question off the stack without an answer and
	 * asks Firstmate to record it resolved. A link to one card (#card-<id>, as
	 * the ship's bell's Open decision gives) opens it, showing it even if
	 * snoozed or handled. Keyboard: j/k move, a agrees, Enter opens it in the
	 * chat, e shows the evidence, l asks again later, c closes.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { agreeWith } from '$lib/client/agree';
	import { ago } from '$lib/format';
	import { changeCallHref, decisionHref, handled as handledOf } from '$lib/handled';
	import { closable, escalated, keyAction, type InboxCard } from '$lib/inbox';
	import DecisionCard from '$lib/components/wh/inbox/DecisionCard.svelte';
	import { fadeQuick, rise, STAMP_MS, stampOut } from '$lib/motion';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { Check, ChevronDown, Keyboard, Undo2 } from '@lucide/svelte';

	let { data } = $props();

	$effect(() => inbox.seed(data.inbox));
	const view = $derived(inbox.value ?? data.inbox);
	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const inScope = (id: string | null) => !scope || id === scope;
	const all = $derived(inbox.shown(live.now));
	const cards = $derived(all.shown.filter((c) => escalated(c) && inScope(c.projectId)));
	const snoozed = $derived(
		inbox
			.cards(data.inbox)
			.filter((c) => escalated(c) && inbox.snoozed[c.id] && inScope(c.projectId)).length
	);
	const made = $derived(data.handled.available ? data.handled.decisions : []);
	const theirs = $derived(
		handledOf(
			inbox.cards(data.inbox).filter((c) => inScope(c.projectId)),
			made.filter((d) => inScope(d.projectId)),
			live.now
		)
	);
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (fleet?.projects.find((p) => p.id === id)?.name ?? id);

	let activeId = $state<string | null>(null);
	let expanded = $state<Record<string, boolean>>({});
	let handledOpen = $state(false);
	let openCall = $state<Record<string, boolean>>({});
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
		if (i < 0) return null;
		return cards[i + 1] ?? cards[i - 1] ?? null;
	}

	async function moveTo(c: InboxCard | null) {
		if (!c) return;
		activeId = c.id;
		await tick();
		document.getElementById(`card-${c.id}`)?.scrollIntoView({ block: 'nearest' });
	}

	const focus = (i: number) => moveTo(cards[Math.min(Math.max(i, 0), cards.length - 1)] ?? null);

	async function agree(c: InboxCard) {
		if (!view.canAnswer) return;
		const next = after(c);
		const sent = agreeWith(c, data.sessionToken);
		if (!inbox.errors[c.id]) void moveTo(next);
		await sent;
	}

	async function close(c: InboxCard) {
		if (!view.canAnswer) return;
		const next = after(c);
		const sent = inbox.answer(c, 'close', null, data.sessionToken);
		if (!inbox.errors[c.id]) void moveTo(next);
		await sent;
	}

	function later(c: InboxCard) {
		void moveTo(after(c));
		inbox.later(c.id);
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		// Keys inside an overlay (the task sheet, a preview, a screenshot) are not for the cards behind it.
		if (t?.closest?.('dialog, [role="dialog"]')) return;
		// Enter on a focused link or button keeps its own meaning.
		if (e.key === 'Enter' && t && /^(A|BUTTON|SUMMARY)$/.test(t.tagName)) return;
		const a = keyAction(e.key);
		if (!a || !cards.length) return;
		e.preventDefault();
		const c = active ?? cards[0];
		if (a.do === 'move') void focus(activeIndex + a.by);
		else if (a.do === 'evidence') expanded[c.id] = !expanded[c.id];
		else if (a.do === 'later') later(c);
		else if (a.do === 'chat') void goto(decisionHref(c.id));
		else if (a.do === 'agree') void agree(c);
		else if (a.do === 'close' && closable(c)) void close(c);
	}

	/** Open the card a link names (#card-<id>), on arrival or when the link changes here. */
	function openLinked(hash: string) {
		if (!hash.startsWith('#card-')) return;
		const id = decodeURIComponent(hash.slice('#card-'.length));
		if (!id) return;
		inbox.wake(id);
		if (theirs.open.some((c) => c.id === id)) handledOpen = true;
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
					What Firstmate needs from you, in plain words with its recommendation. Agree from here, or
					chat it through with Firstmate first. Firstmate settles everything else itself and lists
					it under Handled by Firstmate, where you can change any of its calls.
				</p>
			</div>
			<p class="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
				<Keyboard class="size-3.5" aria-hidden="true" />
				<kbd class="kbd">j</kbd><kbd class="kbd">k</kbd> move ·
				<kbd class="kbd">a</kbd> agree · <kbd class="kbd">Enter</kbd> chat ·
				<kbd class="kbd">e</kbd> evidence · <kbd class="kbd">l</kbd> later ·
				<kbd class="kbd">c</kbd> close
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
				<h2 class="font-sans text-base font-medium">Needs you</h2>
				<span class="text-muted-foreground"
					>{cards.length === 0
						? 'nothing waiting'
						: `${cards.length} ${cards.length === 1 ? 'question' : 'questions'} waiting`}</span
				>
				{#if snoozed}
					<button
						class="cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						onclick={() => inbox.wake()}>· {snoozed} for later: show them now</button
					>
				{/if}
				{#if scope}
					<a href="/inbox" class="text-muted-foreground hover:text-foreground"
						>· {projectName(scope) ?? scope} only: show all projects</a
					>
				{/if}
			</div>

			<!-- The list stays while its last question leaves, so it can be seen going. -->
			<ol class="mt-4 flex max-w-3xl flex-col gap-3" aria-label="Questions for you">
				{#each cards as c, i (c.id)}
					<li class="relative" in:rise out:stampOut={{ word: inbox.stampFor(c.id) }}>
						<DecisionCard
							card={c}
							project={projectName(c.projectId)}
							active={i === activeIndex}
							expanded={!!expanded[c.id]}
							shortcuts
							canAnswer={view.canAnswer}
							error={inbox.errors[c.id] ?? null}
							now={live.now}
							onAgree={() => agree(c)}
							onLater={() => later(c)}
							onClose={() => close(c)}
							onToggle={() => (expanded[c.id] = !expanded[c.id])}
							onFocus={() => (activeId = c.id)}
						/>
					</li>
				{/each}
			</ol>
			{#if cards.length === 0}
				<!-- Once the last question has gone. -->
				<p
					class="flex max-w-3xl items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
					in:fadeQuick={{ delay: STAMP_MS }}
				>
					<Check class="size-4 text-success" aria-hidden="true" />Nothing needs you. Firstmate will
					put the next question for you here.
				</p>
			{/if}

			<!-- Folded to a count: nothing here waits on the captain. -->
			<section class="mt-10 max-w-3xl" aria-labelledby="handled" data-handled>
				<button
					class="flex w-full cursor-pointer items-center gap-2 text-left"
					aria-expanded={handledOpen}
					aria-controls="handled-list"
					onclick={() => (handledOpen = !handledOpen)}
				>
					<h2 id="handled" class="font-sans text-base font-medium">Handled by Firstmate</h2>
					<span class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
						>{theirs.count}</span
					>
					<span class="text-sm text-muted-foreground">· nothing for you to do</span>
					<ChevronDown
						class="ml-auto size-4 text-muted-foreground transition-transform {handledOpen
							? 'rotate-180'
							: ''}"
						aria-hidden="true"
					/>
				</button>
				{#if handledOpen}
					<div id="handled-list">
						<p class="mt-1 max-w-prose text-sm text-muted-foreground">
							Questions Firstmate is settling itself, and the calls it made this week, so the work
							did not wait. Open one to see why, or take it over.
						</p>
						{#if theirs.count === 0}
							<p class="mt-3 text-sm text-muted-foreground">Nothing this week.</p>
						{/if}
						{#if theirs.open.length}
							<h3 class="mt-4 text-xs font-medium text-muted-foreground">Settling now</h3>
							<ol class="mt-2 flex flex-col gap-3" aria-label="Questions Firstmate is settling">
								{#each theirs.open as c (c.id)}
									<li>
										<DecisionCard
											card={c}
											project={projectName(c.projectId)}
											expanded={!!expanded[c.id]}
											canAnswer={view.canAnswer}
											error={inbox.errors[c.id] ?? null}
											now={live.now}
											onAgree={() => agree(c)}
											onClose={() => close(c)}
											onToggle={() => (expanded[c.id] = !expanded[c.id])}
										/>
									</li>
								{/each}
							</ol>
						{/if}
						{#if theirs.made.length}
							<h3 class="mt-5 text-xs font-medium text-muted-foreground">Decided this week</h3>
							<ul class="mt-2 divide-y divide-hair/70 rounded-lg border bg-card" data-made>
								{#each theirs.made as d (d.id)}
									{@const call = d.calls[0]}
									<li>
										<button
											class="flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/40 sm:px-5"
											aria-expanded={!!openCall[d.id]}
											onclick={() => (openCall[d.id] = !openCall[d.id])}
										>
											<span class="min-w-0 flex-1">
												<span class="block text-sm leading-snug"
													>{call.question}{#if d.calls.length > 1}<span
															class="text-muted-foreground"
															>{` and ${d.calls.length - 1} more`}</span
														>{/if}</span
												>
												<span
													class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
												>
													{#if projectName(d.projectId)}<span
															class="rounded-sm border px-1 text-[0.8rem] leading-[0.95rem] font-semibold tracking-[0.08em] [font-variant-caps:all-small-caps]"
															>{projectName(d.projectId)}</span
														>{/if}
													<span
														>Firstmate: <span class="font-medium text-foreground">{d.verdict}</span
														></span
													>
													<span>· {ago(d.decidedAt, live.now)}</span>
												</span>
											</span>
											<ChevronDown
												class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform {openCall[
													d.id
												]
													? 'rotate-180'
													: ''}"
												aria-hidden="true"
											/>
										</button>
										{#if openCall[d.id]}
											<div class="px-4 pb-3.5 sm:px-5">
												<p class="text-xs text-muted-foreground">On {d.taskTitle}</p>
												{#each d.calls as c, i (i)}
													<div class="mt-2 border-l-2 border-sea/60 pl-3">
														{#if d.calls.length > 1}<p class="text-sm font-medium">
																{c.question}
															</p>{/if}
														<p class="text-xs text-muted-foreground">
															Why Firstmate chose <span class="font-medium text-foreground"
																>{c.verdict}</span
															>
														</p>
														<p class="mt-0.5 text-sm leading-relaxed whitespace-pre-line">
															{c.reason || 'No reason was recorded.'}
														</p>
														{#if c.detail && c.detail !== c.question}
															<details class="mt-1.5 text-xs text-muted-foreground">
																<summary class="cursor-pointer hover:text-foreground"
																	>What the reviewer wrote</summary
																>
																<p class="mt-1 leading-relaxed"><LinkedText text={c.detail} /></p>
															</details>
														{/if}
													</div>
												{/each}
												<div class="mt-2.5 flex flex-wrap items-center gap-2">
													<a
														href={changeCallHref(d)}
														class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
														data-change-call
														><Undo2 class="size-3.5" aria-hidden="true" />Change this call</a
													>
													<span class="text-xs text-muted-foreground"
														>{d.landed
															? 'Already landed, so a change would be a follow-up.'
															: 'Not landed yet, so a change can still go into the work.'}</span
													>
												</div>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</main>
