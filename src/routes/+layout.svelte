<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
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

	// The inbox follows the fleet and the messages: a closed question leaves, an answer shows as sent.
	$effect(() => inbox.seed(page.data.inbox));
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
		return () => {
			unwatch();
			disconnect();
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
		<Header {dark} onToggleTheme={toggleTheme} atRisk={page.data.atRisk ?? null} />
		<Notices />
		<div class="flex {fixed ? 'min-h-0 flex-1' : ''}">
			<Sidebar fill={fixed} />
			<div class="min-w-0 flex-1 {fixed ? 'flex min-h-0 flex-col' : ''}">
				{@render children()}
			</div>
		</div>
	</div>
	<Toasts />
</Tooltip.Provider>
