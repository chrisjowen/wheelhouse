<script lang="ts">
	import { portalHref, type PortalResult, type PortalTeam } from '$lib/portal';
	import PortalAbout from '$lib/components/wh/portal/PortalAbout.svelte';

	/** The captain's teams with a dev portal, when there is more than one (or none). */
	let { data } = $props();
	const result = $derived(data.teams as PortalResult<PortalTeam[]>);
</script>

<svelte:head><title>Dev portal · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<h1 class="text-2xl">Dev portal</h1>
		<div class="mt-4"><PortalAbout what="each service and API" /></div>
		{#if !result.ok}
			<p class="mt-4 max-w-prose text-sm" role="alert" data-testid="portal-error">
				{result.message}
			</p>
		{:else if !result.value.length}
			<p class="mt-4 max-w-prose text-sm text-muted-foreground">
				You’re in a fleet, but on no team with a dev portal yet.
			</p>
		{:else}
			<ul class="mt-5 divide-y divide-hair rounded-lg border bg-card" data-testid="portal-teams">
				{#each result.value as t (t.slug)}
					<li class="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
						{#if t.docket === 'ready'}
							<a class="font-medium underline-offset-2 hover:underline" href={portalHref(t.slug)}
								>{t.name}</a
							>
						{:else}
							<span class="font-medium">{t.name}</span>
							<span class="text-xs text-muted-foreground">no dev portal yet</span>
						{/if}
						{#if t.access === 'viewer'}<span class="text-xs text-muted-foreground"
								>reading as a Viewer</span
							>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
