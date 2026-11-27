<script lang="ts">
	/**
	 * Live mode's decisions: every call waiting on the captain, oldest first,
	 * one line each (a gold dot and New for one not seen yet). Picking one
	 * opens its card right there, the same card On deck draws (ChatDecision),
	 * answered in place, and raises it in the discussion (`ondiscuss`, once a
	 * call); picking it again folds it.
	 */
	import { ChevronRight } from '@lucide/svelte';
	import { calls } from '$lib/client/calls.svelte';
	import { openDecision } from '$lib/chat/decisions';
	import { shortAge } from '$lib/ondeck';
	import type { InboxCard } from '$lib/inbox';
	import ChatDecision from '$lib/components/firstmate/ChatDecision.svelte';

	let {
		cards,
		now,
		projectName,
		ondiscuss,
		onLeave,
		heading = true
	}: {
		/** The calls waiting on the captain, oldest first. */
		cards: InboxCard[];
		now: number;
		projectName: (id: string | null) => string | null;
		ondiscuss: (card: InboxCard) => void;
		/** A link out of a card is followed. */
		onLeave: () => void;
		/** Its own heading; a phone's sheet carries the title instead. */
		heading?: boolean;
	} = $props();

	let open = $state<string | null>(null);
	// Raised once each: picking it again only shows it.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const raised = new Set<string>();
	function pick(c: InboxCard) {
		if (open === c.id) {
			open = null;
			return;
		}
		open = c.id;
		if (!raised.has(c.id)) {
			raised.add(c.id);
			ondiscuss(c);
		}
	}
</script>

<section class="flex min-h-0 flex-col" aria-label="Decisions" data-live-decisions>
	<h2
		class:sr-only={!heading}
		class="flex items-baseline gap-2 px-1 pb-2 text-[0.95rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
	>
		Decisions
		<span class="font-normal tabular-nums">{cards.length ? `${cards.length} waiting` : ''}</span>
	</h2>
	{#if cards.length}
		<ul class="grid gap-2">
			{#each cards as c (c.id)}
				{@const fresh = !calls.isSeen(c)}
				{@const project = projectName(c.projectId)}
				<li data-live-decision={c.id}>
					<button
						type="button"
						class="flex w-full cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left text-sm shadow-xs transition-colors hover:border-gold/50 dark:bg-card/60 dark:shadow-none {open ===
						c.id
							? 'border-gold/60'
							: ''}"
						aria-expanded={open === c.id}
						title="Open it and talk it through in Live mode"
						onclick={() => pick(c)}
						data-live-decision-row
					>
						<span
							class="mt-1.5 size-2 shrink-0 rounded-full {fresh ? 'bg-gold' : 'bg-sea'}"
							aria-hidden="true"
						></span>
						<span class="min-w-0 flex-1">
							<span class="block font-medium text-foreground">{c.title || c.question}</span>
							<span class="mt-0.5 flex gap-1.5 text-xs text-muted-foreground">
								<span class="min-w-0 truncate">{c.taskTitle}{project ? ` · ${project}` : ''}</span>
								{#if fresh}<span
										class="shrink-0 text-[0.68rem] font-semibold tracking-wide text-gold uppercase"
										>New</span
									>{/if}
								{#if c.askedAt}<span class="ml-auto shrink-0 tabular-nums"
										>{shortAge(c.askedAt, now)}</span
									>{/if}
							</span>
						</span>
						<ChevronRight
							class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform {open ===
							c.id
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
					</button>
					{#if open === c.id}
						<div class="mt-2 [&>div]:max-w-none" data-live-decision-card>
							<ChatDecision
								decision={openDecision(c)}
								{project}
								{now}
								variant="live"
								{onLeave}
								onRetry={() => {}}
								onDismiss={() => {}}
							/>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-1 text-sm text-muted-foreground" data-live-decisions-none>
			Nothing is waiting on you.
		</p>
	{/if}
</section>
