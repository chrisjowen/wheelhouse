<script lang="ts">
	import { AppWindow, ChevronRight } from '@lucide/svelte';
	import type { ChatApp } from '$lib/apps/types';
	import AppFrame from '$lib/components/wh/plugins/AppFrame.svelte';

	/**
	 * The MCP app that came with one of Firstmate's tool calls, under its
	 * message: a calm card, closed until the captain opens it. Open, it draws
	 * the app with the call's arguments and result, from its server's sandbox,
	 * as a plugin slot does; closing it takes the app down.
	 */
	let { id, app }: { id: string; app: ChatApp } = $props();

	let open = $state(false);
</script>

<div class="max-w-[80ch] rounded-xl border bg-card" data-chat-app={id}>
	<button
		class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<AppWindow class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<span class="shrink-0 font-medium">{app.title}</span>
		<span class="min-w-0 truncate text-muted-foreground">· an app from {app.server.title}</span>
		<span class="ml-auto shrink-0 text-xs text-muted-foreground">{open ? 'Close' : 'Open'}</span>
		<ChevronRight
			class="size-3.5 shrink-0 text-muted-foreground transition-transform {open ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
	</button>
	{#if open}
		<div class="border-t px-4 pt-3 pb-3">
			<AppFrame ref={{ chat: id }} title={app.title} plugin={app.plugin} />
		</div>
	{/if}
</div>
