<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { localProxy, proxyLinks } from '$lib/client/localproxy.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import { mainSections } from '$lib/nav';
	import Header from '$lib/components/wh/Header.svelte';
	import Sidebar from '$lib/components/wh/Sidebar.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import Toasts from '$lib/components/wh/bell/Toasts.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	let dark = $state(false);
	// The home page (Firstmate's chat and the rail) and a project's tab page (such as the
	// Chart) fill the viewport exactly: the page never scrolls.
	const fixed = $derived(
		page.url.pathname === '/' || page.route.id === '/projects/[id]/[plugin]/[tab]'
	);

	// Fleet plugin entries: menu pages (nav.page) after the built-in sections, and the
	// header's small indicators. No page waits on them: the layout takes them from a page
	// that loaded them, else fetches them.
	const pageSlots = $derived(page.data.slots as Record<SlotKey, SlotView> | undefined);
	const fleetSlotsAt = $derived(
		pageSlots?.[slotKey.fleet] ? ((page.data.slotsAt as number | undefined) ?? 0) : 0
	);
	const fleetEntries = $derived(
		slots.entries(slotKey.fleet, pageSlots, fleetSlotsAt).filter((e) => e.content.available)
	);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.fleet, fleetSlotsAt);
	});
	const sections = $derived(
		mainSections(
			page.url.pathname,
			fleetEntries
				.filter((e) => e.slot === 'nav.page')
				.map((e) => ({ href: navPageHref(e), label: e.title }))
		)
	);
	const indicators = $derived(fleetEntries.filter((e) => e.slot === 'header.indicator'));
	// Questions waiting for an answer, without the ones asked about later in this browser.
	const decisionsOpen = $derived(inbox.open(live.now));

	// The inbox follows the fleet and the messages: a closed question leaves, an answer shows as sent.
	$effect(() => inbox.seed(page.data.inbox));
	// Addresses on Wheelhouse's computer open through it while the Localhost proxy plugin is on.
	$effect(() => {
		localProxy.on = page.data.localProxy === true;
	});
	$effect(() => {
		void live.revision;
		void live.messages;
		inbox.refresh();
	});

	onMount(() => {
		inbox.load();
		dark = document.documentElement.classList.contains('dark');
		// Wheelhouse restarted its server: reload every page's data and the new session token.
		const unwatch = live.onRestart(() => void invalidateAll());
		const disconnect = live.connect();
		const unproxy = proxyLinks(document);
		return () => {
			unwatch();
			disconnect();
			unproxy();
		};
	});

	function toggleTheme() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		try {
			localStorage.setItem('wheelhouse-theme', dark ? 'dark' : 'light');
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
</script>

<svelte:head><title>Wheelhouse</title></svelte:head>

<Tooltip.Provider delayDuration={200}>
	<div class={fixed ? 'flex h-dvh flex-col overflow-hidden' : 'contents'}>
		<Header
			{dark}
			onToggleTheme={toggleTheme}
			atRisk={page.data.atRisk ?? null}
			{sections}
			{decisionsOpen}
			{indicators}
		/>
		<Notices />
		<div class="flex {fixed ? 'min-h-0 flex-1' : ''}">
			<Sidebar {sections} {decisionsOpen} fill={fixed} />
			<div class="min-w-0 flex-1 {fixed ? 'flex min-h-0 flex-col' : ''}">
				{@render children()}
			</div>
		</div>
	</div>
	<Toasts />
</Tooltip.Provider>
