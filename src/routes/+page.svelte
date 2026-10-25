<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { harbour } from '$lib/harbour';
	import { shipHealth } from '$lib/chat/health';
	import { chatMention } from '$lib/chat/mention';
	import Chat from '$lib/components/firstmate/Chat.svelte';
	import Rail from '$lib/components/firstmate/Rail.svelte';
	import ResizableRail from '$lib/components/wh/ResizableRail.svelte';
	import { composerBus } from '$lib/components/firstmate/bus.svelte';
	import { replaceState } from '$app/navigation';

	/**
	 * The home page: one pane for talking to Firstmate and keeping an eye on the
	 * fleet. The chat fills the width; the rail on the right (resizable, and a
	 * sheet on narrow screens) lists what needs the captain and what is in play.
	 * The full board is the Harbour tab.
	 */
	let { data } = $props();

	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const tasks = $derived((fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope));
	const h = $derived(harbour(tasks, live.now));
	const health = $derived(shipHealth(h));
	const waiting = $derived(h.needsYou.length + h.stepFailed.length);
	const pluginEntries = $derived(slots.entries(slotKey.fleet, data.slots, data.slotsAt));
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, data.slotsAt);
	});

	// `/?chat=<task id>` (a task page's "Ask Firstmate about this") starts a message mentioning it, once.
	const mention = chatMention();
	$effect(() => {
		const ref = mention(page.url, fleet);
		if (!ref) return;
		composerBus.pending = ref;
		const url = new URL(page.url);
		url.searchParams.delete('chat');
		replaceState(url, {});
	});

	// Narrow: the chat alone, the rail as a sheet. Wide: a docked rail, resizable, its width remembered.
	let wide = $state(true);
	let railOpen = $state(true);

	onMount(() => {
		const mq = window.matchMedia('(min-width: 1024px)');
		const sync = () => {
			wide = mq.matches;
			railOpen = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		const disconnect = firstmateChat.connect();
		return () => {
			mq.removeEventListener('change', sync);
			disconnect();
		};
	});
</script>

<svelte:head><title>Firstmate · Wheelhouse</title></svelte:head>

<main class="flex min-h-0 flex-1">
	<Chat
		token={data.sessionToken}
		{railOpen}
		{waiting}
		{health}
		now={live.now}
		{pluginEntries}
		onToggleRail={() => (railOpen = !railOpen)}
	/>
	{#if railOpen && wide}
		<ResizableRail storageKey="wheelhouse-rail-width" label="Resize the rail" class="bg-muted/30">
			<Rail {tasks} projects={fleet?.projects ?? []} now={live.now} />
		</ResizableRail>
	{/if}
</main>

{#if railOpen && !wide}
	<button
		class="fixed inset-0 z-40 bg-black/40"
		aria-label="Close tasks and decisions"
		onclick={() => (railOpen = false)}
	></button>
	<div class="fixed inset-y-0 right-0 z-50 w-[min(24rem,90vw)] border-l bg-background shadow-xl">
		<Rail
			{tasks}
			projects={fleet?.projects ?? []}
			now={live.now}
			onClose={() => (railOpen = false)}
			onChat={() => (railOpen = false)}
		/>
	</div>
{/if}
