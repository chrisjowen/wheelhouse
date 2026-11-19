<script lang="ts">
	/**
	 * Decisions, the one place every open decision lives, as a full
	 * page: the list on the left, each with what it asks in a line or two
	 * (what needs the captain first, then those followed up in the chat, then
	 * those Firstmate is handling, each waiting longest first; or by age;
	 * filtered by type, project or task), and the
	 * decision chosen in full beside it (DecisionPane): short first, answered
	 * straight away from its options, or asked about. On a phone the list and
	 * the decision take the screen in turn. The decision shown is in the
	 * address (`?d=<card id>`, as the chat's Open in Decisions and the ship's
	 * bell give; an old `#card-<id>` link is read too), so a link opens it. The
	 * calls Firstmate made itself this week sit folded below the list.
	 * Keyboard: j/k move between decisions, l asks again later.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURL, SvelteURLSearchParams } from 'svelte/reactivity';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { ago } from '$lib/format';
	import { changeCallHref, handled as handledOf } from '$lib/handled';
	import {
		KIND_LABEL,
		KIND_ORDER,
		SORTS,
		STANDING_LABEL,
		STANDING_ORDER,
		inFilter,
		sortDecisions,
		standing,
		type DecisionFilter,
		type DecisionSort,
		type Standing
	} from '$lib/decisionhome';
	import { awaitsAnswer, cardContext, type InboxCard, type InboxKind } from '$lib/inbox';
	import { stampOut, fadeQuick, STAMP_MS } from '$lib/motion';
	import DecisionPane from '$lib/components/wh/inbox/DecisionPane.svelte';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { Check, ChevronDown, Undo2 } from '@lucide/svelte';
	import { shortAge } from '$lib/ondeck';

	let { data } = $props();

	$effect(() => inbox.seed(data.inbox));
	const view = $derived(inbox.value ?? data.inbox);
	const fleet = $derived(currentFleet());

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
	const taskParam = $derived(page.url.searchParams.get('task'));
	const filter = $derived<DecisionFilter>({ projectId: project, kind, taskId: taskParam });
	const chosenId = $derived(page.url.searchParams.get('d'));

	function setParam(key: string, value: string | null) {
		const url = new SvelteURL(page.url);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		url.hash = '';
		void goto(url, { replaceState: key !== 'd', noScroll: true, keepFocus: true });
	}

	// Wide: the list and the decision side by side, the first chosen when none is; narrow: in turn.
	let wide = $state(true);
	onMount(() => {
		const mq = matchMedia('(min-width: 1024px)');
		const sync = () => (wide = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const all = $derived(inbox.cards(data.inbox));
	// Every open question; those asked about later in this browser wait off the list.
	const open = $derived(all.filter((c) => awaitsAnswer(c, live.now)));
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
		return STANDING_ORDER.map((id) => ({
			id: id as Standing | null,
			cards: cards.filter((c) => standing(c) === id)
		})).filter((g) => g.cards.length);
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

	// The decision shown: the one the address names (still open in Firstmate, so listed by the
	// server, answered or not: the bell's Open decision lands on it), else on a wide screen the first.
	const chosen = $derived(
		(chosenId ? (all.find((c) => c.id === chosenId) ?? null) : null) ??
			(wide ? (cards[0] ?? null) : null)
	);
	const activeIndex = $derived(
		Math.max(
			0,
			cards.findIndex((c) => c.id === chosen?.id)
		)
	);

	function openCard(c: InboxCard) {
		setParam('d', c.id);
	}
	async function focus(i: number) {
		const c = cards[Math.min(Math.max(i, 0), cards.length - 1)];
		if (!c) return;
		openCard(c);
		await tick();
		document.getElementById(`row-${c.id}`)?.scrollIntoView({ block: 'nearest' });
	}
	/** An answer or dismissal is on its way: on to the next decision in the list. */
	function moveOn(from: InboxCard) {
		const i = cards.findIndex((c) => c.id === from.id);
		const next = cards[i + 1] ?? cards[i - 1] ?? null;
		if (next && next.id !== from.id) openCard(next);
		else setParam('d', null);
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		// While an overlay (the slide-out, a preview) is open, keys are not for the list behind it.
		if (t?.closest?.('dialog, [role="dialog"]')) return;
		if (document.querySelector('[aria-modal="true"], dialog[open], [data-preview-studio]')) return;
		if (!cards.length) return;
		const c = chosen ?? cards[0];
		const keys: Record<string, () => void> = {
			j: () => void focus(activeIndex + 1),
			k: () => void focus(activeIndex - 1),
			l: () => {
				moveOn(c);
				inbox.later(c.id);
			}
		};
		const run = keys[e.key];
		if (!run) return;
		e.preventDefault();
		run();
	}

	/** An old link to one card (#card-<id>) opens it as `?d=` does. */
	function openLinked(hash: string) {
		if (!hash.startsWith('#card-')) return;
		const id = decodeURIComponent(hash.slice('#card-'.length));
		if (id) setParam('d', id);
	}
	// The decision a link names shows even if it was asked about later in this browser.
	$effect(() => {
		const id = chosenId;
		if (id) untrack(() => inbox.wake(id));
	});

	onMount(() => {
		inbox.load();
		void inbox.read();
	});
	$effect(() => {
		const hash = page.url.hash;
		untrack(() => openLinked(hash));
	});

	const backHref = $derived.by(() => {
		const q = new SvelteURLSearchParams(page.url.search);
		q.delete('d');
		const t = q.toString();
		return t ? `/inbox?${t}` : '/inbox';
	});
	const chip = (on: boolean) =>
		`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
			on
				? 'border-foreground bg-foreground font-medium text-background'
				: 'text-foreground/80 hover:border-foreground/40 hover:text-foreground'
		}`;
	const select =
		'h-8 min-w-0 flex-1 cursor-pointer rounded-md border bg-background pr-7 pl-2 text-xs focus-visible:outline-2 focus-visible:outline-ring max-lg:h-10 max-lg:text-sm';
