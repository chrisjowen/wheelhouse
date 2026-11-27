<script lang="ts">
	import { Info } from '@lucide/svelte';

	/** What the dev portal is, said once at the top of its pages. */
	let { what = 'it' }: { what?: string } = $props();
</script>

<p
	class="flex max-w-prose items-start gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed"
	data-testid="portal-about"
>
	<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	<span>
		This is your team’s <b>dev portal</b>: what every ship’s crew has learned about the team’s
		services and APIs as it worked, each fact with the evidence behind it. Here you see the basics
		and how {what} touches you. Everything else is on its full page on Fleetyard.
	</span>
</p>
