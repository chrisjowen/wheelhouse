<script lang="ts">
	import type { CloudView } from '$lib/cloud';
	import RemotesPanel from '$lib/components/wh/remotes/RemotesPanel.svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/**
	 * Settings → Cloud: the same remote access as the Remotes page (see
	 * RemotesPanel), the gateway among it, beside the other settings.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Cloud · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Cloud</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Reach this Wheelhouse from any browser through a Wheelhouse Cloud gateway: the default one, or
			your own. Remote access is off until you start it, here or on <a
				class="underline"
				href="/remotes">Remotes</a
			>.
		</p>
		<RemotesPanel view={data.view as CloudView} />
	</div>
</main>
