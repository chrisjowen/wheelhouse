<script lang="ts">
	import '../app.css';
	import { onMount, untrack } from 'svelte';
	import { afterNavigate, invalidateAll, onNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { currentCrew, live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { inboxSignal } from '$lib/inbox';
	import { addressRewrites, rewriteLinks, translateLinks } from '$lib/client/addresses.svelte';
	import type { RemoteView } from '$lib/cloud';
	import type { HostedView } from '$lib/hosted';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import { mainSections } from '$lib/nav';
	import { reducedMotion } from '$lib/motion';
	import { readTheme, theme, toggleTheme } from '$lib/client/theme.svelte';
	import { startBeacon } from '$lib/client/beacon';
	import { remoteSession } from '$lib/client/remote-session.svelte';
	import Header from '$lib/components/wh/Header.svelte';
	import Sidebar from '$lib/components/wh/Sidebar.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import RemoteSessionNotice from '$lib/components/wh/RemoteSessionNotice.svelte';
	import SlideoutHost from '$lib/components/wh/SlideoutHost.svelte';
	import NotificationsSheet from '$lib/components/wh/bell/NotificationsSheet.svelte';
	import FocusView from '$lib/components/wh/focus/FocusView.svelte';
	import { calls } from '$lib/client/calls.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	// The home page (Firstmate's chat and the rail), On deck, the Crew page, Decisions and a project's
	// tab page (such as the Chart) fill the viewport exactly: the page never scrolls. On
	// phones it keeps clear of the home bar.
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
	// It re-reads only when what it is built from changed, and only in a tab that is showing.
	$effect(() => inbox.seed(page.data.inbox));
	const inboxSources = $derived(inboxSignal(live.fleet, live.messages));
	// Addresses on Wheelhouse's computer open where a plugin's address rewrite says, while it is on.
	$effect(() => {
		addressRewrites.to = (page.data.addressRewrites as string[] | undefined)?.[0] ?? null;
		// Through Wheelhouse Cloud they open on the relay's host for their port instead.
		addressRewrites.remote = (page.data.remote as RemoteView | null | undefined) ?? null;
		// In a hosted dev environment (Gitpod, Codespaces, a configured pattern) at its public URL for their port.
		addressRewrites.hosted = (page.data.hosted as HostedView | null | undefined) ?? null;
	});
	$effect(() => {
		void inboxSources;
		inbox.changed();
	});
	// A call the captain saw that leaves without their answer stays, cleared, until put away.
	$effect(() => {
		const view = inbox.value;
		untrack(() => calls.track(view));
	});

	// Focus mode replaces the app with one quiet screen of the calls (FocusView), on every page
	// but the setup wizard and a live review's panel. `?focus=1` (or 0) opens a link in it, or out.
	// Only once the router has started: replaceState before then throws.
	let routed = $state(false);
	afterNavigate(() => (routed = true));
	$effect(() => {
		const asked = page.url.searchParams.get('focus');
		if (!routed || (asked !== '1' && asked !== '0')) return;
		calls.setFocus(asked === '1');
		const url = new URL(page.url);
		url.searchParams.delete('focus');
		replaceState(url, page.state);
	});
	const focus = $derived(calls.focus === true && !bare);

	// Soundings (experimental): this page's trouble goes to the Health page, from when it is turned on.
	$effect(() => {
		if ((page.data.features as { soundings?: boolean } | undefined)?.soundings)
			startBeacon(() => page.data.sessionToken as string | undefined);
	});

	// Through Wheelhouse Cloud, a lost stream may mean the remote session ended or the machine is offline;
	// a tab that only follows the leader's stream hears of it here.
	$effect(() => {
		if (live.connection === 'lost') void remoteSession.check();
	});

	onMount(() => {
		inbox.load();
		calls.load(matchMedia('(width < 48rem)').matches);
		const unremote = remoteSession.start(page.data.relayed === true);
		readTheme();
		// Wheelhouse restarted its server: reload every page's data and the new session token.
		const unwatch = live.onRestart(() => void invalidateAll());
		const disconnect = live.connect();
		const unrewrite = rewriteLinks(document);
		// Seen through Wheelhouse Cloud (or a hosted environment), links show where they open, marked.
		const untranslate = translateLinks(document);
		const shown = () => {
			if (!document.hidden) inbox.visible();
		};
		document.addEventListener('visibilitychange', shown);
		return () => {
			unremote();
			unwatch();
			disconnect();
			unrewrite();
			untranslate();
			document.removeEventListener('visibilitychange', shown);
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
	/** The home page's chat, whose own bar is a phone's only bar at the top. */
	const phoneChat = $derived(page.url.pathname === '/');
</script>

<svelte:head><title>Wheelhouse</title></svelte:head>

<Tooltip.Provider delayDuration={200}>
	{#if bare}
		<!-- The setup wizard (no Firstmate yet for the header and menu to show) and a live review's panel stand alone. -->
		{@render children()}
	{:else if focus}
		<div class="flex h-dvh flex-col overflow-hidden" data-focus-mode>
			<Header dark={theme.dark} onToggleTheme={toggleTheme} focus {sections} {decisionsOpen} />
			<RemoteSessionNotice />
			<FocusView />
		</div>
		<!-- A task opened from the calm line slides out over focus mode. -->
		<SlideoutHost />
	{:else}
		<div
			class={fixed
				? 'flex h-dvh flex-col overflow-hidden max-md:pb-[env(safe-area-inset-bottom,0px)]'
				: 'contents'}
		>
			<!-- A phone's chat page leaves the header out: the chat's own bar has the menu button (and picks the lane). -->
			<div class={phoneChat ? 'contents max-md:hidden' : 'contents'}>
				<Header
					dark={theme.dark}
					onToggleTheme={toggleTheme}
					atRisk={page.data.atRisk ?? null}
					{indicators}
					{sections}
					{decisionsOpen}
				/>
			</div>
			<RemoteSessionNotice />
			<Notices />
			{#if (page.data.features as { events?: boolean } | undefined)?.events && (live.eventsPaused ?? page.data.eventsPaused)}<a
					href="/settings/events"
					class="block border-b bg-amber-100 px-6 py-2 text-sm text-amber-950"
					>Events paused · Reminders are held until you resume them in Settings → Events.</a
				>{/if}
			<div class="flex {fixed ? 'min-h-0 flex-1' : ''}">
				<Sidebar {sections} {decisionsOpen} fill={fixed} />
				<div
					class="wh-page min-w-0 flex-1 {fixed
						? 'flex min-h-0 flex-col'
						: 'max-md:pb-[env(safe-area-inset-bottom,0px)]'}"
				>
					{@render children()}
				</div>
			</div>
		</div>
		<NotificationsSheet />
		<!-- A task, or the open decisions, slid out over any page. -->
		<SlideoutHost />
	{/if}
</Tooltip.Provider>
