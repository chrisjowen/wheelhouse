<script lang="ts">
	import type { FleetView } from '$lib/fleet';
	import AlreadyRemote from '$lib/components/wh/remotes/AlreadyRemote.svelte';
	import FleetPanel from '$lib/components/wh/settings/FleetPanel.svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/** Join a fleet through a gateway, see what this ship may use there, and leave. */
	let { data } = $props();
</script>

<svelte:head><title>Fleet · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Fleet</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Join a fleet to reach this ship from anywhere, add cloud second mates, and work with a team.
			Everyone has a fleet of their own on Fleetyard; a company's fleet adds its teams.
		</p>
		{#if data.view}<FleetPanel view={data.view as FleetView} />{:else if data.gateway}<AlreadyRemote
				gateway={data.gateway}
			/>{/if}
	</div>
</main>
