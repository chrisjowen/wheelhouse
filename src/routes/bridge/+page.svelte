<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { currentFleet, currentHealth, currentMessages, live } from '$lib/client/live.svelte';
	import { postMessage } from '$lib/client/messages';
	import {
		feed,
		linkify,
		matchTasks,
		mergeLocal,
		newRequestId,
		type LocalMessage
	} from '$lib/bridge';
	import { ago, clock } from '$lib/format';
	import BridgeTaskCard from '$lib/components/wh/BridgeTaskCard.svelte';
	import Composer from '$lib/components/wh/Composer.svelte';
	import DeliveryState from '$lib/components/wh/DeliveryState.svelte';
	import OnDeck from '$lib/components/wh/OnDeck.svelte';
	import { Anchor, ArrowDown } from '@lucide/svelte';

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const view = $derived(currentMessages());
	const tasks = $derived(fleet?.tasks ?? []);
	const sup = $derived(health?.supervisor);
	const projectName = (projectId: string) =>
		fleet?.projects.find((p) => p.id === projectId)?.name ?? projectId;

	// Messages the browser is still handing over, or could not hand over.
	let local = $state<LocalMessage[]>([]);
	const messages = $derived(mergeLocal(view?.messages ?? [], local));
	const items = $derived(feed(messages));

	// "Ask Firstmate about this" opens /bridge?task=<id> with the task attached.
	// The composer can change or drop it; it resets when the URL changes.
	let taskId = $derived<string | null>(page.url.searchParams.get('task'));
	const attached = $derived(taskId ? (tasks.find((t) => t.id === taskId) ?? null) : null);

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

	function send(text: string, about: string | null) {
		const m: LocalMessage = {
			requestId: newRequestId(),
			text,
			taskId: about,
			submittedAt: new Date().toISOString(),
			delivery: 'sending',
			deliveryDetail: null,
			acknowledged: null,
			noteId: null,
			reply: null
		};
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
		void items.length;
		void items.at(-1)?.message.delivery;
		void attached;
		if (!follow) return;
		const smooth = !first;
		first = false;
		void tick().then(() => toLatest(smooth));
	});

	const excerpt = (s: string) => (s.length > 80 ? `${s.slice(0, 80).trimEnd()}…` : s);
</script>

<svelte:head><title>Bridge · Wheelhouse</title></svelte:head>

{#snippet plain(text: string)}
	{#each linkify(text) as part, i (i)}{#if part.url}<a
				href={part.text}
				target="_blank"
				rel="noreferrer"
				class="break-all text-sea underline-offset-2 hover:underline">{part.text}</a
			>{:else}{part.text}{/if}{/each}
{/snippet}

<main class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-12 px-4 sm:px-6">
	<section class="flex min-w-0 flex-1 flex-col" aria-labelledby="bridge-title">
		<div class="shrink-0 border-b pt-8 pb-5">
			<h1 id="bridge-title" class="text-2xl font-semibold tracking-tight">Bridge</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Talk to Firstmate. It reports in here and passes your word to the crew.
			</p>
		</div>

		<div class="relative min-h-0 flex-1">
			<div
				bind:this={scroller}
				onscroll={onScroll}
				class="no-scrollbar h-full overflow-y-auto py-6"
				role="log"
				aria-label="Conversation with Firstmate"
			>
				{#if !items.length}
					<div class="mx-auto mt-10 max-w-md text-center text-sm text-muted-foreground">
						<Anchor class="mx-auto size-6 text-sea" aria-hidden="true" />
						<p class="mt-3 font-medium text-foreground">Nothing on the radio yet.</p>
						<p class="mt-2">
							Messages you send Firstmate appear here, with whether they were delivered and whether
							Firstmate acknowledged them. When Firstmate records a reply to one, it appears here
							too; anything else it says stays in its own session.
						</p>
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
									{#if m.taskId}<a
											href="/tasks/{encodeURIComponent(m.taskId)}"
											class="font-mono hover:text-foreground hover:underline">{m.taskId}</a
										>{/if}
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
							{@const cards = matchTasks(m.reply.body, tasks)}
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
								</div>
							</li>
						{/if}
					{/each}
				</ol>

				{#if attached}
					<div class="mt-8">
						<p class="mb-2 text-xs text-muted-foreground">You are asking Firstmate about</p>
						<BridgeTaskCard task={attached} projectName={projectName(attached.projectId)} />
					</div>
				{/if}

				{#if view?.receiptsError}
					<p class="mt-6 text-xs text-warning">
						Wheelhouse could not read Firstmate’s receipts, so acknowledgements and replies may be
						out of date. {view.receiptsError}
					</p>
				{/if}
				{#if view?.storeError}
					<p class="mt-6 text-xs text-warning">
						Wheelhouse could not save its message record, so these states may be lost if it
						restarts.
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
				{tasks}
				bind:taskId
				disabled={!!unavailable}
				disabledReason={unavailable}
				onSend={send}
			/>
			<p class="mt-2 text-center text-xs text-muted-foreground">
				{#if sup?.available && sup.onWatch === false}
					<span class="text-warning">Firstmate is off watch.</span> Messages wait in its inbox until it
					is back.
				{:else if sup && sup.onWatch !== true}
					<span class="text-warning">Firstmate is not confirmed on watch.</span> Messages wait in its
					inbox until it reads them.
				{:else}
					Messages always go to Firstmate. Crew can’t be messaged directly.
				{/if}
			</p>
		</div>
	</section>

	<aside class="no-scrollbar hidden w-60 shrink-0 overflow-y-auto pt-9 pb-6 lg:block">
		<OnDeck {tasks} now={live.now} />
	</aside>
</main>
