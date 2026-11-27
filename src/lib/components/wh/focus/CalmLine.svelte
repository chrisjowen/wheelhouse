<script lang="ts">
	/**
	 * Progress as one calm line, never a card: how much is under way, what
	 * landed today and the latest thing that moved (lib/calls.ts calmOf). It
	 * brightens once when something moves; selecting it opens a short log of
	 * what moved lately, fading with age, and how many calls cleared themselves
	 * before the captain saw them.
	 */
	import { ChevronRight } from '@lucide/svelte';
	import { slideout } from '$lib/client/slideout.svelte';
	import { calls } from '$lib/client/calls.svelte';
	import { clock } from '$lib/format';
	import type { Calm } from '$lib/calls';

	let { calm }: { calm: Calm } = $props();

	let open = $state(false);
	let flash = $state(false);
	let lastKey: string | null = null;
	$effect(() => {
		const key = calm.latest ? `${calm.latest.taskId}|${calm.latest.at}` : null;
		if (lastKey !== null && key !== lastKey) {
			flash = true;
			const t = setTimeout(() => (flash = false), 1600);
			lastKey = key;
			return () => clearTimeout(t);
		}
		lastKey = key;
	});
</script>

<div data-calm-line>
	<button
		type="button"
		class="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground max-md:min-h-11 {flash
			? 'bg-gold/10 text-foreground'
			: ''}"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<ChevronRight
			class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
		<span
			class="size-1.5 shrink-0 rounded-full {calm.underWay ? 'bg-sea' : 'bg-muted-foreground/50'}"
			aria-hidden="true"
		></span>
		<span class="min-w-0 truncate">
			<span class="font-medium text-foreground">{calm.underWay} under way</span
			>{` · ${calm.landedToday} landed today`}{calm.latest
				? ` · ${calm.latest.task}: ${calm.latest.text} · ${clock(calm.latest.at)}`
				: ''}
		</span>
	</button>
	{#if open}
		<ul class="mt-1 mb-2 grid gap-1 pl-8 text-sm" aria-label="What moved lately" data-calm-log>
			{#each calm.log as e, i (`${e.taskId}|${e.at}`)}
				<li class="flex min-w-0 gap-2.5" style:opacity={0.45 + (0.55 * (i + 1)) / calm.log.length}>
					<span class="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{clock(e.at)}</span
					>
					<button
						type="button"
						class="min-w-0 cursor-pointer truncate text-left hover:underline"
						onclick={() => slideout.openTask(e.taskId)}
						><span class="font-medium">{e.task}</span>
						<span class="text-muted-foreground">· {e.text}</span></button
					>
				</li>
			{:else}
				<li class="text-muted-foreground">Nothing has moved lately.</li>
			{/each}
			{#if calls.clearedUnseen}
				<li class="text-xs text-muted-foreground">
					{calls.clearedUnseen}
					{calls.clearedUnseen === 1
						? 'call cleared itself before you saw it.'
						: 'calls cleared themselves before you saw them.'}
				</li>
			{/if}
		</ul>
	{/if}
</div>
