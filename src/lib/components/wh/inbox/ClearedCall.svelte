<script lang="ts">
	/**
	 * A call the captain saw that cleared itself (Firstmate settled it, or the
	 * work moved on) before they answered: it stays where it was, saying so,
	 * until they put it away, so nothing they were reading vanishes.
	 */
	import { CircleCheck } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import { KIND_LABEL } from '$lib/decisionhome';
	import { calls } from '$lib/client/calls.svelte';
	import type { ClearedCall } from '$lib/calls';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';

	let { cleared, project = null }: { cleared: ClearedCall; project?: string | null } = $props();
	const card = $derived(cleared.card);
</script>

<article
	class="w-full max-w-[min(100%,40rem)] rounded-lg border border-l-[3px] border-l-success/70 bg-card px-4 pt-3.5 pb-3 sm:px-5"
	data-cleared-call={card.id}
>
	<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
		{#if project}
			<span
				class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>{project}</span
			>
		{/if}
		<span class="rounded bg-muted px-1.5 text-xs leading-[1.15rem] font-medium text-foreground/80"
			>{KIND_LABEL[card.kind]}</span
		>
	</header>
	<h3 class="mt-2 font-sans text-base leading-snug font-medium sm:text-[1.05rem]">
		<LinkedText text={card.title} />
	</h3>
	<p class="mt-0.5 text-xs text-muted-foreground">{card.taskTitle}</p>
	<div
		class="mt-3 flex items-start gap-2.5 rounded-lg border border-success/40 bg-success/[0.07] px-3.5 py-2.5 text-sm"
		role="status"
	>
		<CircleCheck class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
		<div class="min-w-0">
			<p>
				<span class="font-semibold">This cleared itself at {clock(cleared.at)}.</span>
				<span class="text-muted-foreground">Nothing to do.</span>
			</p>
			<button
				type="button"
				class="mt-2 inline-flex min-h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent max-md:min-h-11"
				onclick={() => calls.putAway(card.id)}
				data-put-away>Put it away</button
			>
		</div>
	</div>
</article>
