<script lang="ts">
	/**
	 * Live mode's updates, as one calm line at the foot of the screen, never a
	 * card: how much is under way, what landed today and the latest update
	 * (Firstmate's own reports and what moved on the fleet, lib/live/updates.ts).
	 * It brightens once when a new one comes in; selecting it opens the last
	 * few, fading with age, and selecting one of those raises it in the
	 * discussion (`ondiscuss`).
	 */
	import { ChevronRight, MessageCircle } from '@lucide/svelte';
	import { clock } from '$lib/format';
	import type { Calm } from '$lib/calls';
	import type { LiveUpdate } from '$lib/live/updates';

	let {
		calm,
		updates,
		ondiscuss
	}: {
		calm: Pick<Calm, 'underWay' | 'landedToday'>;
		/** Oldest first. */
		updates: LiveUpdate[];
		ondiscuss: (u: LiveUpdate) => void;
	} = $props();

	const latest = $derived(updates[updates.length - 1] ?? null);
	const newestFirst = $derived([...updates].reverse());
	let open = $state(false);
	let flash = $state(false);
	let lastKey: string | null = null;
	$effect(() => {
		const key = latest ? `${latest.id}|${latest.at}` : null;
		if (lastKey !== null && key !== lastKey) {
			flash = true;
			const t = setTimeout(() => (flash = false), 1600);
			lastKey = key;
			return () => clearTimeout(t);
		}
		lastKey = key;
	});
</script>

<div data-live-updates>
	{#if open}
		<ul class="mb-1 grid gap-0.5 pl-1 text-sm" aria-label="Updates" data-live-update-log>
			{#each newestFirst as u, i (u.id)}
				<li style:opacity={1 - (0.5 * i) / Math.max(newestFirst.length, 1)}>
					<button
						type="button"
						class="group flex min-h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-muted/60 max-md:min-h-11"
						title="Talk about this in Live mode"
						onclick={() => {
							open = false;
							ondiscuss(u);
						}}
						data-live-update={u.from}
						><span class="w-11 shrink-0 text-xs text-muted-foreground tabular-nums"
							>{clock(u.at)}</span
						><span class="min-w-0 flex-1 truncate"
							><span class="font-medium {u.from === 'firstmate' ? 'text-gold' : ''}">{u.title}</span
							>
							<span class="text-muted-foreground">· {u.text}</span></span
						><span
							class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100"
							><MessageCircle class="size-3.5" aria-hidden="true" /><span class="max-sm:sr-only"
								>Discuss</span
							></span
						></button
					>
				</li>
			{:else}
				<li class="px-1.5 py-1 text-muted-foreground">Nothing has come in yet.</li>
			{/each}
		</ul>
	{/if}
	<button
		type="button"
		class="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground max-md:min-h-11 {flash
			? 'bg-gold/10 text-foreground'
			: ''}"
		aria-expanded={open}
		aria-label="Updates from Firstmate and the fleet"
		onclick={() => (open = !open)}
		data-live-updates-line
	>
		<ChevronRight
			class="size-3.5 shrink-0 transition-transform {open ? '-rotate-90' : ''}"
			aria-hidden="true"
		/>
		<span
			class="size-1.5 shrink-0 rounded-full {calm.underWay ? 'bg-sea' : 'bg-muted-foreground/50'}"
			aria-hidden="true"
		></span>
		<span class="min-w-0 truncate">
			<span class="font-medium text-foreground">{calm.underWay} under way</span
			>{` · ${calm.landedToday} landed today`}{latest
				? ` · ${latest.title}: ${latest.text} · ${clock(latest.at)}`
				: ''}
		</span>
		{#if updates.length}<span class="ml-auto shrink-0 text-xs tabular-nums"
				>{updates.length} update{updates.length === 1 ? '' : 's'}</span
			>{/if}
	</button>
</div>
