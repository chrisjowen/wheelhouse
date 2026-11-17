<script lang="ts">
	/**
	 * Where decisions are mentioned outside the Decisions page (a task's page and
	 * slide-out, On deck's Needs you), a small badge in place of copies of them:
	 * how many are open for the task or project and how many wait on the
	 * captain, with the one that needs them first. Selecting it opens the
	 * Decisions slide-out filtered to them (on that one, when it is the only
	 * one), where they are answered. Nothing shows while none is open.
	 */
	import { ChevronRight, Hand } from '@lucide/svelte';
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import { slideout } from '$lib/client/slideout.svelte';
	import { decisionCount, openDecisions, standing, type DecisionFilter } from '$lib/decisionhome';
	import type { InboxView } from '$lib/inbox';

	let {
		filter,
		label = null,
		compact = false
	}: {
		filter: DecisionFilter;
		/** What the slide-out says it is filtered to (else the task's or project's name). */
		label?: string | null;
		/** One line, for the rail. */
		compact?: boolean;
	} = $props();

	const seed = $derived(page.data.inbox as InboxView | undefined);
	const cards = $derived(
		inbox.view(seed)?.available ? openDecisions(inbox.cards(seed), filter) : []
	);
	const waiting = $derived(cards.filter((c) => standing(c) === 'waiting').length);
	const first = $derived(cards[0] ?? null);

	function open() {
		slideout.openDecisions(filter, cards.length === 1 ? cards[0].id : null, label);
	}
</script>

{#if first}
	<button
		type="button"
		class="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring {waiting
			? 'border-sea/40 bg-sea/[0.07] hover:bg-sea/[0.12]'
			: 'bg-card hover:bg-muted/60'} {compact ? 'px-2.5 py-2' : 'px-3.5 py-2.5'}"
		aria-haspopup="dialog"
		onclick={open}
		data-decisions-badge={waiting ? 'waiting' : 'open'}
	>
		<span
			class="grid shrink-0 place-items-center rounded-full {waiting
				? 'bg-sea text-on-accent'
				: 'bg-muted text-foreground/70'} {compact ? 'size-6' : 'size-7'}"
			aria-hidden="true"><Hand class={compact ? 'size-3.5' : 'size-4'} /></span
		>
		<span class="min-w-0 flex-1">
			<span class="flex items-baseline gap-1.5 text-sm">
				<span class="shrink-0 font-semibold {waiting ? 'text-sea' : ''}"
					>{decisionCount(cards.length)}</span
				>
				<span class="truncate text-muted-foreground"
					>{waiting
						? waiting === cards.length
							? cards.length === 1
								? 'waiting on you'
								: 'all waiting on you'
							: `${waiting} waiting on you`
						: 'Firstmate is handling'}</span
				>
			</span>
			<span class="block truncate text-xs text-muted-foreground" title={first.title}
				>{first.title}</span
			>
		</span>
		<span
			class="flex shrink-0 items-center gap-0.5 text-sm font-medium {waiting
				? 'text-sea'
				: 'text-muted-foreground'}"
			>{waiting ? 'Answer' : 'Open'}<ChevronRight
				class="size-4 transition-transform group-hover:translate-x-0.5"
				aria-hidden="true"
			/></span
		>
	</button>
{/if}
