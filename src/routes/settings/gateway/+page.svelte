<script lang="ts">
	import type { CloudView } from '$lib/cloud';
	import GatewayProfile from '$lib/components/wh/settings/GatewayProfile.svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/** The shared Gateway profile used by remote access and future Gateway features. */
	let { data } = $props();
</script>

<svelte:head><title>Gateway · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Gateway</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			One Gateway connection is shared by remote access, second mates and future event delivery. The
			default is Fleetyard; you can choose another Gateway or a local one for testing.
		</p>
		<GatewayProfile initial={data.view as CloudView} />
	</div>
</main>
