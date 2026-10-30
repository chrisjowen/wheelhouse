<script lang="ts">
	import { page } from '$app/state';

	// Settings' own row of pages; a plugin's own page is part of Plugins.
	const pages = [
		{ href: '/settings/gateway', label: 'Gateway' },
		{ href: '/settings/plugins', label: 'Plugins' }
	];
	const here = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<nav class="-ml-2.5 no-scrollbar flex gap-1 overflow-x-auto" aria-label="Settings">
	{#each pages as p (p.href)}
		<a href={p.href} aria-current={here(p.href) ? 'page' : undefined} class="nav-tab shrink-0"
			>{p.label}</a
		>
	{/each}
</nav>
