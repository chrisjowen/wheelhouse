<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { harbour } from '$lib/harbour';
	import { shipHealth } from '$lib/chat/health';
	import { chatDecision, chatDraft, chatMention } from '$lib/chat/mention';
	import Chat from '$lib/components/firstmate/Chat.svelte';
	import Rail from '$lib/components/firstmate/Rail.svelte';
	import ResizableRail from '$lib/components/wh/ResizableRail.svelte';
	import { homeLayout } from '$lib/client/layout.svelte';
	import { composerBus } from '$lib/components/firstmate/bus.svelte';
	import { openedDecisions } from '$lib/client/opened.svelte';
	import { railInsights } from '$lib/client/insights.svelte';
	import { afterNavigate, goto, replaceState } from '$app/navigation';

	/**
	 * The home page: one pane for talking to Firstmate and keeping an eye on the
	 * fleet. The chat fills the width; the rail on the right (resizable, and a
	 * sheet on narrow screens) lists what needs the captain and what is in play.
	 * The full board is the Harbour tab. The chat reads one thread at a time
	 * from the header's project (`?project=`, which scopes the rail too) or a
	 * topic or Unsorted (`?thread=`, the chat alone).
	 */
	let { data } = $props();

	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const thread = $derived(page.url.searchParams.get('thread') ?? scope);
	function pickThread(topic: string | null) {
		const project = topic && fleet?.projects.some((p) => p.id === topic);
		const q = !topic
			? ''
			: project
				? `?project=${encodeURIComponent(topic)}`
				: `?thread=${encodeURIComponent(topic)}`;
		void goto(`/${q}`, { noScroll: true, keepFocus: true });
	}
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope));
	const h = $derived(harbour(tasks, live.now));
	const health = $derived(shipHealth(h));
	const waiting = $derived(h.needsYou.length + h.stepFailed.length);
	const pluginEntries = $derived(slots.entries(slotKey.fleet, data.slots, data.slotsAt));
	const cards = $derived(pluginEntries.filter((e) => e.slot === 'home.card'));
	// The rail's insights: from this page load, then refreshed each minute.
	$effect(() => railInsights.seed(data.insights));
	const insights = $derived(railInsights.value ?? data.insights);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, data.slotsAt);
	});

	// `/?chat=<task id>` (a task page's "Ask Firstmate about this") starts a message mentioning it, once;
	// `&draft=<text>` (or `/?draft=` alone) adds words after it, e.g. "I'd decide differently".
	// `/?decision=<card id>` (a decision's Chat about this) brings that decision into the chat.
	const mention = chatMention();
	const takeDraft = chatDraft();
	const takeDecision = chatDecision();
	// Only once mounted: replaceState before the router starts throws and stops the page loading.
	let mounted = $state(false);
	let navigation = $state(0);
	afterNavigate(() => navigation++);
	$effect(() => {
		if (!mounted) return;
		const ref = mention(page.url, fleet);
		const draft = takeDraft(page.url, fleet);
		const decision = takeDecision(page.url, navigation);
		if (!ref && !draft && !decision) return;
		if (ref) composerBus.pending = ref;
		if (draft) composerBus.draft = draft;
		if (decision) {
			openedDecisions.add(decision);
			composerBus.decision = decision;
		}
		const url = new URL(page.url);
		url.searchParams.delete('chat');
		url.searchParams.delete('draft');
		url.searchParams.delete('decision');
		replaceState(url, {});
	});

	// Narrow: the chat alone, the rail as a sheet. Wide: a docked rail, resizable, its width remembered.
	let wide = $state(true);
	let railOpen = $state(true);

	onMount(() => {
		mounted = true;
		homeLayout.load();
		const mq = window.matchMedia('(min-width: 1024px)');
		const sync = () => {
			wide = mq.matches;
			railOpen = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		const disconnect = firstmateChat.connect();
		const stopInsights = railInsights.connect();
		return () => {
			mq.removeEventListener('change', sync);
			disconnect();
			stopInsights();
		};
	});
</script>

<svelte:head><title>Firstmate · Wheelhouse</title></svelte:head>

<!-- On deck docks left (the default) or right of the chat, as the captain set it. -->
<main class="flex min-h-0 flex-1 {homeLayout.side === 'left' ? 'flex-row-reverse' : ''}">
	<Chat
		token={data.sessionToken}
		{railOpen}
		{waiting}
		{health}
		now={live.now}
		{pluginEntries}
		tasks={fleet?.tasks ?? []}
		projects={fleet?.projects ?? []}
		railSide={homeLayout.side}
		{thread}
		onPickThread={pickThread}
		onToggleRail={() => (railOpen = !railOpen)}
		onSwapRail={() => homeLayout.swap()}
	/>
	{#if railOpen && wide}
		<ResizableRail
			storageKey="wheelhouse-rail-width"
			label="Resize the rail"
			defaultWidth={460}
			side={homeLayout.side}
			class="bg-panel"
		>
			<Rail
				{tasks}
				projects={fleet?.projects ?? []}
				secondMates={fleet?.secondMates ?? []}
				now={live.now}
				{insights}
				{scope}
				{cards}
			/>
		</ResizableRail>
	{/if}
</main>

{#if railOpen && !wide}
	<button
		class="fixed inset-0 z-40 bg-black/40"
		aria-label="Close tasks and decisions"
		onclick={() => (railOpen = false)}
	></button>
	<div class="fixed inset-y-0 right-0 z-50 w-[min(24rem,90vw)] border-l bg-panel shadow-xl">
		<Rail
			{tasks}
			projects={fleet?.projects ?? []}
			secondMates={fleet?.secondMates ?? []}
			now={live.now}
			{insights}
			{scope}
			{cards}
			onClose={() => (railOpen = false)}
			onChat={() => (railOpen = false)}
		/>
	</div>
{/if}
