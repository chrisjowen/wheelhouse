<script lang="ts">
	import { safeHref } from '$lib/plugins/blocks';
	import { BookOpen, ExternalLink, GitPullRequest } from '@lucide/svelte';
	import type { ProjectSummary } from './types';

	/** The Project links plugin's own Harbour card: a compiled-in first-party panel. */
	let { data }: { data: unknown } = $props();
	const s = $derived(data as ProjectSummary);
	const repo = $derived(safeHref(s.repoUrl));
	const readme = $derived(safeHref(s.readme?.url));
	const open = $derived(s.pulls.filter((p) => !p.landed));
</script>

<div class="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
	{#if repo}
		<a
			href={repo}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 text-sea hover:underline"
			>{repo.replace(/^https:\/\//, '')}<ExternalLink class="size-3.5" aria-hidden="true" /></a
		>
	{:else}
		<span class="text-muted-foreground">No repository link</span>
	{/if}
	{#if readme}
		<a
			href={readme}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 hover:underline"
			><BookOpen class="size-3.5 text-muted-foreground" aria-hidden="true" />{s.readme?.title}</a
		>
	{/if}
	<span class="inline-flex items-center gap-1 text-muted-foreground">
		<GitPullRequest class="size-3.5" aria-hidden="true" />{open.length}
		open {open.length === 1 ? 'pull request' : 'pull requests'}
	</span>
</div>
