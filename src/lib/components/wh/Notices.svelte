<script lang="ts">
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
</script>

<!-- Honest strips: what Wheelhouse cannot currently see, said plainly. -->
<div aria-live="polite">
	{#if live.connection === 'lost'}
		<div class="border-b bg-danger/10">
			<p class="px-4 py-2.5 text-sm sm:px-6 lg:px-10">
				<span class="font-medium">Lost connection to the Wheelhouse server.</span>
				<span class="text-muted-foreground"
					>What you see stopped updating. This page keeps trying and picks up again as soon as the
					server answers; after a crash, Wheelhouse restarts its server on its own.</span
				>
			</p>
		</div>
	{/if}
	{#if health && !health.configured}
		<div class="border-b bg-danger/10">
			<p class="px-4 py-2.5 text-sm sm:px-6 lg:px-10">
				<span class="font-medium">Not connected to Firstmate.</span>
				<span class="text-muted-foreground">{health.firstmate.problems[0]}</span>
			</p>
		</div>
	{:else if health && !health.firstmate.compatible}
		<div class="border-b bg-warning/10">
			<div class="px-4 py-2.5 text-sm sm:px-6 lg:px-10">
				<p>
					<span class="font-medium">This Firstmate may not be compatible with Wheelhouse.</span>
					<span class="text-muted-foreground">Some information may be missing or wrong.</span>
				</p>
				<ul class="mt-1 list-disc pl-5 text-muted-foreground">
					{#each health.firstmate.problems as p (p)}<li>{p}</li>{/each}
				</ul>
			</div>
		</div>
	{/if}
	{#if health?.configured && sup && sup.onWatch !== true}
		<div class="border-b bg-muted/60">
			<p class="px-4 py-2.5 text-sm sm:px-6 lg:px-10">
				<span class="font-medium"
					>Firstmate is {sup.onWatch === false ? 'off watch' : 'not confirmed on watch'}.</span
				>
				<span class="text-muted-foreground"
					>{sup.reason ?? ''} Task states below are still read directly from Firstmate’s records.</span
				>
			</p>
		</div>
	{/if}
	{#if health?.configured && fleet?.stale}
		<div class="border-b bg-warning/10">
			<p class="px-4 py-2.5 text-sm sm:px-6 lg:px-10">
				<span class="font-medium text-warning">This may be out of date.</span>
				<span class="text-muted-foreground"
					>{fleet.staleReason}{#if fleet.collectedAt}<span class="ml-1"
							>Last good read {ago(fleet.collectedAt, live.now)}.</span
						>{/if}</span
				>
			</p>
		</div>
	{/if}
</div>
