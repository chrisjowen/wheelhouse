<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { live } from '$lib/client/live.svelte';
	import Header from '$lib/components/wh/Header.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let { children } = $props();
	let dark = $state(false);

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
	<Header {dark} onToggleTheme={toggleTheme} />
	<Notices />
	{@render children()}
</Tooltip.Provider>
