<script lang="ts">
	import { Wrench } from '@lucide/svelte';
	import type { HarnessView } from './types';

	/** A small header pill, only while a harness review is due or proposals wait. */
	let { data }: { data: unknown } = $props();
	const v = $derived(data as HarnessView);
	const label = $derived(
		[v.review.due ? 'Review due' : null, v.waiting ? `${v.waiting} to decide` : null]
			.filter(Boolean)
			.join(' · ')
	);
</script>

{#if label}
	<a
		href="/plugins/improve/improvements"
		class="hidden items-center gap-1.5 rounded-full border border-sea/40 bg-sea/10 px-3 py-1 text-xs font-medium whitespace-nowrap text-sea hover:bg-sea/15 xl:flex"
		title={[
			v.review.due ? v.review.headline : null,
			v.waiting ? `${v.waiting} harness improvements wait for your call.` : null
		]
			.filter(Boolean)
			.join(' ')}
		aria-label="Harness: {label}"
	>
		<Wrench class="size-3.5" aria-hidden="true" />{label}
	</a>
{/if}
