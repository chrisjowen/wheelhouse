<script lang="ts">
	import { AppWindow, LoaderCircle, SquareTerminal, X } from '@lucide/svelte';
	import { act } from '$lib/client/chat.svelte';
	import type { ScreenMenu } from '$lib/types';

	/**
	 * A Claude Code menu open in the Firstmate session that the chat cannot
	 * drive, such as the ones /mcp, /model or /config open. Nothing is typed into
	 * the session while it is open, so the card offers the ways on: close it
	 * (Escape, which the server presses only while the menu is on screen) or use
	 * it in the terminal. The card goes once the menu has closed, however it was.
	 */
	let { menu, token, onterminal }: { menu: ScreenMenu; token: string; onterminal: () => void } =
		$props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function close() {
		busy = true;
		error = null;
		const r = await act('/api/firstmate/dismiss', token);
		busy = false;
		if (!r.ok) error = r.error;
	}
</script>

<div
	class="max-w-[80ch] rounded-lg border border-t-2 border-t-sea bg-card p-4"
	role="group"
	aria-label="A Claude Code menu is open"
>
	<p class="mb-2 flex items-center gap-2 font-display text-[1.15rem] font-medium">
		<AppWindow class="size-4 text-sea" aria-hidden="true" />A Claude Code menu is open
	</p>
	<p class="mb-3 text-sm text-muted-foreground">
		{#if menu.title}<span class="font-medium text-foreground">{menu.title}</span>{:else}A menu{/if}
		is open in Firstmate’s session, and the chat can’t use it. Close it to carry on chatting, or use it
		in Firstmate’s terminal.
	</p>
	<div class="flex flex-wrap items-center gap-3 text-sm">
		<button
			class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
			disabled={busy}
			onclick={close}
		>
			{#if busy}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />{:else}<X
					class="size-4"
					aria-hidden="true"
				/>{/if}Close menu
		</button>
		<button
			class="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground"
			onclick={onterminal}
			><SquareTerminal class="size-4" aria-hidden="true" />Use it in the terminal</button
		>
		{#if error}<p class="w-full text-danger" role="alert">{error}</p>{/if}
	</div>
</div>
