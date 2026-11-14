<script lang="ts">
	import { SquareTerminal } from '@lucide/svelte';

	/**
	 * The Firstmate session is waiting on the captain in its terminal for
	 * something the chat cannot show as a card: a screen Wheelhouse cannot read
	 * (an error to retry, a dialog it does not know) or another harness's
	 * dialog. Never silent: the notice stays until the session is back at its
	 * prompt (or shows something the chat can answer), and opens the terminal.
	 */
	let {
		detail,
		onterminal,
		tool = 'Claude Code'
	}: { detail: string | null; onterminal: () => void; tool?: string } = $props();
</script>

<div
	class="max-w-[80ch] rounded-lg border border-t-2 border-t-warning bg-card p-4"
	role="alert"
	aria-label="Firstmate is waiting for you in the terminal"
	data-terminal-notice
>
	<p class="mb-2 flex items-center gap-2 font-display text-[1.15rem] font-medium">
		<SquareTerminal class="size-4 text-warning" aria-hidden="true" />Firstmate is waiting for you in
		the terminal
	</p>
	<p class="mb-3 text-sm text-muted-foreground">
		{tool} is showing something the chat can’t answer. Open the terminal to carry on; the chat picks up
		again once it’s done.
	</p>
	{#if detail}<pre
			class="mb-3 overflow-x-auto rounded border bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{detail}</pre>{/if}
	<button
		class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
		onclick={onterminal}><SquareTerminal class="size-4" aria-hidden="true" />Open terminal</button
	>
</div>
