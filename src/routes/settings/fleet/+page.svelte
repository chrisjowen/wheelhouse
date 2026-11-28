<script lang="ts">
	import { ShipWheel } from '@lucide/svelte';
	import { page } from '$app/state';
	import type { FleetView } from '$lib/fleet';
	import AlreadyRemote from '$lib/components/wh/remotes/AlreadyRemote.svelte';
	import FleetPanel from '$lib/components/wh/settings/FleetPanel.svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/**
	 * Join a fleet through a gateway, see what this ship may use there, and leave. While the
	 * experimental `fleet` flag is on, joining and the fleet itself are Fleet's: this keeps the
	 * gateways, and leaving.
	 */
	let { data } = $props();
	const fleetArea = $derived(
		(page.data.features as { fleet?: boolean } | undefined)?.fleet === true
	);
</script>

<svelte:head><title>Fleet · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Fleet</h1>
		{#if fleetArea}
			<p
				class="mt-3 flex max-w-prose items-start gap-2.5 rounded-md border bg-muted/40 px-3.5 py-3 text-sm"
				data-testid="fleet-moved"
			>
				<ShipWheel class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span
					>Your fleet has its own place now: <a class="font-medium underline" href="/fleet">Fleet</a
					>
					in the menu shows {(data.view as FleetView | null)?.state === 'not-joined'
						? 'how to join'
						: 'which fleet you’re in, what this ship may use and why anything is off'}. Gateways and
					leaving stay here.</span
				>
			</p>
		{:else}
			<p class="mt-1 max-w-prose text-sm text-muted-foreground">
				Join a fleet to reach this ship from anywhere, add cloud second mates, and work with a team.
				Everyone has a fleet of their own on Fleetyard; a company's fleet adds its teams.
			</p>
		{/if}
		{#if data.view}<FleetPanel
				view={data.view as FleetView}
				admin={fleetArea}
			/>{:else if data.gateway}<AlreadyRemote gateway={data.gateway} />{/if}
	</div>
</main>
