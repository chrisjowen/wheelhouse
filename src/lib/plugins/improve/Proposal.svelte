<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import ProposalCard from './ProposalCard.svelte';
	import StartUi from './StartUi.svelte';
	import type { ProposalSection } from './types';

	/**
	 * On the task improve filed a proposal as: the proposal's card, opened, since
	 * this is where the captain decides; answering goes through Firstmate as for
	 * any other call.
	 */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as ProposalSection);
	let open = $state(true);
</script>

<div class="max-w-3xl">
	<ProposalCard p={v.proposal} showDecisionLink={false} bind:open />
	{#if !v.ui.running}
		<div class="mt-3"><StartUi ui={v.ui} /></div>
	{/if}
	<a
		href={v.improvementsHref}
		class="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
		>Every improvement<ArrowRight class="size-3.5" aria-hidden="true" /></a
	>
</div>
