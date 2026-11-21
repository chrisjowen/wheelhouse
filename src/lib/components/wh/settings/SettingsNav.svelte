<script lang="ts">
	import { page } from '$app/state';

	// Settings' own row of pages; a plugin's own page is part of Plugins.
	const pages = [
		{ href: '/settings/gateway', label: 'Gateway' },
		{ href: '/settings/firstmate', label: 'Firstmate' },
		{ href: '/settings/events', label: 'Events' },
		{ href: '/settings/plugins', label: 'Plugins' },
		{ href: '/settings/material', label: 'Agent material' },
		{ href: '/settings/chat', label: 'Chat history' },
		{ href: '/settings/voice', label: 'Voice' },
		{ href: '/settings/headroom', label: 'Headroom' },
		{ href: '/settings/discussion', label: 'Discussion' },
		{ href: '/settings/update', label: 'Update' },
		{ href: '/settings/setup', label: 'Setup' },
		{ href: '/settings/experimental', label: 'Experimental features' }
	].filter((item) => {
		const features = page.data.features as
			{ events?: boolean; remotes?: boolean; discussion?: boolean } | undefined;
		if (item.href === '/settings/gateway') return features?.remotes;
		if (item.href === '/settings/events') return features?.events;
		if (item.href === '/settings/discussion') return features?.discussion;
		return true;
	});
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
