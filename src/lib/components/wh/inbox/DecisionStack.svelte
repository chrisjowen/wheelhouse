<script lang="ts">
	/**
	 * On deck's slice of the decision inbox: the next few questions still
	 * waiting, each in the same decision box as the Decisions page, and a link
	 * to the full page. An answered question leaves at once.
	 */
	import { ArrowRight } from '@lucide/svelte';
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import type { InboxView } from '$lib/inbox';
	import type { Project } from '$lib/types';
	import OpenDecision from './OpenDecision.svelte';

	let {
		projects,
		now,
		scope = null,
		limit = 3
	}: { projects: Project[]; now: number; scope?: string | null; limit?: number } = $props();

	// The page's own inbox until the live one is read, so the server draws the same stack.
	const seed = $derived(page.data.inbox as InboxView | undefined);
	const view = $derived(inbox.view(seed));
	const waiting = $derived(
		inbox.shown(now, seed).shown.filter((c) => !scope || c.projectId === scope)
	);
	const stack = $derived(waiting.slice(0, limit));
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (projects.find((p) => p.id === id)?.name ?? id);
</script>

{#if view?.available && stack.length}
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="section-label flex-1">Decisions</h2>
		<a href="/inbox" class="text-xs text-muted-foreground hover:text-foreground"
			>{waiting.length > stack.length ? `All ${waiting.length}` : 'Open'}</a
		>
	</div>
	<ul class="mb-6 flex flex-col gap-2">
		{#each stack as c (c.id)}
			<li>
				<OpenDecision
					card={c}
					project={projectName(c.projectId)}
					{now}
					onLater={() => inbox.later(c.id)}
				/>
			</li>
		{/each}
	</ul>
	{#if waiting.length > stack.length}
		<a
			href="/inbox"
			class="-mt-4 mb-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>{waiting.length - stack.length} more in Decisions <ArrowRight class="size-3.5" /></a
		>
	{/if}
{/if}
