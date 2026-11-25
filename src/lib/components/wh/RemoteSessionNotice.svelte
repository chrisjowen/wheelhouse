<script lang="ts">
	import { remoteSession } from '$lib/client/remote-session.svelte';
	import { Button } from '$lib/components/ui/button';

	/**
	 * Under the header, for a page that came through Wheelhouse Cloud: its
	 * machine is offline (it reconnects by itself), or its remote session ended,
	 * with the way to sign in again and come straight back to this page.
	 */
</script>

<div aria-live="polite">
	{#if remoteSession.state === 'offline'}
		<div
			class="flex min-h-9 items-center gap-2.5 border-b bg-warning/10 px-4 py-1.5 text-sm sm:px-6 lg:px-10"
			data-remote-session="offline"
		>
			<span class="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
			<span class="min-w-0 flex-1 font-medium">Your machine is offline, reconnecting…</span>
		</div>
	{:else if remoteSession.state === 'ended'}
		<div
			class="flex min-h-9 items-center gap-2.5 border-b bg-danger/10 px-4 py-1.5 text-sm sm:px-6 lg:px-10"
			data-remote-session="ended"
		>
			<span class="size-2 shrink-0 rounded-full bg-danger" aria-hidden="true"></span>
			<span class="min-w-0 flex-1"
				><span class="font-medium">Your remote session ended.</span>
				<span class="text-muted-foreground max-sm:hidden"
					>Sign in again with your passkey to carry on from this page.</span
				></span
			>
			<Button size="sm" onclick={() => remoteSession.signIn()}>Sign in again</Button>
		</div>
	{/if}
</div>
