<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidateAll, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { addressRewrites, rewriteLinks } from '$lib/client/addresses.svelte';
	import type { RemoteView } from '$lib/cloud';
	import { slots } from '$lib/client/slots.svelte';
	import { navPageHref, slotKey, type SlotKey } from '$lib/plugins/keys';
	import type { SlotView } from '$lib/plugins/types';
	import { mainSections } from '$lib/nav';
	import { reducedMotion } from '$lib/motion';
	import Header from '$lib/components/wh/Header.svelte';
	import Sidebar from '$lib/components/wh/Sidebar.svelte';
	import TabBar from '$lib/components/wh/TabBar.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import Toasts from '$lib/components/wh/bell/Toasts.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	let dark = $state(false);
	// The home page (Firstmate's chat and the rail), On deck and a project's tab page (such
	// as the Chart) fill the viewport exactly: the page never scrolls. On phones that is
	// the height above the tab bar.
	const fixed = $derived(
		page.url.pathname === '/' ||
			page.url.pathname === '/deck' ||
			page.route.id === '/projects/[id]/[plugin]/[tab]'
	);
	const bare = $derived(page.url.pathname === '/setup');

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
				.map((e) => ({ href: navPageHref(e), label: e.title, icon: e.icon, badge: e.badge }))
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

	function toggleTheme(e?: MouseEvent) {
		const next = !dark;
		const apply = () => {
			dark = next;
			document.documentElement.classList.toggle('dark', next);
		};
		// The new theme opens as a circle from the switch.
		if (!document.startViewTransition || reducedMotion() || !e) apply();
		else {
			const x = e.clientX || innerWidth - 40;
			const y = e.clientY || 28;
			const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
			void document.startViewTransition(apply).ready.then(() =>
				document.documentElement.animate(
					{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
					{
						duration: 520,
						easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
						pseudoElement: '::view-transition-new(root)'
					}
				)
			);
		}
		try {
			localStorage.setItem('wheelhouse-theme', next ? 'dark' : 'light');
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
</script>

<svelte:head><title>Wheelhouse</title></svelte:head>

<Tooltip.Provider delayDuration={200}>
	{#if bare}
		<!-- The setup wizard stands alone: there is no Firstmate yet for the header and menu to show. -->
		{@render children()}
	{:else}
		<div
			class={fixed
				? 'flex h-dvh flex-col overflow-hidden max-md:h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-bottom,0px))]'
				: 'contents'}
		>
			<Header {dark} onToggleTheme={toggleTheme} atRisk={page.data.atRisk ?? null} {indicators} />
			<Notices />
			<div class="flex {fixed ? 'min-h-0 flex-1' : ''}">
				<Sidebar {sections} {decisionsOpen} fill={fixed} />
				<div class="wh-page min-w-0 flex-1 {fixed ? 'flex min-h-0 flex-col' : ''}">
					{@render children()}
				</div>
			</div>
		</div>
		<TabBar />
		<Toasts />
	{/if}
</Tooltip.Provider>
