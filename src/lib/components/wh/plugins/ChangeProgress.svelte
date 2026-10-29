<script lang="ts">
	import { Check, LoaderCircle } from '@lucide/svelte';

	/**
	 * A plugin change under way: keeping it, then Wheelhouse restarting to load
	 * it, until the restarted server answers (or takes longer than it should).
	 */
	let { label, phase }: { label: string; phase: 'saving' | 'restarting' | 'done' | 'slow' } =
		$props();
</script>

<div aria-live="polite">
	<ol class="grid gap-1.5">
		<li class="flex items-center gap-2">
			{#if phase === 'saving'}<LoaderCircle class="size-4 animate-spin text-sea" />{:else}<Check
					class="size-4 text-success"
				/>{/if}{label}
		</li>
		<li class="flex items-center gap-2 {phase === 'saving' ? 'text-muted-foreground' : ''}">
			{#if phase === 'restarting' || phase === 'slow'}<LoaderCircle
					class="size-4 animate-spin text-sea"
				/>{:else if phase === 'done'}<Check class="size-4 text-success" />{:else}<span
					class="size-4 text-center"
					aria-hidden="true">·</span
				>{/if}Restart Wheelhouse to load it
		</li>
	</ol>
	{#if phase === 'slow'}
		<p class="mt-3 text-xs text-muted-foreground">
			Wheelhouse has not come back yet. If it stays away, run <code>wheelhouse open</code> again; the
			change is kept.
		</p>
	{/if}
</div>
