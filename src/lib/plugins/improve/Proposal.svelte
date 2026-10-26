<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import ProposalCard from './ProposalCard.svelte';
	import StartUi from './StartUi.svelte';
	import type { ProposalSection } from './types';

	/** On an improve proposal's Firstmate task: the proposal itself, and the way back to the rest. */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as ProposalSection);
</script>

<p class="mb-3 text-sm text-muted-foreground">
	improve filed this proposal for your call. Approve, reject or defer it by answering Firstmate
	here.
</p>
<ProposalCard p={v.proposal} showDecisionLink={false} />
{#if !v.ui.running}
	<div class="mt-3"><StartUi ui={v.ui} /></div>
{/if}
<a
	href={v.improvementsHref}
	class="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
	>See every improvement<ArrowRight class="size-3.5" /></a
>
