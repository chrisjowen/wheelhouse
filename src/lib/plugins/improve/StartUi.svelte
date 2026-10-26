<script lang="ts">
	import { ArrowUpRight, Check, Copy } from '@lucide/svelte';
	import type { ImproveUi } from './types';

	/** Where improve's own review UI is: a link while it runs, else how to start it on 127.0.0.1. */
	let { ui }: { ui: ImproveUi } = $props();
	let copied = $state(false);

	async function copy() {
		if (!ui.start) return;
		try {
			await navigator.clipboard.writeText(ui.start);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable: the command stays selectable
		}
	}
</script>

{#if ui.running}
	<p class="text-sm text-muted-foreground">
		improve’s review UI is running.
		<a
			href={ui.url}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-0.5 text-sea hover:underline"
			>Open improve<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
		>{#if !ui.deepLinks}
			<span>This version opens on its own front page, not on a proposal.</span>{/if}
	</p>
{:else}
	<div class="text-sm text-muted-foreground">
		<p>
			improve’s review UI is not running at <span class="font-mono text-xs">{ui.url}</span>, so
			proposals open here only.{#if ui.start}
				To open them in improve, start it on this computer:{/if}
		</p>
		{#if ui.start}
			<div class="mt-2 flex items-start gap-2 rounded-md border bg-muted/60 px-3 py-2">
				<code class="min-w-0 flex-1 font-mono text-xs break-all text-foreground select-all"
					>{ui.start}</code
				>
				<button
					class="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-background hover:text-foreground"
					onclick={copy}
					>{#if copied}<Check class="size-3.5" />Copied{:else}<Copy
							class="size-3.5"
						/>Copy{/if}</button
				>
			</div>
		{/if}
	</div>
{/if}
