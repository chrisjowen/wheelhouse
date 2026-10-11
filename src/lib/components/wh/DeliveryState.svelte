<script lang="ts">
	import type { LocalMessage } from '$lib/bridge';
	import {
		Check,
		CheckCheck,
		CircleAlert,
		CircleDashed,
		CircleHelp,
		Clock,
		LoaderCircle
	} from '@lucide/svelte';

	let { message: m, onRetry }: { message: LocalMessage; onRetry: () => void } = $props();
	// Acknowledgement only means something once Firstmate has the note.
	const held = $derived(m.delivery === 'delivered' || m.delivery === 'saved-unannounced');
</script>

<!-- Delivery (does Firstmate have it) and acknowledgement (did it read it), shown separately. -->
{#if m.delivery === 'sending'}
	<span class="inline-flex items-center gap-1"
		><LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />Sending</span
	>
{:else if m.delivery === 'delivered'}
	<span class="inline-flex items-center gap-1"
		><Check class="size-3.5" aria-hidden="true" />Delivered</span
	>
{:else if m.delivery === 'saved-unannounced'}
	<span class="inline-flex items-center gap-1 text-warning" title={m.deliveryDetail ?? undefined}
		><Clock class="size-3.5" aria-hidden="true" />Saved, Firstmate not woken yet</span
	>
{:else if m.delivery === 'uncertain'}
	<span class="inline-flex items-center gap-1 text-danger" title={m.deliveryDetail ?? undefined}
		><CircleHelp class="size-3.5" aria-hidden="true" />Delivery uncertain</span
	>
{:else}
	<span class="inline-flex items-center gap-1 text-danger" title={m.deliveryDetail ?? undefined}
		><CircleAlert class="size-3.5" aria-hidden="true" />Not delivered</span
	>
	<button class="font-medium text-foreground underline-offset-2 hover:underline" onclick={onRetry}
		>Retry</button
	>
{/if}
{#if held && m.acknowledged === true}
	<span class="inline-flex items-center gap-1 text-success"
		><CheckCheck class="size-3.5" aria-hidden="true" />Acknowledged{m.reply
			? ''
			: ', no reply'}</span
	>
{:else if held && m.acknowledged === false}
	<span class="inline-flex items-center gap-1"
		><CircleDashed class="size-3.5" aria-hidden="true" />Not acknowledged</span
	>
{/if}