</script>

<svelte:head><title>Decisions · Wheelhouse</title></svelte:head>
<svelte:window onkeydown={onKey} />

<main class="flex min-h-0 flex-1 flex-col">
	{#if !view.available}
		<p class="m-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			{view.reason}
		</p>
	{:else}
		<div class="flex min-h-0 flex-1">
			<!-- The inbox: narrow, quiet, what waits on the captain first. -->
			<aside
				class="flex min-h-0 w-[20rem] shrink-0 flex-col border-r bg-panel max-lg:w-full xl:w-[22rem] {!wide &&
				chosen
					? 'hidden'
					: ''}"
				aria-label="Decisions"
				data-decision-list
			>
				<div class="shrink-0 px-4 pt-4 pb-2">
					<div class="flex items-baseline gap-2">
						<h1 class="font-title text-[1.7rem] leading-none">Decisions</h1>
						<span class="ml-auto text-xs text-muted-foreground" data-decisions-summary
							>{#if waiting}<span class="font-semibold text-sea">{waiting} waiting on you</span>
								·
							{/if}{cards.length} open</span
						>
					</div>
					{#if snoozed}
						<button
							class="mt-1 cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
							onclick={() => inbox.wake()}>{snoozed} asked about later: show them</button
						>
					{/if}
					<div
						class="-mx-1 mt-3 no-scrollbar flex gap-1 overflow-x-auto px-1"
						role="radiogroup"
						aria-label="Type"
						data-decision-filters
					>
						<button
							role="radio"
							aria-checked={!kind}
							class={chip(!kind)}
							onclick={() => setParam('type', null)}
							>All <span class="font-mono opacity-70">{inProject.length}</span></button
						>
						{#each kinds as k (k.id)}
							<button
								role="radio"
								aria-checked={kind === k.id}
								class={chip(kind === k.id)}
								onclick={() => setParam('type', kind === k.id ? null : k.id)}
								data-kind={k.id}
								>{KIND_LABEL[k.id]} <span class="font-mono opacity-70">{k.n}</span></button
							>
						{/each}
					</div>
					<div class="mt-2 flex gap-2">
						{#if projects.length > 1 || project}
							<select
								class={select}
								value={project ?? ''}
								aria-label="Project"
								onchange={(e) => setParam('project', e.currentTarget.value || null)}
								data-project-filter
							>
								<option value="">Every project</option>
								{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
								{#if project && !projects.some((p) => p.id === project)}<option value={project}
										>{projectName(project) ?? project}</option
									>{/if}
							</select>
						{/if}
						<select
							class={select}
							value={sort}
							aria-label="Sort"
							onchange={(e) =>
								setParam('sort', e.currentTarget.value === 'needs' ? null : e.currentTarget.value)}
							data-sort
						>
							{#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
						</select>
					</div>
					{#if taskParam}
						<p class="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
							Only this task’s decisions ·
							<button
								class="cursor-pointer underline-offset-2 hover:text-foreground hover:underline"
								onclick={() => setParam('task', null)}>show all</button
							>
						</p>
					{/if}
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hair">
					{#each groups as g (g.id ?? 'all')}
						{#if g.id}
							<h2
								class="sticky top-0 z-10 flex items-center gap-2 bg-panel px-4 pt-3 pb-1.5 font-sans text-[0.68rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
								data-group={g.id}
							>
								{STANDING_LABEL[g.id]}<span class="font-mono tracking-normal">{g.cards.length}</span
								>
							</h2>
						{/if}
						<ol aria-label={g.id ? STANDING_LABEL[g.id] : 'Decisions'}>
							{#each g.cards as c (c.id)}
								{@const on = c.id === chosen?.id}
								{@const where = standing(c)}
								{@const asks = cardContext(c)}
								<li id="row-{c.id}" out:stampOut={{ word: inbox.stampFor(c.id) }}>
									<button
										type="button"
										class="relative flex w-full cursor-pointer gap-2.5 py-2.5 pr-3 pl-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring {on
											? 'bg-background'
											: 'hover:bg-background/50'}"
										aria-current={on ? 'true' : undefined}
										onclick={() => openCard(c)}
										data-decision-row={where}
										data-open-decision-row
									>
										{#if on}<span
												class="absolute inset-y-0 left-0 w-[3px] bg-gold"
												aria-hidden="true"
											></span>{/if}
										<span
											class="mt-1.5 size-2 shrink-0 rounded-full {where === 'waiting'
												? 'bg-sea'
												: where === 'following'
													? 'bg-sea/40'
													: 'border border-muted-foreground/50'}"
											aria-hidden="true"
										></span>
										<span class="min-w-0 flex-1">
											<span
												class="line-clamp-2 text-sm leading-snug {where === 'waiting'
													? 'font-semibold text-foreground'
													: 'text-foreground/85'}">{c.title}</span
											>
											{#if asks}<span
													class="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground/70"
													data-decision-asks>{asks}</span
												>{/if}
											<span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
												<span class="truncate"
													>{KIND_LABEL[c.kind]}{projectName(c.projectId)
														? ` · ${projectName(c.projectId)}`
														: ''}</span
												>
												{#if c.askedAt}<span class="ml-auto shrink-0 tabular-nums"
														>{shortAge(c.askedAt, live.now)}</span
													>{/if}
											</span>
											{#if where === 'answered' && c.sent}<span
													class="mt-0.5 block truncate text-xs text-muted-foreground"
													data-answered-row
													>You answered {shortAge(c.sent.at, live.now)} ago · still open</span
												>{/if}
											{#if inbox.errors[c.id]}<span class="mt-0.5 block text-xs text-danger"
													>Not sent: {inbox.errors[c.id]}</span
												>{/if}
										</span>
									</button>
								</li>
							{/each}
						</ol>
					{/each}
					{#if cards.length === 0}
						<p
							class="m-4 flex items-center gap-2 text-sm text-muted-foreground"
							in:fadeQuick={{ delay: STAMP_MS }}
						>
							<Check class="size-4 text-success" aria-hidden="true" />{project || kind || taskParam
								? 'Nothing open here.'
								: 'Nothing open. Firstmate will put the next one here.'}
						</p>
					{/if}

					<!-- Folded to a count: the calls Firstmate made itself; nothing here waits on the captain. -->
					<section
						class="mt-4 border-t border-hair px-4 pt-2 pb-4"
						aria-labelledby="handled"
						data-handled
					>
						<button
							class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
							aria-expanded={handledOpen}
							aria-controls="handled-list"
							onclick={() => (handledOpen = !handledOpen)}
						>
							<h2 id="handled" class="font-sans text-sm font-medium">Decided by Firstmate</h2>
							<span class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
								>{theirs.made.length}</span
							>
							<span class="text-xs text-muted-foreground">this week</span>
							<ChevronDown
								class="ml-auto size-4 text-muted-foreground transition-transform {handledOpen
									? 'rotate-180'
									: ''}"
								aria-hidden="true"
							/>
						</button>
						{#if handledOpen}
							<ul id="handled-list" class="mt-1 divide-y divide-hair/70" data-made>
								{#each theirs.made as d (d.id)}
									{@const call = d.calls[0]}
									<li class="py-2">
										<button
											class="w-full cursor-pointer text-left"
											aria-expanded={!!openCall[d.id]}
											onclick={() => (openCall[d.id] = !openCall[d.id])}
										>
											<span class="line-clamp-2 text-sm leading-snug">{call.question}</span>
											<span class="mt-0.5 block text-xs text-muted-foreground"
												>Firstmate: <span class="font-medium text-foreground">{d.verdict}</span> ·
												{ago(d.decidedAt, live.now)}</span
											>
										</button>
										{#if openCall[d.id]}
											<div class="mt-1.5 border-l-2 border-sea/60 pl-2.5">
												<p class="text-xs text-muted-foreground">On {d.taskTitle}</p>
												{#each d.calls as c, i (i)}
													<p class="mt-1 text-sm leading-relaxed whitespace-pre-line">
														{c.reason || 'No reason was recorded.'}
													</p>
													{#if c.detail && c.detail !== c.question}
														<details class="mt-1 text-xs text-muted-foreground">
															<summary class="cursor-pointer hover:text-foreground"
																>What the reviewer wrote</summary
															>
															<p class="mt-1 leading-relaxed"><LinkedText text={c.detail} /></p>
														</details>
													{/if}
												{/each}
												<a
													href={changeCallHref(d)}
													class="mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
													data-change-call
													><Undo2 class="size-3.5" aria-hidden="true" />Change this call</a
												>
											</div>
										{/if}
									</li>
								{:else}
									<li class="py-2 text-sm text-muted-foreground">Nothing this week.</li>
								{/each}
							</ul>
						{/if}
					</section>
				</div>
			</aside>

			<!-- The decision chosen, with everything needed to decide. -->
			<section
				class="flex min-h-0 min-w-0 flex-1 flex-col bg-background {!wide && !chosen
					? 'hidden'
					: ''}"
				aria-label="The decision"
				data-decision-detail
			>
				{#if !view.canAnswer}
					<p class="mx-8 mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
						Answers cannot be sent right now: {view.reason ?? 'messaging to Firstmate is off.'}
					</p>
				{/if}
				{#if chosen}
					{#key chosen.id}
						<DecisionPane
							card={chosen}
							project={projectName(chosen.projectId)}
							now={live.now}
							canAnswer={view.canAnswer}
							error={inbox.errors[chosen.id] ?? null}
							back={wide ? null : backHref}
							onSent={() => chosen && moveOn(chosen)}
							onLater={() => {
								if (!chosen) return;
								const c = chosen;
								moveOn(c);
								inbox.later(c.id);
							}}
						/>
					{/key}
				{:else}
					<div class="grid flex-1 place-items-center text-center text-sm text-muted-foreground">
						<p class="flex flex-col items-center gap-2">
							<Check class="size-6 text-success" aria-hidden="true" />{cards.length
								? 'Choose a decision.'
								: 'Nothing waits on you.'}
						</p>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</main>
