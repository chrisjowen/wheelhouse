<script lang="ts">
	import { page } from '$app/state';
	import { LOGBOOK_ROW as pages } from '$lib/nav';
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
