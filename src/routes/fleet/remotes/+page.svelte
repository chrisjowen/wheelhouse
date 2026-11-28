<script lang="ts">
	import type { CloudView } from '$lib/cloud';
	import { switchedOff, type FleetView } from '$lib/fleet';
	import AlreadyRemote from '$lib/components/wh/remotes/AlreadyRemote.svelte';
	import RemotesPanel from '$lib/components/wh/remotes/RemotesPanel.svelte';
	import SwitchedOff from '$lib/components/wh/fleet/SwitchedOff.svelte';

	/**
	 * Fleet → Remotes: the Remotes page, under Fleet while the `fleet` flag is on (/remotes
	 * comes here). When the fleet switched remote access off it says why instead; while
	 * remote access still runs, Stop stays below.
	 */
	let { data } = $props();
	const membership = $derived(data.membership as FleetView | null);
	const off = $derived(switchedOff(membership, 'remotes'));
	const view = $derived(data.view as CloudView | null);
	const running = $derived(!!view && view.enabled && view.started && !!view.device);
</script>

<svelte:head><title>Remotes · Fleet · Wheelhouse</title></svelte:head>

<p class="mono-label mt-6">Fleet · Remotes</p>
<h1 class="mt-2 text-2xl">Reach this ship from <em class="text-gold">anywhere</em></h1>
{#if off}
	<SwitchedOff feature={off} fleet={membership?.fleet?.name ?? null} />
{/if}
{#if view}
	{#if !off || running}
		<p class="mt-3 max-w-prose text-sm text-muted-foreground">
			Reach this Wheelhouse from any browser through a Wheelhouse Cloud gateway. Firstmate, its crew
			and this page keep running on this machine; the gateway only carries the connection, which
			this machine opens to it. Remote access is off until you start it here.
		</p>
		<RemotesPanel {view} />
	{/if}
{:else if data.gateway}
	<AlreadyRemote gateway={data.gateway} />
{/if}
