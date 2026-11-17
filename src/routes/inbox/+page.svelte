<script lang="ts">
	/**
	 * Decisions: the one place every open decision lives. One list, sorted by
	 * what needs the captain first (the work waits on them, then those followed
	 * up in the chat, then those Firstmate is handling itself, each waiting
	 * longest first) or by age, and filtered by project and type. Each line says
	 * what it is, its project and task and how long it has waited; selecting it
	 * opens the decision in the Decisions slide-out, where it is read in full
	 * and answered (DecisionSlideout), and a line Firstmate has a recommendation
	 * on can be agreed from the line. The chat, On deck and the task pages link
	 * here through badges instead of copies. The calls Firstmate made itself this
	 * week sit folded below, where any of them can be taken over. A link to one
	 * card (#card-<id>, as the ship's bell's Open decision gives) opens it,
	 * showing it even if asked about later. Keyboard: j/k move, Enter or o
	 * opens, a agrees, l asks again later.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURL } from 'svelte/reactivity';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { agreeWith } from '$lib/client/agree';
	import { slideout } from '$lib/client/slideout.svelte';
	import { ago } from '$lib/format';
	import { changeCallHref, handled as handledOf } from '$lib/handled';
	import {
		KIND_LABEL,
		KIND_ORDER,
		SORTS,
		STANDING_LABEL,
		inFilter,
		sortDecisions,
		standing,
		type DecisionFilter,
		type DecisionSort,
		type Standing
	} from '$lib/decisionhome';
	import { awaitsAnswer, type InboxCard, type InboxKind } from '$lib/inbox';
	import { rise, stampOut, fadeQuick, STAMP_MS } from '$lib/motion';
	import DecisionRow from '$lib/components/wh/inbox/DecisionRow.svelte';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { Check, ChevronDown, Keyboard, Undo2 } from '@lucide/svelte';

	let { data } = $props();

	$effect(() => inbox.seed(data.inbox));
	const view = $derived(inbox.value ?? data.inbox);
	const fleet = $derived(currentFleet());
	const token = $derived(data.sessionToken ?? '');

	// The filters and the order live in the address, so a link (a project's badge) opens on them.
	const project = $derived(page.url.searchParams.get('project'));
	const kindParam = $derived(page.url.searchParams.get('type'));
	const kind = $derived(
		KIND_ORDER.includes(kindParam as InboxKind) ? (kindParam as InboxKind) : null
	);
	const sortParam = $derived(page.url.searchParams.get('sort'));
	const sort = $derived<DecisionSort>(
		SORTS.some((s) => s.id === sortParam) ? (sortParam as DecisionSort) : 'needs'
	);
	const filter = $derived<DecisionFilter>({ projectId: project, kind });

	function setParam(key: string, value: string | null) {
		const url = new SvelteURL(page.url);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		url.hash = '';
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	const all = $derived(inbox.cards(data.inbox));
	// Every open question; those asked about later in this browser wait off the list.
	const open = $derived(all.filter(awaitsAnswer));
	const shownNow = $derived(inbox.shown(live.now, data.inbox).shown);
	const snoozed = $derived(open.length - shownNow.length);
	const inProject = $derived(shownNow.filter((c) => inFilter(c, { projectId: project })));
	const cards = $derived(
		sortDecisions(
			shownNow.filter((c) => inFilter(c, filter)),
			sort
		)
	);
	const waiting = $derived(cards.filter((c) => standing(c) === 'waiting').length);
	// The order the default sort reads in, under a heading each.
	const groups = $derived.by(() => {
		if (sort !== 'needs') return [{ id: null as Standing | null, cards }];
		const order: Standing[] = ['waiting', 'following', 'firstmate'];
		return order
			.map((id) => ({ id: id as Standing | null, cards: cards.filter((c) => standing(c) === id) }))
			.filter((g) => g.cards.length);
	});

	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (fleet?.projects.find((p) => p.id === id)?.name ?? id);
	// The projects and types that have something open, to filter by.
	const projects = $derived(
		[...new Set(shownNow.map((c) => c.projectId).filter((p): p is string => !!p))]
			.map((id) => ({ id, name: projectName(id) ?? id }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const kinds = $derived(
		KIND_ORDER.map((k) => ({ id: k, n: inProject.filter((c) => c.kind === k).length })).filter(
			(k) => k.n > 0 || k.id === kind
		)
	);

	const made = $derived(data.handled.available ? data.handled.decisions : []);
	const theirs = $derived(
		handledOf(
			[],
			made.filter((d) => !project || d.projectId === project),
			live.now
		)
	);
	let handledOpen = $state(false);
	let openCall = $state<Record<string, boolean>>({});

	let activeId = $state<string | null>(null);
	const activeIndex = $derived(
		Math.max(
			0,
			cards.findIndex((c) => c.id === activeId)
		)
	);

	function openCard(c: InboxCard) {
		activeId = c.id;
		slideout.openDecisions(filter, c.id);
	}
	async function focus(i: number) {
		const c = cards[Math.min(Math.max(i, 0), cards.length - 1)];
		if (!c) return;
		activeId = c.id;
		await tick();
		document
			.getElementById(`row-${c.id}`)
			?.querySelector<HTMLElement>('[data-open-decision-row]')
			?.focus();
	}
	function agree(c: InboxCard) {
		if (!view.canAnswer) return;
		void agreeWith(c, token);
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		// While an overlay (the slide-out, a preview) is open, keys are not for the list behind it.
		if (t?.closest?.('dialog, [role="dialog"]')) return;
		if (document.querySelector('[aria-modal="true"], dialog[open], [data-preview-studio]')) return;
		if (e.key === 'Enter' && t && /^(A|BUTTON|SUMMARY)$/.test(t.tagName)) return;
		if (!cards.length) return;
		const c = cards[activeIndex] ?? cards[0];
		const keys: Record<string, () => void> = {
			j: () => void focus(activeIndex + 1),
			ArrowDown: () => void focus(activeIndex + 1),
			k: () => void focus(activeIndex - 1),
			ArrowUp: () => void focus(activeIndex - 1),
			Enter: () => openCard(c),
			o: () => openCard(c),
			a: () => standing(c) === 'waiting' && agree(c),
			l: () => {
				inbox.later(c.id);
				void focus(activeIndex);
			}
		};
		const run = keys[e.key];
		if (!run) return;
		e.preventDefault();
		run();
	}

	/** Open the card a link names (#card-<id>), on arrival or when the link changes here. */
	function openLinked(hash: string) {
		if (!hash.startsWith('#card-')) return;
		const id = decodeURIComponent(hash.slice('#card-'.length));
		if (!id) return;
		inbox.wake(id);
		activeId = id;
		slideout.openDecisions({}, id);
	}

	onMount(() => {
		inbox.load();
		void inbox.read();
	});
	$effect(() => {
		const hash = page.url.hash;
		untrack(() => openLinked(hash));
	});

	const chip = (on: boolean) =>
		`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
			on
				? 'border-foreground bg-foreground font-medium text-background'
				: 'text-foreground/80 hover:border-foreground/40 hover:text-foreground'
		}`;
	const select =
		'h-8 min-w-0 cursor-pointer max-sm:h-10 max-sm:w-full rounded-md border bg-background pr-7 pl-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring';
