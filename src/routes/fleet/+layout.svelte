<script lang="ts">
	import { Lock } from '@lucide/svelte';
	import { page } from '$app/state';
	import { fleetTabs, type FleetView } from '$lib/fleet';

	/**
	 * Fleet (behind the experimental `fleet` flag): everything beyond this computer, its
	 * pages in a row at the top. A page the fleet switched off stays in the row, locked,
	 * and opens on why.
	 */
	let { data, children } = $props();
	const tabs = $derived(
		fleetTabs(
			data.membership as FleetView | null,
			(page.data.features as { remotes?: boolean } | undefined) ?? {}
		)
	);
</script>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<nav
			class="-ml-2.5 no-scrollbar flex gap-1 overflow-x-auto border-b border-hair"
			aria-label="Fleet"
		>
			{#each tabs as t (t.href)}
				<a
					href={t.href}
					aria-current={page.url.pathname === t.href ? 'page' : undefined}
					class="nav-tab -mb-px inline-flex shrink-0 items-center gap-1.5 {t.off
						? 'opacity-60'
						: ''}"
					title={t.off?.note ?? undefined}
					data-locked={t.off ? 'true' : undefined}
					>{t.label}{#if t.off}<Lock class="size-3.5" aria-label="Switched off" />{/if}</a
				>
			{/each}
		</nav>
		{@render children()}
	</div>
</main>
