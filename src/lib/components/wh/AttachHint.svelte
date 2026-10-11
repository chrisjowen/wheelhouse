<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	/** The command to attach one's own terminal to a session, with a copy button. */
	let { command }: { command: string } = $props();

	let copied = $state(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable; the command is selectable
		}
	}
</script>

<p class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
	<span class="shrink-0">In your own terminal:</span>
	<code class="min-w-0 truncate font-mono text-foreground select-all" title={command}
		>{command}</code
	>
	<button
		type="button"
		class="shrink-0 rounded-sm p-0.5 hover:text-foreground"
		aria-label={copied ? 'Copied' : 'Copy the attach command'}
		title={copied ? 'Copied' : 'Copy'}
		onclick={copy}
		>{#if copied}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}</button
	>
</p>
