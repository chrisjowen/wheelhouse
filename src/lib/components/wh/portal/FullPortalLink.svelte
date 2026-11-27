<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';

	/** The way to the full page on Fleetyard, where every fact keeps its receipt. */
	let {
		href,
		title = 'Full page in the dev portal on Fleetyard',
		detail
	}: { href: string; title?: string; detail: string } = $props();
</script>

<a
	{href}
	target="_blank"
	rel="noreferrer"
	class="flex items-center gap-3 rounded-lg border border-sea/40 bg-card px-4 py-3 transition-colors hover:border-sea"
	data-testid="portal-full-page"
>
	<span class="min-w-0 flex-1">
		<span class="block font-medium">{title}</span>
		<span class="mt-0.5 block text-sm text-muted-foreground">{detail}</span>
	</span>
	<ExternalLink class="size-4 shrink-0 text-sea" aria-hidden="true" />
</a>
