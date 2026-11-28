<script lang="ts">
	import { Anchor, Cloud, Lock, RadioTower, UsersRound } from '@lucide/svelte';
	import { page } from '$app/state';
	import { fleetAction, readFleet } from '$lib/client/fleet';
	import type { CloudView } from '$lib/cloud';
	import { poll } from '$lib/console';
	import { switchedOff, type FleetView } from '$lib/fleet';
	import { Button } from '$lib/components/ui/button';
	import AlreadyRemote from '$lib/components/wh/remotes/AlreadyRemote.svelte';
	import FleetFacts from '$lib/components/wh/settings/FleetFacts.svelte';
	import FleetFeatures from '$lib/components/wh/settings/FleetFeatures.svelte';
	import FleetPairing from '$lib/components/wh/settings/FleetPairing.svelte';

	/**
	 * Fleet → Overview: not in a fleet, how to join one (from Settings → Fleet, whose
	 * gateways it joins through); in one, which fleet and the captain's place in it, this
	 * ship's own pages, and what this ship may use, with why anything is off. Only on this
	 * machine, never through the gateway, as Settings → Fleet.
	 */
	let { data } = $props();

	let fresh = $state<FleetView | null>(null);
	const view = $derived(fresh ?? (data.membership as FleetView | null));
	const remote = $derived(data.remote as CloudView | null);
	let busy = $state<string | null>(null);
	let error = $state('');
	let note = $state('');
	let now = $state(Date.now());

	const pairing = $derived(view?.pairing && !view.pairing.error ? view.pairing : null);
	const current = $derived(view?.gateways.find((g) => g.active) ?? null);
	const host = (url: string) => URL.parse(url)?.host ?? url;
	const gatewayName = $derived(
		view ? (current?.name ?? (view.fleetyard ? 'Fleetyard' : host(view.gateway))) : ''
	);
	const remotesOff = $derived(switchedOff(view, 'remotes'));
	const remoteOn = $derived(!!remote && remote.enabled && remote.started && !!remote.device);

	const STATES: Record<'refused' | 'unknown' | 'no-fleets', string> = {
		refused:
			'The gateway no longer lets this ship in its fleet. Leave in Settings → Fleet, then join again.',
		unknown: 'Paired. Asking the gateway which fleet this ship is in…',
		'no-fleets':
			'This gateway has no fleets, so there is nothing more to show here. Remote access works through it as before.'
	};

	async function read() {
		now = Date.now();
		fresh = (await readFleet()) ?? fresh;
	}

	async function act(action: string) {
		busy = action;
		error = '';
		note = '';
		const acted = await fleetAction(page.data.sessionToken as string, action);
		if (acted.view) fresh = acted.view;
		now = Date.now();
		error = acted.error;
		note = acted.note;
		busy = null;
	}

	// Each second while a Join waits for approval, every few while the gateway is being asked,
	// else twice a minute; not while the tab is hidden, and at once when it is shown again.
	$effect(() => {
		if (!view) return;
		return poll({
			load: read,
			intervalMs: pairing ? 1000 : view.state === 'unknown' ? 3000 : 30_000,
			immediate: false,
			onresult: () => {},
			onerror: () => {},
			doc: document
		});
	});
</script>

<svelte:head><title>Fleet · Wheelhouse</title></svelte:head>

