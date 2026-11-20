<script lang="ts">
	import { page } from '$app/state';
	import { HEALTH_TAB, LOGBOOK_ROW } from '$lib/nav';

	// Health, before Plugins, while Soundings (the experimental `soundings` feature) is on.
	const pages = $derived(
		(page.data.features as { soundings?: boolean } | undefined)?.soundings
			? [...LOGBOOK_ROW.slice(0, -1), HEALTH_TAB, ...LOGBOOK_ROW.slice(-1)]
			: LOGBOOK_ROW
	);
</script>

<nav class="-ml-2.5 no-scrollbar flex gap-1 overflow-x-auto" aria-label="Logbook">
	{#each pages as p (p.href)}
		<a
			href={p.href}
			aria-current={page.url.pathname === p.href ? 'page' : undefined}
			class="nav-tab shrink-0">{p.label}</a
		>
	{/each}
</nav>
