<script lang="ts">
	/**
	 * What talking a decision through came to, as a card in the Live
	 * discussion: each call settled, named as the decision names it, and the
	 * way to the decision, whose form it has filled in. Nothing is sent from
	 * here; the captain sends it from the decision.
	 */
	import { ArrowRight, Check } from '@lucide/svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { callName } from '$lib/inbox';
	import type { Visual } from '$lib/live/reply';

	let { visual }: { visual: Extract<Visual, { kind: 'decision' }> } = $props();

	const card = $derived(inbox.cards().find((c) => c.id === visual.decision) ?? null);
	// A call's name before what was settled: "D2) What bar…? (a)", "2) First channel: Discord".
	const named = (name: string, what: string) => `${name}${/[?:]$/.test(name) ? ' ' : ': '}${what}`;
	const calls = $derived(card?.choices?.calls ?? []);
	const lines = $derived([
		...Object.entries(visual.picks).map(([id, pick]) => {
			const call = calls.find((c) => c.id === id);
			const o = call?.options.find((x) => x.id === pick);
			const name = call ? callName(call) || id : id;
			return named(name, o ? `${o.label}${o.detail ? ` · ${o.detail}` : ''}` : pick);
		}),
		...Object.entries(visual.words).map(([id, words]) => {
			const call = calls.find((c) => c.id === id);
			return named(call ? callName(call) || id : id, `“${words}”`);
		}),
		...(visual.answer ? [visual.answer] : [])
	]);
</script>

<div
	class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border border-sea/45 bg-card text-sm"
	data-live-decision={visual.decision}
>
	<header
		class="flex items-center gap-2 px-4 pt-2.5 pb-1 text-xs font-medium tracking-wider text-sea uppercase"
	>
		<Check class="size-3.5" aria-hidden="true" />The talk came to
	</header>
	<p class="px-4 text-xs text-muted-foreground">{card?.title ?? visual.decision}</p>
	<ul class="space-y-1 px-4 pt-1.5 pb-2.5 leading-snug">
		{#each lines as l, i (i)}<li>{l}</li>{/each}
	</ul>
	<footer
		class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair bg-muted/30 px-4 py-2"
	>
		<span class="flex-1 text-xs text-muted-foreground"
			>It is in the decision’s form. Nothing is sent until you send it there.</span
		>
		<a
			href="/inbox?d={encodeURIComponent(visual.decision)}"
			class="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-sea hover:bg-accent max-md:min-h-11"
			data-live-decision-open>Open the decision<ArrowRight class="size-3.5" aria-hidden="true" /></a
		>
	</footer>
</div>
