<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidateAll, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { currentCrew, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { addressRewrites, rewriteLinks } from '$lib/client/addresses.svelte';
	import type { RemoteView } from '$lib/cloud';
	import type { HostedView } from '$lib/hosted';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import { mainSections } from '$lib/nav';
	import { reducedMotion } from '$lib/motion';
	import { readTheme, theme, toggleTheme } from '$lib/client/theme.svelte';
	import Header from '$lib/components/wh/Header.svelte';
	import Sidebar from '$lib/components/wh/Sidebar.svelte';
	import TabBar from '$lib/components/wh/TabBar.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import Toasts from '$lib/components/wh/bell/Toasts.svelte';
	import SlideoutHost from '$lib/components/wh/SlideoutHost.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	// The home page (Firstmate's chat and the rail), On deck, the Crew page, Decisions and a project's
	// tab page (such as the Chart) fill the viewport exactly: the page never scrolls. On
	// phones that is the height above the tab bar.
	const fixed = $derived(
		page.url.pathname === '/' ||
			page.url.pathname === '/deck' ||
			page.url.pathname === '/crew' ||
			page.url.pathname === '/inbox' ||
			page.route.id === '/projects/[id]/[plugin]/[tab]'
	);
	// The setup wizard, and a live review's panel (framed on the page under review), stand alone.
	const bare = $derived(
		page.url.pathname === '/setup' || page.url.pathname.startsWith('/live-review/')
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
				.map((e) => ({ href: navPageHref(e), label: e.title, icon: e.icon, badge: e.badge })),
			currentCrew()?.discussions.length ?? 0,
			(page.data.features as { remotes?: boolean } | undefined) ?? {}
		)
	);
	const indicators = $derived(fleetEntries.filter((e) => e.slot === 'header.indicator'));
	// Questions waiting for an answer, without the ones asked about later in this browser.
	const decisionsOpen = $derived(inbox.open(live.now));

	// The inbox follows the fleet and the messages: a closed question leaves, an answer shows as sent.
	$effect(() => inbox.seed(page.data.inbox));
	// Addresses on Wheelhouse's computer open where a plugin's address rewrite says, while it is on.
	$effect(() => {
		addressRewrites.to = (page.data.addressRewrites as string[] | undefined)?.[0] ?? null;
		// Through Wheelhouse Cloud they open on the relay's host for their port instead.
		addressRewrites.remote = (page.data.remote as RemoteView | null | undefined) ?? null;
		// In a hosted dev environment (Gitpod, Codespaces, a configured pattern) at its public URL for their port.
		addressRewrites.hosted = (page.data.hosted as HostedView | null | undefined) ?? null;
	});
	$effect(() => {
		void live.revision;
		void live.messages;
		inbox.refresh();
	});

	onMount(() => {
		inbox.load();
		readTheme();
		// Wheelhouse restarted its server: reload every page's data and the new session token.
		const unwatch = live.onRestart(() => void invalidateAll());
		const disconnect = live.connect();
		const unrewrite = rewriteLinks(document);
		return () => {
			unwatch();
			disconnect();
			unrewrite();
		};
	});

	// Between pages, the page body cross-fades and settles while the header and menu stay put
	// (app.css). Only a change of page: a new tab or filter in the same page swaps at once.
	onNavigate((nav) => {
		if (!document.startViewTransition || reducedMotion()) return;
		if (!nav.from || !nav.to || nav.from.url.pathname === nav.to.url.pathname) return;
		const root = document.documentElement;
		return new Promise((resolve) => {
			root.dataset.pageChange = '';
			const t = document.startViewTransition(async () => {
				resolve();
				await nav.complete;
			});
			void t.finished.finally(() => delete root.dataset.pageChange);
		});
	});
	/** The home page's chat with lanes on (the experimental `lanes` feature), which slims a phone's bars. */
	const lanesChat = $derived(
		page.url.pathname === '/' &&
			(page.data.features as { lanes?: boolean } | undefined)?.lanes === true
	);
</script>

<svelte:head><title>Wheelhouse</title></svelte:head>

<Tooltip.Provider delayDuration={200}>
	{#if bare}
		<!-- The setup wizard (no Firstmate yet for the header and menu to show) and a live review's panel stand alone. -->
		{@render children()}
	{:else}
		<div
			class={fixed
				? 'flex h-dvh flex-col overflow-hidden max-md:h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-bottom,0px))]'
				: 'contents'}
		>
			<!-- With chat lanes on, a phone's chat page leaves the header out: the chat's own bar picks the lane. -->
			<div class={lanesChat ? 'contents max-md:hidden' : 'contents'}>
				<Header
					dark={theme.dark}
					onToggleTheme={toggleTheme}
					atRisk={page.data.atRisk ?? null}
					{indicators}
				/>
			</div>
			<Notices />
			{#if (page.data.features as { events?: boolean } | undefined)?.events && (live.eventsPaused ?? page.data.eventsPaused)}<a
					href="/settings/events"
					class="block border-b bg-amber-100 px-6 py-2 text-sm text-amber-950"
					>Events paused · Reminders are held until you resume them in Settings → Events.</a
				>{/if}
			<div class="flex {fixed ? 'min-h-0 flex-1' : ''}">
				<Sidebar {sections} {decisionsOpen} fill={fixed} />
				<div class="wh-page min-w-0 flex-1 {fixed ? 'flex min-h-0 flex-col' : ''}">
					{@render children()}
				</div>
			</div>
		</div>
		<TabBar />
		<Toasts />
		<!-- A task, or the open decisions, slid out over any page. -->
		<SlideoutHost />
	{/if}
</Tooltip.Provider>
