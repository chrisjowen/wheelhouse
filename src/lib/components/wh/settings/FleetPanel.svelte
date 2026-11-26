<script lang="ts">
	import { Check, Minus } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { poll } from '$lib/console';
	import { DEFAULT_GATEWAY } from '$lib/cloud';
	import type { FleetState, FleetView } from '$lib/fleet';
	import { ago } from '$lib/format';
	import { Button } from '$lib/components/ui/button';

	/**
	 * Settings → Fleet: join a fleet by pairing this ship with a gateway
	 * (Fleetyard by default, or one the captain hosts), then see which fleet it
	 * is in, the captain's role there and what the gateway says this ship may
	 * use, with why anything is off; and leave. Joining leaves remote access
	 * off until it is started on the Remotes page. Only on this machine, never
	 * through the gateway.
	 */
	let { view: initial }: { view: FleetView } = $props();

	let fresh = $state<FleetView | null>(null);
	const view = $derived(fresh ?? initial);
	let choice = $state<'fleetyard' | 'custom' | null>(null);
	let customUrl = $state(untrack(() => (initial.fleetyard ? '' : initial.gateway)));
	let busy = $state<string | null>(null);
	let confirming = $state(false);
	let error = $state('');
	let note = $state('');
	let now = $state(Date.now());

	const gatewayChoice = $derived(choice ?? (view.fleetyard ? 'fleetyard' : 'custom'));
	const pairing = $derived(view.pairing && !view.pairing.error ? view.pairing : null);
	const host = (url: string) => URL.parse(url)?.host ?? url;

	const STATE: Record<FleetState, { dot: string; label: string }> = {
		'not-joined': { dot: 'bg-muted-foreground', label: 'Not in a fleet' },
		joined: { dot: 'bg-success', label: 'In a fleet' },
		'no-fleets': { dot: 'bg-muted-foreground', label: 'Paired' },
		refused: { dot: 'bg-danger', label: 'Not allowed' },
		unknown: { dot: 'bg-warning', label: 'Paired, checking' }
	};
	const st = $derived(
		pairing ? { dot: 'bg-warning', label: 'Waiting for approval' } : STATE[view.state]
	);
	const on = $derived(view.features.filter((f) => f.on));
	const off = $derived(view.features.filter((f) => !f.on && f.reason !== 'not_in_plan'));
	const notInPlan = $derived(view.features.filter((f) => !f.on && f.reason === 'not_in_plan'));
	const ROLES: Record<string, string> = {
		owner: 'Owner',
		admin: 'Admin',
		billing: 'Billing',
		member: 'Member'
	};

	async function read() {
		now = Date.now();
		try {
			const r = await fetch('/api/fleet/membership');
			if (r.ok) fresh = (await r.json()) as FleetView;
		} catch {
			// keep the last view; the next look may work
		}
	}

	async function act(action: string, extra: Record<string, unknown> = {}) {
		busy = action;
		error = '';
		note = '';
		try {
			const r = await fetch('/api/fleet/membership', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ action, ...extra })
			});
			const body = (await r.json().catch(() => null)) as {
				message?: string;
				view?: FleetView;
				note?: string | null;
			} | null;
			if (body?.view) fresh = body.view;
			now = Date.now();
			if (!r.ok) {
				error = body?.message ?? `Wheelhouse could not do that (${r.status}).`;
				return;
			}
			note = body?.note ?? '';
			if (action === 'leave') choice = null;
		} catch {
			error = 'Wheelhouse could not be reached. Try again.';
		} finally {
			busy = null;
			confirming = false;
		}
	}

	function join() {
		const gateway = gatewayChoice === 'fleetyard' ? '' : customUrl.trim();
		if (gatewayChoice === 'custom' && !gateway) {
			error = 'Give your gateway’s address first, such as https://gateway.example.com.';
			return;
		}
		void act('join', { gateway });
	}

	// Each second while a Join waits for approval, every few while the gateway is being asked,
	// else twice a minute; not while the tab is hidden, and at once when it is shown again.
	$effect(() =>
		poll({
			load: read,
			intervalMs: pairing ? 1000 : view.state === 'unknown' ? 3000 : 30_000,
			immediate: false,
			onresult: () => {},
			onerror: () => {},
			doc: document
		})
	);
</script>

