<script lang="ts">
	import { page } from '$app/state';

	// The Logbook's own row: the session and headroom pages, Headroom first.
	const pages = [
		{ href: '/headroom', label: 'Headroom' },
		{ href: '/time', label: 'Where time went' },
		{ href: '/decisions', label: 'Decided for you' }
	];
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
