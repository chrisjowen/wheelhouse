<script lang="ts">
	import type { CloudView } from '$lib/cloud';
	import RemotesPanel from '$lib/components/wh/remotes/RemotesPanel.svelte';

	/**
	 * Remotes: reach this Wheelhouse from any browser through a Wheelhouse Cloud
	 * gateway. Off until started here (see RemotesPanel); this page answers only
	 * on this machine.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Remotes · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<h1 class="text-2xl">Remotes</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Reach this Wheelhouse from any browser through a Wheelhouse Cloud gateway. Firstmate, its crew
			and this page keep running on this machine; the gateway only carries the connection, which
			this machine opens to it. Remote access is off until you start it here.
		</p>
		<RemotesPanel view={data.view as CloudView} />
	</div>
</main>