<section class="mt-6 rounded-lg border bg-card" aria-labelledby="fleet-title">
	<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
		<div class="min-w-0">
			<h2 id="fleet-title" class="font-display text-lg font-semibold">
				{view.fleet ? view.fleet.name : view.state === 'not-joined' ? 'Join a fleet' : 'This ship'}
			</h2>
			<p class="flex items-center gap-2 text-sm" data-state={pairing ? 'pairing' : view.state}>
				<span class="size-2 shrink-0 rounded-full {st.dot}" aria-hidden="true"></span>
				<span class="font-medium" data-testid="fleet-state">{st.label}</span>
				{#if view.fleet}
					<span class="truncate text-muted-foreground"
						>· {view.fleet.kind === 'personal' ? 'your own fleet' : 'company fleet'}</span
					>
				{/if}
			</p>
		</div>
		{#if view.state !== 'not-joined'}
			<Button
				variant="outline"
				size="sm"
				disabled={busy !== null}
				onclick={() => act('check')}
				data-testid="fleet-check">{busy === 'check' ? 'Checking…' : 'Check now'}</Button
			>
		{/if}
	</header>

	<div class="divide-y">
		{#if view.state === 'not-joined'}
			<div class="grid gap-4 px-4 py-4">
				<div class="grid max-w-xl gap-1.5 text-sm">
					<label for="fleet-gateway" class="font-medium">Gateway</label>
					<select
						id="fleet-gateway"
						class="rounded-md border bg-background px-3 py-2"
						value={gatewayChoice}
						disabled={busy !== null || !!pairing}
						onchange={(event) => {
							choice = event.currentTarget.value === 'custom' ? 'custom' : 'fleetyard';
						}}
					>
						<option value="fleetyard">Fleetyard (default)</option>
						<option value="custom">Your own gateway</option>
					</select>
					{#if gatewayChoice === 'custom'}
						<input
							class="mt-1 rounded-md border bg-background px-3 py-2"
							type="url"
							value={customUrl}
							placeholder="https://gateway.example.com"
							disabled={busy !== null || !!pairing}
							oninput={(event) => (customUrl = event.currentTarget.value)}
							aria-label="Gateway URL"
						/>
						<p class="text-xs text-muted-foreground">
							HTTPS, or HTTP on this computer for testing.
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">{DEFAULT_GATEWAY}</p>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if pairing}
						<Button
							variant="outline"
							size="sm"
							disabled={busy !== null}
							onclick={() => act('cancel')}>Cancel</Button
						>
					{:else}
						<Button size="sm" disabled={busy !== null} onclick={join} data-testid="fleet-join"
							>{busy === 'join' ? 'Joining…' : 'Join'}</Button
						>
					{/if}
				</div>
				<p class="max-w-prose text-xs text-muted-foreground">
					You sign in on the gateway and approve this ship with your passkey. Joining reaches
					nothing from outside: remote access stays off until you start it.
				</p>
			</div>
		{/if}

		{#if pairing}
			<section
				class="px-4 py-4"
				aria-labelledby="fleet-pairing-title"
				role="status"
				data-testid="fleet-pairing"
			>
				<h3 id="fleet-pairing-title" class="font-medium">Approve this ship on the gateway</h3>
				<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
					<li>
						On a device you trust, open <a
							class="break-all underline"
							href={pairing.verificationUri}
							target="_blank"
							rel="noreferrer noopener">{pairing.verificationUri}</a
						> and sign in.
					</li>
					<li>
						Type this one-time code: <code class="tabular rounded bg-muted px-1.5 py-0.5"
							>{pairing.userCode}</code
						>
					</li>
					<li>
						Check the fingerprint reads <code class="tabular">{pairing.fingerprint}</code>, then
						approve with your passkey.
					</li>
				</ol>
				<p class="mt-3 text-xs text-muted-foreground">
					Only approve a Join you started here. Approving lets this gateway reach this ship once you
					start remote access.
				</p>
			</section>
		{/if}

		{#if view.state !== 'not-joined'}
			<dl class="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-[10rem_1fr]">
				{#if view.fleet}
					<dt class="text-muted-foreground">Fleet</dt>
					<dd data-testid="fleet-name">
						{view.fleet.name}{#if view.fleet.plan}<span class="text-muted-foreground">
								· {view.fleet.plan} plan</span
							>{/if}
					</dd>
					<dt class="text-muted-foreground">Your role</dt>
					<dd>
						{view.fleet.role
							? (ROLES[view.fleet.role] ?? view.fleet.role)
							: 'Not a member'}{#if view.fleet.person}<span class="text-muted-foreground">
								· {view.fleet.person}</span
							>{/if}
					</dd>
					{#if view.fleet.teams.length}
						<dt class="text-muted-foreground">Teams</dt>
						<dd>
							{view.fleet.teams
								.map(
									(t) => `${t.name}${t.role === 'member' ? '' : ` (${ROLES[t.role] ?? t.role})`}`
								)
								.join(', ')}
						</dd>
					{/if}
				{/if}
				{#if view.ship}
					<dt class="text-muted-foreground">This ship</dt>
					<dd>
						{view.ship.name}
						<span class="tabular text-muted-foreground">· {view.ship.fingerprint}</span>
					</dd>
				{/if}
				<dt class="text-muted-foreground">Gateway</dt>
				<dd>
					{#if view.fleetyard}Fleetyard <span class="text-muted-foreground"
							>· {host(view.gateway)}</span
						>{:else}{host(view.gateway)}{/if}
				</dd>
				<dt class="text-muted-foreground">Last checked</dt>
				<dd data-testid="fleet-checked">
					{view.checkedAt ? ago(view.checkedAt, now) : 'Asking the gateway…'}
				</dd>
			</dl>
		{/if}

		{#if view.state === 'no-fleets'}
			<p class="px-4 py-4 text-sm text-muted-foreground" data-testid="fleet-no-fleets">
				This gateway has no fleets, so there is nothing more to show here. Remote access works
				through it as before.
			</p>
		{/if}

		{#if view.state === 'joined'}
			<div class="px-4 py-4" data-testid="fleet-features">
				<h3 class="font-medium">What this ship may use</h3>
				{#if on.length}
					<ul class="mt-2 grid gap-1.5 text-sm">
						{#each on as f (f.key)}
							<li class="flex items-start gap-2">
								<Check class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
								<span
									>{f.label}{#if f.note}<span class="text-muted-foreground">
											· {f.note}</span
										>{/if}</span
								>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">Nothing yet.</p>
				{/if}
				{#if off.length}
					<h3 class="mt-5 font-medium">Off</h3>
					<ul class="mt-2 grid gap-2 text-sm">
						{#each off as f (f.key)}
							<li class="flex items-start gap-2" data-reason={f.reason}>
								<Minus class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span class="min-w-0">
									<span>{f.label}</span>
									<span class="block text-muted-foreground">{f.note}</span>
									{#if f.why}<span class="block text-muted-foreground italic">“{f.why}”</span>{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if notInPlan.length}
					<p class="mt-5 text-xs text-muted-foreground" data-testid="fleet-not-in-plan">
						Not in {view.fleet?.plan ? `the ${view.fleet.plan}` : 'this fleet’s'} plan: {notInPlan
							.map((f) => f.label)
							.join(', ')}.
					</p>
				{/if}
			</div>
		{/if}

		{#if view.error}
			<p
				class="px-4 py-3 text-sm {view.state === 'joined'
					? 'text-muted-foreground'
					: 'text-danger'}"
				role={view.state === 'joined' ? 'status' : 'alert'}
			>
				{view.state === 'joined' ? `Showing the last answer. ${view.error}` : view.error}
			</p>
		{/if}
		{#if view.pairing?.error}
			<p class="px-4 py-3 text-sm text-danger" role="alert">{view.pairing.error}</p>
		{/if}
		{#if error}<p class="px-4 py-3 text-sm text-danger" role="alert">{error}</p>{/if}
		{#if note}<p class="px-4 py-3 text-sm text-muted-foreground" role="status">{note}</p>{/if}

		{#if view.state !== 'not-joined'}
			<div class="flex flex-wrap items-center gap-2 px-4 py-3">
				{#if confirming}
					<span class="text-sm"
						>Leave the fleet? This ship's key is deleted here and remote access stops.</span
					>
					<Button
						variant="destructive"
						size="sm"
						disabled={busy !== null}
						onclick={() => act('leave')}
						data-testid="fleet-leave-confirm">{busy === 'leave' ? 'Leaving…' : 'Leave'}</Button
					>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy !== null}
						onclick={() => (confirming = false)}>Stay</Button
					>
				{:else}
					<Button
						variant="outline"
						size="sm"
						disabled={busy !== null}
						onclick={() => (confirming = true)}
						data-testid="fleet-leave">Leave fleet…</Button
					>
				{/if}
			</div>
		{/if}
	</div>
</section>
