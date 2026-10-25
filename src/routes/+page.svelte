<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { harbour } from '$lib/harbour';
	import { shipHealth } from '$lib/chat/health';
	import Chat from '$lib/components/firstmate/Chat.svelte';
	import Rail from '$lib/components/firstmate/Rail.svelte';
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

	// `/?chat=<task id>` (a task page's "Ask Firstmate about this") starts a message mentioning it.
	$effect(() => {
		const id = page.url.searchParams.get('chat');
		const t = id ? fleet?.tasks.find((x) => x.id === id) : null;
		if (!id || !t) return;
		composerBus.pending = {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: fleet?.projects.find((p) => p.id === t.projectId)?.name ?? null,
			url: null
		};
		const url = new URL(page.url);
		url.searchParams.delete('chat');
		replaceState(url, {});
	});

	// Narrow: the chat alone, the rail as a sheet. Wide: a docked rail, resizable, its width remembered.
	const KEY = 'wheelhouse-rail-width';
	const DEFAULT_WIDTH = 368;
	let wide = $state(true);
	let railOpen = $state(true);
	let width = $state(DEFAULT_WIDTH);
	const clamp = (w: number) =>
		Math.round(Math.min(Math.max(w, 280), Math.min(720, window.innerWidth * 0.6)));

	onMount(() => {
		try {
			const saved = Number(localStorage.getItem(KEY));
			if (saved) width = clamp(saved);
		} catch {
			// storage unavailable: the default width
		}
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

	function save() {
		try {
			localStorage.setItem(KEY, String(width));
		} catch {
			// storage unavailable: the width lasts for this page only
		}
	}
	function drag(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => (width = clamp(window.innerWidth - ev.clientX));
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			save();
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}
	function nudge(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		width = clamp(width + (e.key === 'ArrowLeft' ? 24 : -24));
		save();
	}
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
		<div class="relative shrink-0 border-l bg-muted/30" style="width: {width}px">
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize the rail"
				aria-valuenow={width}
				tabindex="0"
				class="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
				onpointerdown={drag}
				onkeydown={nudge}
				ondblclick={() => {
					width = DEFAULT_WIDTH;
					save();
				}}
			>
				<span
					class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sea group-focus-visible:bg-sea"
				></span>
				<span
					class="absolute top-1/2 left-1/2 h-8 w-1 -translate-1/2 rounded-full bg-border transition-colors group-hover:bg-sea"
				></span>
			</div>
			<Rail {tasks} projects={fleet?.projects ?? []} now={live.now} />
		</div>
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