</script>

<svelte:head><title>Decisions · Wheelhouse</title></svelte:head>
<svelte:window onkeydown={onKey} />

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-4 py-5 sm:px-8 sm:py-8">
		<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
			<div class="max-w-prose">
				<h1 class="text-2xl">Decisions</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Every open decision, in one place: what holds up work waiting on you first, then the rest.
					Open one to see what it rests on and answer it.
				</p>
			</div>
			<p class="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
				<Keyboard class="size-3.5" aria-hidden="true" />
				<kbd class="kbd">j</kbd><kbd class="kbd">k</kbd> move · <kbd class="kbd">o</kbd> open ·
				<kbd class="kbd">a</kbd> agree · <kbd class="kbd">l</kbd> later
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

			<!-- What is open, at a glance. -->
			<div class="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1" data-decisions-summary>
				<p class="font-title text-3xl leading-none">
					{#if waiting}<span class="text-sea">{waiting}</span>
						<span class="text-xl">waiting on you</span>{:else}<span class="text-xl"
							>Nothing waiting on you</span
						>{/if}
				</p>
				<p class="text-sm text-muted-foreground">
					{cards.length}
					open{project || kind ? ' here' : ''}{snoozed
						? ` · ${snoozed} asked about later`
						: ''}{#if snoozed}
						<button
							class="ml-1 cursor-pointer underline-offset-2 hover:text-foreground hover:underline"
							onclick={() => inbox.wake()}>show them now</button
						>{/if}
				</p>
			</div>

			<!-- Filters: project, type, and the order. -->
			<div
				class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-hair py-3"
				data-decision-filters
			>
				<div
					class="-mx-1 no-scrollbar flex max-w-full min-w-0 flex-1 gap-1.5 overflow-x-auto px-1"
					role="radiogroup"
					aria-label="Type"
				>
					<button
						role="radio"
						aria-checked={!kind}
						class={chip(!kind)}
						onclick={() => setParam('type', null)}
						>All <span class="font-mono text-xs opacity-70">{inProject.length}</span></button
					>
					{#each kinds as k (k.id)}
						<button
							role="radio"
							aria-checked={kind === k.id}
							class={chip(kind === k.id)}
							onclick={() => setParam('type', kind === k.id ? null : k.id)}
							data-kind={k.id}
							>{KIND_LABEL[k.id]} <span class="font-mono text-xs opacity-70">{k.n}</span></button
						>
					{/each}
				</div>
				<div class="flex shrink-0 items-center gap-2 max-sm:w-full">
					{#if projects.length > 1 || project}
						<label
							class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground max-sm:flex-1"
						>
							<span class="max-sm:sr-only">Project</span>
							<select
								class={select}
								value={project ?? ''}
								onchange={(e) => setParam('project', e.currentTarget.value || null)}
								data-project-filter
							>
								<option value="">Every project</option>
								{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
								{#if project && !projects.some((p) => p.id === project)}<option value={project}
										>{projectName(project) ?? project}</option
									>{/if}
							</select>
						</label>
					{/if}
					<label
						class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground max-sm:flex-1"
					>
						<span class="max-sm:sr-only">Sort</span>
						<select
							class={select}
							value={sort}
							onchange={(e) =>
								setParam('sort', e.currentTarget.value === 'needs' ? null : e.currentTarget.value)}
							data-sort
						>
							{#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
						</select>
					</label>
				</div>
			</div>

			<div class="mt-4 max-w-4xl">
				{#each groups as g (g.id ?? 'all')}
					{#if g.id}
						<h2
							class="mt-5 mb-2 flex items-center gap-2 font-sans text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase first:mt-1"
							data-group={g.id}
						>
							{STANDING_LABEL[g.id]}<span class="font-mono tracking-normal">{g.cards.length}</span>
							<span class="flex-1 border-t border-hair" aria-hidden="true"></span>
						</h2>
					{/if}
					<ol class="flex flex-col gap-2" aria-label={g.id ? STANDING_LABEL[g.id] : 'Decisions'}>
						{#each g.cards as c (c.id)}
							<li in:rise out:stampOut={{ word: inbox.stampFor(c.id) }}>
								<DecisionRow
									card={c}
									project={projectName(c.projectId)}
									now={live.now}
									active={c.id === cards[activeIndex]?.id && activeId !== null}
									grouped={!!g.id}
									error={inbox.errors[c.id] ?? null}
									onOpen={() => openCard(c)}
									onAgree={view.canAnswer && standing(c) === 'waiting' ? () => agree(c) : undefined}
								/>
							</li>
						{/each}
					</ol>
				{/each}
				{#if cards.length === 0}
					<p
						class="mt-2 flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
						in:fadeQuick={{ delay: STAMP_MS }}
					>
						<Check class="size-4 text-success" aria-hidden="true" />{project || kind
							? 'Nothing open here.'
							: 'No decision is open. Firstmate will put the next one here.'}
						{#if project || kind}<a
								href="/inbox"
								class="ml-auto text-foreground underline-offset-2 hover:underline">Show all</a
							>{/if}
					</p>
				{/if}
			</div>

			<!-- Folded to a count: the calls Firstmate made itself; nothing here waits on the captain. -->
			<section class="mt-10 max-w-4xl" aria-labelledby="handled" data-handled>
				<button
					class="flex w-full cursor-pointer items-center gap-2 text-left"
					aria-expanded={handledOpen}
					aria-controls="handled-list"
					onclick={() => (handledOpen = !handledOpen)}
				>
					<h2 id="handled" class="font-sans text-base font-medium">Decided by Firstmate</h2>
					<span class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
						>{theirs.made.length}</span
					>
					<span class="text-sm text-muted-foreground">· this week, nothing for you to do</span>
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
							The calls Firstmate made this week so the work did not wait. Open one to see why, or
							take it over.
						</p>
						{#if theirs.made.length === 0}
							<p class="mt-3 text-sm text-muted-foreground">Nothing this week.</p>
						{:else}
							<ul class="mt-3 divide-y divide-hair/70 rounded-lg border bg-card" data-made>
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
