<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import Header from '$lib/components/wh/Header.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	let dark = $state(false);
	// The home page (Firstmate's chat and the rail) fills the viewport exactly: the page never scrolls.
	const fixed = $derived(page.url.pathname === '/');

	onMount(() => {
		dark = document.documentElement.classList.contains('dark');
		return live.connect();
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
		<Header {dark} onToggleTheme={toggleTheme} />
		<Notices />
		{@render children()}
	</div>
</Tooltip.Provider>
