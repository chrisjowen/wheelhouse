<script lang="ts">
	import { ArrowUpRight, Globe } from '@lucide/svelte';

	/**
	 * In place of the remote-access controls on a page that came through the gateway:
	 * they are managed only on this machine (REMOTES_LOCAL_ONLY), so the page says this
	 * session is already remote and links to the gateway it came through.
	 */
	let { gateway }: { gateway: string } = $props();
	const host = $derived(URL.parse(gateway)?.host ?? gateway);
</script>

<div
	class="mt-6 flex max-w-prose items-start gap-3 rounded-lg border bg-card px-4 py-4"
	data-already-remote
>
	<Globe class="mt-0.5 size-5 shrink-0 text-sea" aria-hidden="true" />
	<div class="min-w-0">
		<p class="font-medium">You are already connected remotely</p>
		<p class="mt-1 text-sm text-muted-foreground">
			This page came through the Gateway at {host}. Remote access is started, stopped and paired
			only on the machine Wheelhouse runs on.
		</p>
		<a
			href={gateway}
			class="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-sea underline-offset-2 hover:underline"
			>Go to the Gateway<ArrowUpRight class="size-4" aria-hidden="true" /></a
		>
	</div>
</div>
