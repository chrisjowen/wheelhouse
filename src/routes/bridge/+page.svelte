<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, tick, untrack } from 'svelte';
	import { currentFleet, currentHealth, currentMessages, live } from '$lib/client/live.svelte';
	import { postMessage } from '$lib/client/messages';
	import { slots } from '$lib/client/slots.svelte';
	import { matchBridgeCards } from '$lib/plugins/blocks';
	import { slotKey } from '$lib/plugins/keys';
	import Blocks from '$lib/components/wh/plugins/Blocks.svelte';
	import {
		captainDecision,
		feed,
		linkify,
		matchTasks,
		mergeLocal,
		needsLook,
		newRequestId,
		optionDraft,
		outgoing,
		shelfThreads,
		threadKey,
		threadMessages,
		threads,
		type DecisionOption,
		type LocalMessage
	} from '$lib/bridge';
	import { shelfOf, type Shelf } from '$lib/harbour';
	import { ago, clock } from '$lib/format';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import BridgeTaskCard from '$lib/components/wh/BridgeTaskCard.svelte';
	import Composer from '$lib/components/wh/Composer.svelte';
	import DeliveryState from '$lib/components/wh/DeliveryState.svelte';
	import { dotClass, tone } from '$lib/components/wh/tone';
	import {
		Anchor,
		ArrowDown,
		Check,
		ChevronDown,
		ExternalLink,
		MessagesSquare
	} from '@lucide/svelte';

	let { data } = $props();

	const fleet = $derived(currentFleet());
	// Plugin Bridge cards, shown under a reply that links one of their URLs exactly.
	const pluginEntries = $derived(slots.entries(slotKey.fleet, data.slots, data.slotsAt));
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, data.slotsAt);
	});
	const health = $derived(currentHealth());
	const view = $derived(currentMessages());
	const tasks = $derived(fleet?.tasks ?? []);
	const sup = $derived(health?.supervisor);
	const projectName = (projectId: string) =>
		fleet?.projects.find((p) => p.id === projectId)?.name ?? projectId;

	// Messages the browser is still handing over, or could not hand over.
	let local = $state<LocalMessage[]>([]);
	const messages = $derived(mergeLocal(view?.messages ?? [], local));

	// One thread at a time: /bridge?task=<id> is that task's conversation, /bridge
	// the general one. The Under way | Completed toggle is ?view=completed.
	const focus = $derived(page.url.searchParams.get('task') || null);
	const shelf = $derived(shelfOf(page.url.searchParams.get('view')));
	const key = $derived(threadKey(focus));
	const task = $derived(focus ? (tasks.find((t) => t.id === focus) ?? null) : null);
	const items = $derived(feed(threadMessages(messages, focus)));
	const decision = $derived(captainDecision(task));
	const a = $derived(task?.attention ?? null);

	const threadHref = (taskId: string | null, s: Shelf = shelf) => {
		const q = [
			taskId ? `task=${encodeURIComponent(taskId)}` : null,
			s === 'completed' ? 'view=completed' : null
		].filter(Boolean);
		return q.length ? `/bridge?${q.join('&')}` : '/bridge';
	};

	// Replies the captain has seen, per browser. With nothing stored yet,
	// everything already on the radio counts as seen.
	const SEEN_KEY = 'wheelhouse-bridge-seen';
	const SEEN_MAX = 500;
	let seen = $state<Set<string> | null>(null);
	const replied = $derived(messages.filter((m) => m.reply).map((m) => m.requestId));
	const all = $derived(threads(messages, tasks, focus, seen ?? new Set(replied)));
	const listed = $derived(shelfThreads(all, shelf));
	const others = $derived(needsLook(listed, focus));
	const completedUnread = $derived(
		needsLook(shelfThreads(all, 'completed'), focus).some((t) => t.unread > 0)
	);

	onMount(() => {
		let stored: string[] | null = null;
		try {
			const raw = localStorage.getItem(SEEN_KEY);
			if (raw) stored = JSON.parse(raw);
		} catch {
			// storage unavailable; unread markers last for this page only
		}
		seen = new Set(Array.isArray(stored) ? stored : replied);
		if (!Array.isArray(stored)) save(seen);
		if (focus) composer?.focus();
	});

	// Opening a thread marks its replies seen.
	$effect(() => {
		if (!seen) return;
		const fresh = items.filter((i) => i.kind === 'reply' && !seen!.has(i.message.requestId));
		if (!fresh.length) return;
		seen = new Set([...seen, ...fresh.map((i) => i.message.requestId)]);
		save(seen);
	});

	function save(ids: Set<string>) {
		try {
			localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-SEEN_MAX)));
		} catch {
			// storage unavailable
		}
	}

	// Each thread keeps its own unsent draft, so an answer never lands in another thread.
	let draft = $state('');
	let composer: Composer | null = $state(null);
	const drafts: Record<string, string> = {};
	let draftKey = untrack(() => key);
	$effect.pre(() => {
		const k = key;
		untrack(() => {
			if (k === draftKey) return;
			drafts[draftKey] = draft;
			draft = drafts[k] ?? '';
			draftKey = k;
			follow = true;
			first = true;
		});
	});

	function choose(o: DecisionOption) {
		draft = optionDraft(o, draft);
		void tick().then(() => composer?.focus());
	}
	const chosen = (o: DecisionOption) => draft.startsWith(o.marker);

	const unavailable = $derived(
		view && !view.available
			? (view.reason ?? 'Messaging is unavailable.')
			: health && !health.messaging.available
				? (health.messaging.reason ?? 'Messaging is unavailable.')
				: null
	);

	function patchLocal(requestId: string, patch: Partial<LocalMessage>) {
		local = local.map((m) => (m.requestId === requestId ? { ...m, ...patch } : m));
	}

	async function deliver(m: LocalMessage) {
		const r = await postMessage(
			{ requestId: m.requestId, text: m.text, taskId: m.taskId },
			page.data.sessionToken as string
		);
		if (r.ok) patchLocal(m.requestId, r.message);
		else patchLocal(m.requestId, { delivery: 'unsent', deliveryDetail: r.error });
	}

	function send(text: string) {
		const m = outgoing(text, focus, newRequestId(), new Date());
		local = [...local, m];
		follow = true;
		void deliver(m);
	}

	// A retry reuses the message's request id, so it can never send a second copy.
	function retry(m: LocalMessage) {
		const mine = local.find((x) => x.requestId === m.requestId);
		if (mine) patchLocal(m.requestId, { delivery: 'sending', deliveryDetail: null });
		else local = [...local, { ...m, delivery: 'sending', deliveryDetail: null }];
		void deliver(m);
	}

	// Follow the newest message unless the captain has scrolled up to read.
	let scroller: HTMLDivElement | null = $state(null);
	let follow = $state(true);
	const NEAR_BOTTOM = 80;

	function onScroll() {
		if (!scroller) return;
		follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
	}

	function toLatest(smooth = true) {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
		follow = true;
	}

	let first = true;
	$effect(() => {
		void key;
		void items.length;
		void items.at(-1)?.message.delivery;
		if (!follow) return;
		const smooth = !first;
		first = false;
		void tick().then(() => toLatest(smooth));
	});

	const excerpt = (s: string) => (s.length > 80 ? `${s.slice(0, 80).trimEnd()}…` : s);
	const toggle = (s: Shelf) =>
		goto(threadHref(focus, s), { replaceState: true, keepFocus: true, noScroll: true });
