<script lang="ts">
	import AlreadyRemote from '$lib/components/wh/remotes/AlreadyRemote.svelte';

	/**
	 * Reached only when the request came through the relay (see +page.server.ts):
	 * a direct, local visit redirects to Settings → Fleet before this ever renders.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Fleet · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<h1 class="text-2xl">Gateway settings moved</h1>
		<p class="mt-2 text-sm text-muted-foreground">
			The gateway and this ship's pairing are now in <a class="underline" href="/settings/fleet"
				>Settings → Fleet</a
			>.
		</p>
		{#if data.gateway}<AlreadyRemote gateway={data.gateway} />{/if}
	</div>
</main>