{#if !view}
	<h1 class="mt-6 text-2xl">Fleet</h1>
	{#if data.relayGateway}<AlreadyRemote gateway={data.relayGateway} />{/if}
{:else if view.state === 'not-joined'}
	<p class="mono-label mt-6">Fleet</p>
	<h1 class="mt-2 text-[2.1rem] leading-tight">Beyond this <em class="text-gold">computer</em></h1>
	<p class="mt-2 max-w-prose text-muted-foreground">
		A fleet is how this ship reaches beyond this computer. Everyone has a fleet of their own on
		Fleetyard; a company’s fleet adds its teams.
	</p>

	<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
		<section
			class="rounded-lg border border-gold/60 bg-card px-5 py-5 sm:px-6"
			aria-labelledby="fleet-join-title"
			data-testid="fleet-join-card"
		>
			{#if pairing}
				<p class="mono-label">Waiting for approval</p>
				<div class="mt-3"><FleetPairing {pairing} /></div>
				<div class="mt-4">
					<Button variant="outline" size="sm" disabled={busy !== null} onclick={() => act('cancel')}
						>Cancel</Button
					>
				</div>
			{:else}
				<p class="mono-label">One step</p>
				<h2 id="fleet-join-title" class="mt-2 text-2xl">Join a <em class="text-gold">fleet</em></h2>
				<p class="mt-2 text-sm">
					Sign in on the gateway and approve this ship with your passkey. If your company has a
					fleet and you’re invited, you choose it there.
				</p>
				<Button
					class="mt-4"
					disabled={busy !== null}
					onclick={() => act('join')}
					data-testid="fleet-join"
					><Anchor class="size-4" aria-hidden="true" />{busy === 'join'
						? 'Joining…'
						: 'Join a fleet'}</Button
				>
			{/if}
			<p class="mt-4 text-xs text-muted-foreground" data-testid="fleet-through">
				Through <span class="font-medium text-foreground">{gatewayName}</span> · {host(
					view.gateway
				)}. Another gateway (your own, or one for testing) is set in
				<a class="underline" href="/settings/fleet">Settings → Fleet</a>. Joining reaches nothing
				from outside: remote access stays off until you start it.
			</p>
			{@render problems()}
		</section>

		<section aria-labelledby="fleet-gives-title">
			<h2 id="fleet-gives-title" class="mono-label">What a fleet gives this ship</h2>
			<ul class="mt-3 grid gap-4 text-sm">
				<li class="flex items-start gap-3">
					<RadioTower class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span
						><span class="block font-medium">Reach this ship from anywhere</span><span
							class="block text-muted-foreground"
							>Your phone or another computer opens this Wheelhouse through the gateway. Off until
							you start it.</span
						></span
					>
				</li>
				<li class="flex items-start gap-3">
					<Cloud class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span
						><span class="block font-medium">Second mates on demand</span><span
							class="block text-muted-foreground"
							>A Firstmate on a cloud machine works while this computer sleeps.</span
						></span
					>
				</li>
				<li class="flex items-start gap-3">
					<UsersRound class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span
						><span class="block font-medium">With a company fleet, your team</span><span
							class="block text-muted-foreground"
							>The fleet decides what this ship may use, and says why when something is off.</span
						></span
					>
				</li>
			</ul>
		</section>
	</div>
{:else}
	<div class="mt-6 flex flex-wrap items-end justify-between gap-3">
		<div class="min-w-0">
			<p class="mono-label" data-testid="fleet-kicker">
				{view.fleet
					? `Fleet · ${view.fleet.kind === 'personal' ? 'your own fleet' : view.fleet.name}`
					: 'Fleet'}
			</p>
			<h1 class="mt-2 text-[2.1rem] leading-tight text-balance" data-testid="fleet-title">
				{#if view.fleet?.kind === 'company'}{view.fleet.name}
					<em class="text-gold">fleet</em>{:else if view.fleet}Your <em class="text-gold">fleet</em
					>{:else}This <em class="text-gold">ship</em>{/if}
			</h1>
		</div>
		<Button
			variant="outline"
			size="sm"
			disabled={busy !== null}
			onclick={() => act('check')}
			data-testid="fleet-check">{busy === 'check' ? 'Checking…' : 'Check now'}</Button
		>
	</div>

	<div class="mt-4"><FleetFacts {view} {now} /></div>
	{#if view.state !== 'joined'}
		<p
			class="mt-4 max-w-prose text-sm {view.state === 'refused'
				? 'text-danger'
				: 'text-muted-foreground'}"
			data-testid="fleet-state-note"
		>
			{STATES[view.state]}
		</p>
	{/if}
	{#if view.error}
		<p
			class="mt-3 text-sm {view.state === 'joined' ? 'text-muted-foreground' : 'text-danger'}"
			role={view.state === 'joined' ? 'status' : 'alert'}
		>
			{view.state === 'joined' ? `Showing the last answer. ${view.error}` : view.error}
		</p>
	{/if}
	{@render problems()}

	{#if remote || remotesOff}
		<h2 class="section-label mt-8">This ship</h2>
		<div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#if remotesOff}
				<a
					class="block rounded-lg border border-dashed bg-card px-4 py-4 hover:bg-muted/40"
					href="/fleet/remotes"
					data-testid="fleet-card-remotes"
					data-locked="true"
				>
					<span class="flex items-center gap-2.5 font-medium">
						<RadioTower class="size-4 text-muted-foreground" aria-hidden="true" />Remotes
						<Lock class="ml-auto size-3.5 text-muted-foreground" aria-label="Switched off" />
					</span>
					<span class="mt-2 block text-sm text-muted-foreground">{remotesOff.note}</span>
					{#if remotesOff.why}<span class="mt-1 block text-sm text-muted-foreground italic"
							>“{remotesOff.why}”</span
						>{/if}
					{#if remotesOff.reason}<code
							class="mt-2 inline-block rounded border border-hair px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
							>{remotesOff.reason}</code
						>{/if}
				</a>
			{:else if remote}
				<a
					class="block rounded-lg border bg-card px-4 py-4 hover:bg-muted/40"
					href="/fleet/remotes"
					data-testid="fleet-card-remotes"
				>
					<span class="flex items-center gap-2.5 font-medium">
						<RadioTower class="size-4 text-muted-foreground" aria-hidden="true" />Remotes
					</span>
					<span class="mt-2 block text-sm"
						>{remoteOn
							? `On. This ship is reachable through ${gatewayName}.`
							: 'Off. Start it to open this ship from your phone or another computer.'}</span
					>
					<span class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
						<span
							class="size-2 rounded-full {remoteOn && remote.state === 'online'
								? 'bg-success'
								: remoteOn
									? 'bg-warning'
									: 'bg-muted-foreground'}"
							aria-hidden="true"
						></span>
						{remoteOn
							? remote.state === 'online'
								? `${remote.sessions.length} ${remote.sessions.length === 1 ? 'session' : 'sessions'} seen`
								: 'Connecting'
							: 'Stopped'}
					</span>
				</a>
			{/if}
		</div>
	{/if}

	{#if view.state === 'joined'}
		<section class="mt-8 max-w-2xl rounded-lg border bg-card px-4 py-4">
			<FleetFeatures {view} />
		</section>
	{/if}

	<p class="mt-6 text-xs text-muted-foreground">
		Gateways and leaving the fleet: <a class="underline" href="/settings/fleet">Settings → Fleet</a>
	</p>
{/if}

{#snippet problems()}
	{#if view?.pairing?.error}
		<p class="mt-3 text-sm text-danger" role="alert">{view.pairing.error}</p>
	{/if}
	{#if error}<p class="mt-3 text-sm text-danger" role="alert">{error}</p>{/if}
	{#if note}<p class="mt-3 text-sm text-muted-foreground" role="status">{note}</p>{/if}
{/snippet}