</script>

<svelte:head
	><title>{task ? `${task.title} · ` : focus ? `${focus} · ` : ''}Bridge · Wheelhouse</title
	></svelte:head
>

{#snippet plain(text: string)}
	{#each linkify(text) as part, i (i)}{#if part.url}<a
				href={part.text}
				target="_blank"
				rel="noreferrer"
				class="break-all text-sea underline-offset-2 hover:underline">{part.text}</a
			>{:else}{part.text}{/if}{/each}
{/snippet}

{#snippet shelfToggle()}
	<div class="flex rounded-lg border p-0.5 text-xs" role="tablist" aria-label="Threads shown">
		{#each [['under-way', 'Under way'], ['completed', 'Completed']] as [s, label] (s)}
			<button
				role="tab"
				aria-selected={shelf === s}
				class="flex-1 rounded-md px-2.5 py-1 {shelf === s
					? 'bg-accent font-medium'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => toggle(s as Shelf)}
				>{label}{#if s === 'completed' && completedUnread}<span
						class="ml-1.5 inline-block size-1.5 rounded-full bg-sea align-middle"
						aria-label="has unread"
					></span>{/if}</button
			>
		{/each}
	</div>
{/snippet}

<main class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
	<div class="flex shrink-0 items-start gap-4 border-b pt-8 pb-5">
		<div class="min-w-0 flex-1">
			<p class="text-xs text-muted-foreground">
				Bridge{task ? ` · ${projectName(task.projectId)}` : ''}
			</p>
			<h1 id="bridge-title" class="mt-1 truncate text-2xl font-semibold tracking-tight">
				{task?.title ?? focus ?? 'General'}
			</h1>
			<p class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				{#if task}
					<span class="inline-flex items-center gap-1.5"
						><span class="size-2 rounded-full {dotClass[tone(task)]}" aria-hidden="true"
						></span>{task.statusLabel}</span
					>
					<a href="/tasks/{encodeURIComponent(task.id)}" class="font-mono text-xs hover:underline"
						>{task.id}</a
					>
				{:else if focus}
					<span>Firstmate no longer lists this task.</span>
				{:else}
					<span>Messages to Firstmate that are not about one task.</span>
				{/if}
			</p>
		</div>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" class="shrink-0 font-normal"
						><MessagesSquare />Threads{#if others.length}<span
								class="tabular ml-0.5 rounded-full bg-sea px-1.5 text-[11px] leading-4 font-medium text-white"
								aria-label="{others.length} threads need a look">{others.length}</span
							>{/if}<ChevronDown class="size-4" /></Button
					>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="no-scrollbar max-h-[70vh] w-80 overflow-y-auto">
				<div class="p-1.5">{@render shelfToggle()}</div>
				{#if !listed.length}
					<DropdownMenu.Item disabled>No completed threads</DropdownMenu.Item>
				{/if}
				{#each listed as t (threadKey(t.taskId))}
					<DropdownMenu.Item
						onSelect={() => goto(threadHref(t.taskId))}
						class="items-start gap-2 py-2"
						aria-current={t.taskId === focus ? 'true' : undefined}
					>
						<span class="mt-0.5 size-4 shrink-0">
							{#if t.taskId === focus}<Check class="size-4" aria-hidden="true" />{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate {t.needsYou ? 'font-medium' : ''}">{t.title}</span>
							<span class="block truncate text-xs text-muted-foreground"
								>{t.task?.statusLabel ?? (t.taskId ? t.taskId : 'Not about one task')}</span
							>
						</span>
						{#if t.needsYou}
							<span class="mt-0.5 shrink-0 text-xs font-medium text-sea">Needs you</span>
						{/if}
						{#if t.unread}
							<span
								class="tabular mt-0.5 shrink-0 rounded-full bg-sea px-1.5 text-[11px] leading-4 font-medium text-white"
								aria-label="{t.unread} unread">{t.unread}</span
							>
						{/if}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	{#if decision}
		<section
			class="mt-4 no-scrollbar max-h-[45vh] shrink-0 overflow-y-auto rounded-xl border border-sea/40 bg-sea/5 p-4"
			aria-labelledby="decision-question"
		>
			<p class="text-xs font-medium text-sea">Firstmate needs your decision</p>
			<h2 id="decision-question" class="mt-1 leading-snug font-medium whitespace-pre-wrap">
				{decision.question}
			</h2>
			{#if decision.options.length}
				<ol class="mt-3 space-y-2" aria-label="Options">
					{#each decision.options as o (o.marker)}
						<li>
							<button
								class="flex w-full gap-3 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-sea/60 {chosen(
									o
								)
									? 'border-sea ring-2 ring-sea/20'
									: ''}"
								aria-pressed={chosen(o)}
								disabled={!!unavailable}
								onclick={() => choose(o)}
								><span class="shrink-0 font-mono text-sea">{o.marker}</span><span
									class="min-w-0 break-words">{o.text}</span
								></button
							>
						</li>
					{/each}
				</ol>
				<p class="mt-3 text-xs text-muted-foreground">
					Pick an option to start your answer, add to it or write your own below. It goes to
					Firstmate about this task.
				</p>
			{:else}
				<p class="mt-3 text-xs text-muted-foreground">
					Answer below. It goes to Firstmate about this task.
				</p>
			{/if}
		</section>
	{:else if a?.owner === 'captain' && a.kind === 'review'}
		<div
			class="mt-4 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-sea/40 bg-sea/5 px-4 py-3 text-sm"
		>
			<p class="min-w-0 flex-1">{a.text}</p>
			{#if task?.preview}
				<Button size="sm" variant="outline" href={task.preview.url} target="_blank" rel="noreferrer"
					>Open preview<ExternalLink /></Button
				>
			{/if}
			{#if task?.pr}
				<Button size="sm" href={task.pr.url} target="_blank" rel="noreferrer"
					>Review PR<ExternalLink /></Button
				>
			{/if}
		</div>
	{:else if a?.owner === 'firstmate'}
		<p class="mt-4 shrink-0 rounded-xl border px-4 py-3 text-sm">
			<span class="font-medium text-warning">A worker raised a decision.</span>
			<span class="text-muted-foreground">Firstmate handles it first:</span>
			{a.text}
		</p>
	{/if}

	<div class="relative min-h-0 flex-1">
		<div
			bind:this={scroller}
			onscroll={onScroll}
			class="no-scrollbar h-full overflow-y-auto py-6"
			role="log"
			aria-labelledby="bridge-title"
		>
			{#if !items.length}
				<div class="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">
					<Anchor class="mx-auto size-6 text-sea" aria-hidden="true" />
					{#if focus}
						<p class="mt-3 font-medium text-foreground">Nothing said about this task yet.</p>
						<p class="mt-2">
							Messages you send here go to Firstmate about this task. Its replies to them appear
							here too.
						</p>
					{:else}
						<p class="mt-3 font-medium text-foreground">Nothing on the radio yet.</p>
						<p class="mt-2">
							Messages you send Firstmate appear here, with whether they were delivered and whether
							Firstmate acknowledged them. When Firstmate records a reply to one, it appears here
							too; anything else it says stays in its own session. To talk about one task, open its
							thread from Threads.
						</p>
					{/if}
				</div>
			{/if}

			<ol class="space-y-6">
				{#each items as item (item.key)}
					{@const m = item.message}
					{#if item.kind === 'message'}
						<li class="flex flex-col items-end">
							<p
								class="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 leading-relaxed break-words whitespace-pre-wrap"
							>
								{m.text}
							</p>
							<p
								class="mt-1.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground"
							>
								<time datetime={m.submittedAt} title={m.submittedAt}>{clock(m.submittedAt)}</time>
								<DeliveryState message={m} onRetry={() => retry(m)} />
							</p>
							{#if m.deliveryDetail && m.delivery !== 'delivered'}
								<p class="mt-1 max-w-[85%] text-right text-xs text-muted-foreground">
									{m.deliveryDetail}
								</p>
							{/if}
						</li>
					{:else if m.reply}
						{@const cards = matchTasks(m.reply.body, tasks).filter((t) => t.id !== focus)}
						{@const extra = matchBridgeCards(m.reply.body, pluginEntries)}
						<li class="flex gap-3">
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full bg-sea/10 text-sea"
								aria-hidden="true"><Anchor class="size-4" /></span
							>
							<div class="min-w-0 flex-1">
								<p class="text-sm">
									<span class="font-medium">Firstmate</span>
									{#if m.reply.at}<time
											datetime={m.reply.at}
											title={m.reply.at}
											class="ml-1.5 text-muted-foreground">{ago(m.reply.at, live.now)}</time
										>{/if}
								</p>
								{#if item.quote}
									<p class="mt-1 truncate text-xs text-muted-foreground">
										Replying to “{excerpt(m.text)}”
									</p>
								{/if}
								<p class="mt-2 leading-relaxed break-words whitespace-pre-wrap">
									{@render plain(m.reply.body)}
								</p>
								{#if cards.length}
									<div class="mt-4 space-y-3">
										{#each cards as t (t.id)}<BridgeTaskCard
												task={t}
												projectName={projectName(t.projectId)}
											/>{/each}
									</div>
								{/if}
								{#if extra.length}
									<div class="mt-4 space-y-3">
										{#each extra as { entry, card } (`${entry.key}:${card.key}`)}
											<article
												class="min-w-0 rounded-xl border bg-card p-4"
												data-slot="bridge.card"
											>
												<p class="text-xs text-muted-foreground">{entry.title}</p>
												<p class="font-medium">{card.title}</p>
												<div class="mt-2"><Blocks blocks={card.blocks} /></div>
											</article>
										{/each}
									</div>
								{/if}
							</div>
						</li>
					{/if}
				{/each}
			</ol>

			{#if view?.receiptsError}
				<p class="mt-6 text-xs text-warning">
					Wheelhouse could not read Firstmate’s receipts, so acknowledgements and replies may be out
					of date. {view.receiptsError}
				</p>
			{/if}
			{#if view?.storeError}
				<p class="mt-6 text-xs text-warning">
					Wheelhouse could not save its message record, so these states may be lost if it restarts.
					{view.storeError}
				</p>
			{/if}
		</div>

		{#if !follow}
			<button
				class="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
				onclick={() => toLatest()}><ArrowDown class="size-3.5" />Jump to latest</button
			>
		{/if}
	</div>

	<div class="shrink-0 pt-2 pb-4">
		<Composer
			bind:this={composer}
			bind:text={draft}
			taskId={focus}
			disabled={!!unavailable}
			disabledReason={unavailable}
			onSend={send}
		/>
		<p class="mt-2 text-center text-xs text-muted-foreground">
			{#if sup?.available && sup.onWatch === false}
				<span class="text-warning">Firstmate is off watch.</span> Messages wait in its inbox until it
				is back.
			{:else if sup && sup.onWatch !== true}
				<span class="text-warning">Firstmate is not confirmed on watch.</span> Messages wait in its inbox
				until it reads them.
			{:else}
				Messages always go to Firstmate. Crew can’t be messaged directly.
			{/if}
		</p>
	</div>
</main>
