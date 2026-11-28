<script lang="ts">
	import { LoaderCircle, Square } from '@lucide/svelte';
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { MateLinkView } from '$lib/matelink';
	import type { SecondMate } from '$lib/types';

	/**
	 * Stop, on a cloud second mate's card in Fleet → Second mates: stops its Fleetyard
	 * machine, and the second mate with it, after the captain says so. Its work stays on
	 * the machine, and Wake on the card starts it again.
	 */
	let { mate }: { mate: SecondMate } = $props();

	let asking = $state(false);
	let busy = $state(false);
	let said = $state<string | null>(null);
	let failed = $state<string | null>(null);

	const machine = $derived(mate.link?.status?.machine ?? mate.link?.machine ?? 'its machine');
	// Not while it is stopped or stopping: Wake is the card's then.
	const running = $derived(mate.link?.status?.online !== false);

	async function stop() {
		busy = true;
		failed = null;
		try {
			const r = await fetch(`/api/second-mates/${encodeURIComponent(mate.id)}/link`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: (page.data.sessionToken as string | undefined) ?? ''
				},
				body: JSON.stringify({ action: 'stop' })
			});
			if (!r.ok) {
				failed = `Wheelhouse answered ${r.status}.`;
				return;
			}
			const view = (await r.json()) as MateLinkView;
			said = view.status?.problem?.text ?? `${machine} is stopping.`;
			asking = false;
		} catch {
			failed = 'Could not reach the Wheelhouse server.';
		} finally {
			busy = false;
		}
	}
</script>

{#if said}
	<span class="text-sm text-muted-foreground" role="status" data-testid="mate-stopped">{said}</span>
{:else if asking}
	<span
		class="flex flex-wrap items-center gap-2 text-sm"
		role="group"
		aria-label="Stop {mate.id}"
		data-testid="mate-stop-confirm"
	>
		<span>Stop {machine}? {mate.id} stops with it until you wake it; its work stays there.</span>
		<button
			class="inline-flex h-8 items-center gap-1.5 rounded-md border border-danger/50 px-2.5 text-danger hover:bg-danger/10 disabled:opacity-60"
			onclick={stop}
			disabled={busy}
			data-testid="mate-stop-yes"
			>{#if busy}<LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />{/if}Stop it</button
		>
		<button
			class="inline-flex h-8 items-center rounded-md px-2.5 text-muted-foreground hover:bg-muted"
			onclick={() => (asking = false)}
			disabled={busy}>Keep running</button
		>
	</span>
{:else if running}
	<button
		class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm hover:bg-muted"
		onclick={() => (asking = true)}
		data-testid="mate-stop"><Square class="size-3.5" aria-hidden="true" />Stop</button
	>
{/if}
{#if failed}<span class="text-sm text-danger" role="alert">{failed}</span>{/if}
