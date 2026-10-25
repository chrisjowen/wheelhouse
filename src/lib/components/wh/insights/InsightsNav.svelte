<script lang="ts">
	import { page } from '$app/state';

	// A slim row that moves between the three insight pages.
	const pages = [
		{ href: '/decisions', label: 'Decided for you' },
		{ href: '/time', label: 'Where time went' },
		{ href: '/headroom', label: 'Headroom' }
	];
</script>

<nav class="no-scrollbar flex gap-1 overflow-x-auto text-sm" aria-label="Insights">
	{#each pages as p (p.href)}
		<a
			href={p.href}
			aria-current={page.url.pathname === p.href ? 'page' : undefined}
			class="shrink-0 rounded-md px-2.5 py-1 whitespace-nowrap {page.url.pathname === p.href
				? 'bg-accent font-medium'
				: 'text-muted-foreground hover:text-foreground'}">{p.label}</a
		>
	{/each}
</nav>
