<script lang="ts">
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { switchedOff, type FleetView } from '$lib/fleet';
	import AddSecondMateWizard from '$lib/components/wh/mates/AddSecondMateWizard.svelte';
	import SecondMateCard from '$lib/components/wh/mates/SecondMateCard.svelte';
	import StopMate from '$lib/components/wh/fleet/StopMate.svelte';
	import SwitchedOff from '$lib/components/wh/fleet/SwitchedOff.svelte';

	/**
	 * Fleet → Second mates: second mates on demand. The ones on cloud machines of their own,
	 * each with Stop, and Launch, the Add second mate wizard (behind its own experimental
	 * flag). When the fleet switched cloud second mates off it says why instead of Launch;
	 * any still running stay below, so they can be stopped. Every second mate, here or on
	 * the captain's own hosts, stays on the Second mates page and in the menu.
	 */
	let { data } = $props();
	const membership = $derived(data.membership as FleetView | null);
	const off = $derived(switchedOff(membership, 'cloud_second_mates'));

	const snapshot = $derived(currentFleet());
	const all = $derived(snapshot?.secondMates ?? []);
	const cloud = $derived(all.filter((m) => m.link));
	const others = $derived(all.length - cloud.length);

	const plan = $derived.by(() => {
		const f = membership?.state === 'joined' ? membership.fleet : null;
		if (!f) return null;
		return f.kind === 'company' ? `${f.name} · ${f.plan} plan` : `Your own fleet · ${f.plan} plan`;
	});
</script>

<svelte:head><title>Second mates · Fleet · Wheelhouse</title></svelte:head>

<p class="mono-label mt-6">Fleet · Second mates</p>
<h1 class="mt-2 text-2xl">Second mates on <em class="text-gold">demand</em></h1>
<p class="mt-2 max-w-prose text-sm text-muted-foreground">
	A Firstmate on a cloud machine of its own. It runs its own crew, keeps working while this computer
	sleeps, and joins the second mates in the menu; its questions come to Decisions.
</p>
{#if off}
	<SwitchedOff feature={off} fleet={membership?.fleet?.name ?? null} />
{/if}

{#if !off || cloud.length}
	<section class="mt-8" aria-labelledby="fleet-mates-cloud" data-testid="fleet-mates-cloud">
		<h2 id="fleet-mates-cloud" class="section-label">
			In the cloud <span class="tabular">{cloud.length}</span>
		</h2>
		{#if snapshot?.stale && snapshot.staleReason}
			<p class="mt-2 text-sm text-warning">{snapshot.staleReason}</p>
		{/if}
		{#if cloud.length}
			<div class="mt-4 flex flex-col gap-6">
				{#each cloud as m (m.id)}
					<SecondMateCard mate={m} now={live.now}>
						{#snippet actions()}<StopMate mate={m} />{/snippet}
					</SecondMateCard>
				{/each}
			</div>
		{:else if snapshot?.collectedAt}
			<p class="mt-3 text-sm text-muted-foreground" data-testid="fleet-mates-none">
				None yet. Launch one below to work while this computer sleeps.
			</p>
		{:else}
			<p class="mt-3 text-sm text-muted-foreground" aria-busy="true">Reading Firstmate…</p>
		{/if}
	</section>
{/if}

{#if others}
	<p class="mt-4 text-sm text-muted-foreground" data-testid="fleet-mates-others">
		{others}
		{others === 1 ? 'more runs' : 'more run'} on this computer or your own hosts:
		<a class="underline" href="/second-mates">every second mate</a>.
	</p>
{/if}

{#if !off}
	<section id="launch" class="mt-10 scroll-mt-24" aria-labelledby="fleet-mates-launch">
		<div class="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<h2 id="fleet-mates-launch" class="text-xl">Launch a second mate</h2>
			{#if plan}<span class="text-xs text-muted-foreground" data-testid="fleet-mates-plan"
					>{plan}</span
				>{/if}
		</div>
		{#if data.hostedSecondMates}
			<AddSecondMateWizard embedded />
		{:else}
			<p
				class="max-w-prose rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"
				data-testid="fleet-mates-launch-off"
			>
				Launching one here needs Hosted second mates on, in
				<a class="underline" href="/settings/experimental">Settings → Experimental features</a>.
			</p>
		{/if}
	</section>
{/if}
