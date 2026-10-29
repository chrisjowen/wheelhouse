<script lang="ts">
	/**
	 * The home rail's slice of the decision inbox: the next few questions still
	 * waiting, each answerable in one tap, and a link to the full Decisions page.
	 */
	import { ArrowRight } from '@lucide/svelte';
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import { awaitsAnswer, type InboxAction, type InboxCard } from '$lib/inbox';
	import type { Project } from '$lib/types';
	import DecisionCard from './DecisionCard.svelte';

	let {
		projects,
		now,
		scope = null,
		limit = 3
	}: { projects: Project[]; now: number; scope?: string | null; limit?: number } = $props();

	const view = $derived(inbox.value);
	const cards = $derived(inbox.shown(now).shown.filter((c) => !scope || c.projectId === scope));
	const waiting = $derived(cards.filter(awaitsAnswer));
	// Just-answered cards stay a moment, so the tap visibly lands.
	const stack = $derived(
		cards.filter((c) => awaitsAnswer(c) || inbox.pending[c.id]).slice(0, limit)
	);
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (projects.find((p) => p.id === id)?.name ?? id);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');

	const answer = (c: InboxCard, choice: InboxAction) => inbox.answer(c, choice, null, token);
</script>

{#if view?.available && (waiting.length || stack.length)}
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="section-label flex-1">Decisions</h2>
		<a href="/inbox" class="text-xs text-muted-foreground hover:text-foreground"
			>{waiting.length > stack.length ? `All ${waiting.length}` : 'Open'}</a
		>
	</div>
	<ul class="mb-6 flex flex-col gap-2">
		{#each stack as c (c.id)}
			<li>
				<DecisionCard
					card={c}
					project={projectName(c.projectId)}
					compact
					canAnswer={view.canAnswer}
					error={inbox.errors[c.id] ?? null}
					{now}
					onAnswer={(choice) => answer(c, choice)}
					onLater={() => inbox.later(c.id)}
					onClose={() => answer(c, 'close')}
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
