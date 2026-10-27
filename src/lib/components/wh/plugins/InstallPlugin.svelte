<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import type { SuggestedPlugin } from '$lib/plugins/types';

	/**
	 * A first-party plugin this Firstmate home uses but that is not installed:
	 * why, and the exact command that installs it, to copy.
	 */
	let { plugin }: { plugin: SuggestedPlugin } = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(plugin.command);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable: the command stays selectable
		}
	}
</script>

<section
	class="rounded-lg border border-sea/40 bg-card px-4 py-4 text-sm"
	aria-label="Install the {plugin.id} plugin"
	data-suggested-plugin={plugin.id}
>
	<h2 class="text-base">Install the {plugin.id} plugin</h2>
	<p class="mt-1 max-w-prose text-muted-foreground">{plugin.reason}</p>
	<span class="mt-3 flex items-start gap-2 rounded-md border bg-muted/60 px-2.5 py-1.5 text-xs">
		<code class="min-w-0 flex-1 font-mono break-all text-foreground select-all"
			>{plugin.command}</code
		>
		<button
			class="flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
			onclick={copy}
			>{#if copied}<Check class="size-3.5" />Copied{:else}<Copy class="size-3.5" />Copy{/if}</button
		>
	</span>
	<p class="mt-2 text-xs text-muted-foreground">
		Run it in a terminal, then restart Wheelhouse; installed plugins load when it starts.
	</p>
</section>
