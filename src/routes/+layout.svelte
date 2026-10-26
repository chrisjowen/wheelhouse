<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { live } from '$lib/client/live.svelte';
	import Sidebar from '$lib/components/wh/Sidebar.svelte';
	import Notices from '$lib/components/wh/Notices.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Anchor, Menu } from '@lucide/svelte';

	let { children } = $props();
	let dark = $state(false);
	let menuOpen = $state(false);
	// The home page (Firstmate's chat and the rail) and a project's tab page (such as the
	// Chart) fill the viewport exactly: the page never scrolls.
	const fixed = $derived(
		page.url.pathname === '/' || page.route.id === '/projects/[id]/[plugin]/[tab]'
	);

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
	<div class="flex min-h-dvh">
		<Sidebar
			{dark}
			onToggleTheme={toggleTheme}
			atRisk={page.data.atRisk ?? null}
			bind:open={menuOpen}
		/>
		<div class="min-w-0 flex-1 {fixed ? 'flex h-dvh flex-col overflow-hidden' : ''}">
			<!-- Narrow screens: the menu folds into a drawer behind this bar. -->
			<div
				class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-b-foreground/75 bg-panel px-2 shadow-[0_3px_0_-2px_var(--brass)] md:hidden"
			>
				<button
					class="flex size-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Open the menu"
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = true)}><Menu class="size-5" /></button
				>
				<a href="/" class="flex items-center gap-2 font-logo font-semibold tracking-tight">
					<Anchor class="size-5 text-sea" aria-hidden="true" />Wheelhouse
				</a>
			</div>
			<Notices />
			{@render children()}
		</div>
	</div>
</Tooltip.Provider>
