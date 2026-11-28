<script lang="ts">
	import { page } from '$app/state';
	import { fleetAction, readFleet } from '$lib/client/fleet';
	import { poll } from '$lib/console';
	import { DEFAULT_GATEWAY } from '$lib/cloud';
	import type { FleetGatewayView, FleetState, FleetView } from '$lib/fleet';
	import { Button } from '$lib/components/ui/button';
	import FleetFacts from './FleetFacts.svelte';
	import FleetPairing from './FleetPairing.svelte';
	import FleetFeatures from './FleetFeatures.svelte';

	/**
	 * Settings → Fleet: join a fleet by pairing this ship with the gateway in
	 * use, then see which fleet it is in, the captain's role there and what the
	 * gateway says this ship may use, with why anything is off; and leave.
	 * Below, the saved gateways (Fleetyard, one the captain hosts, one for
	 * testing): add, edit, remove, and switch which one this ship uses, after a
	 * confirmation. Joining leaves remote access off until it is started on the
	 * Remotes page. Only on this machine, never through the gateway.
	 *
	 * While the experimental `fleet` flag is on, joining and the fleet itself are
	 * Fleet → Overview's (`admin`): this keeps the gateways, and leaving.
	 */
	let { view: initial, admin = false }: { view: FleetView; admin?: boolean } = $props();

	let fresh = $state<FleetView | null>(null);
	const view = $derived(fresh ?? initial);
	let busy = $state<string | null>(null);
	let confirming = $state(false);
	/** The saved gateway being edited ('new' for one being added), with the form's values. */
	let editing = $state<{ id: string; name: string; gateway: string } | null>(null);
	/** The saved gateway a switch to, or a removal of, waits for confirmation. */
	let asking = $state<{ id: string; what: 'switch' | 'remove' } | null>(null);
	let error = $state('');
	let note = $state('');
	let now = $state(Date.now());

	const current = $derived(view.gateways.find((g) => g.active) ?? null);
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

	async function read() {
		now = Date.now();
		// Keep the last view when it could not be asked; the next look may work.
		fresh = (await readFleet()) ?? fresh;
	}

	async function act(action: string, extra: Record<string, unknown> = {}) {
		busy = action;
		error = '';
		note = '';
		const acted = await fleetAction(page.data.sessionToken as string, action, extra);
		if (acted.view) fresh = acted.view;
		now = Date.now();
		error = acted.error;
		note = acted.note;
		if (acted.ok) {
			editing = null;
			asking = null;
		}
		busy = null;
		confirming = false;
	}

	function startAdding() {
		error = '';
		asking = null;
		// Fleetyard first, when it isn't saved yet.
		const fleetyard = view.gateways.some((g) => g.gateway === DEFAULT_GATEWAY);
		editing = fleetyard
			? { id: 'new', name: '', gateway: '' }
			: { id: 'new', name: 'Fleetyard', gateway: DEFAULT_GATEWAY };
	}

	function save() {
		if (!editing) return;
		const { id, name, gateway } = editing;
		if (id === 'new') void act('add', { name, gateway });
		else void act('edit', { id, name, gateway });
	}

	/** What switching to `g` does, said before the captain confirms it. */
	function switchText(g: FleetGatewayView): string {
		const leaving =
			current?.paired && view.state !== 'not-joined'
				? `This ship stops using ${current.name}: remote access through it stops, and its pairing is kept so you can switch back without approving again. `
				: '';
		const joining = g.paired
			? `It rejoins its fleet through ${g.name} at once.`
			: `Then approve this ship on ${g.name} to join its fleet.`;
		return `${leaving}${joining}`;
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

<section
	id="gateways"
	class="mt-6 rounded-lg border bg-card"
	aria-labelledby="fleet-gateways-title"
	data-testid="fleet-gateways"
>
	<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
		<div class="min-w-0">
			<h2 id="fleet-gateways-title" class="font-display text-lg font-semibold">Gateways</h2>
			<p class="text-sm text-muted-foreground">
				This ship joins its fleet through the one in use. Add your own, or switch to another.
			</p>
		</div>
		{#if editing?.id !== 'new'}
			<Button
				variant="outline"
				size="sm"
				disabled={busy !== null}
				onclick={startAdding}
				data-testid="gateway-add">Add gateway</Button
			>
		{/if}
	</header>
	<ul class="divide-y" data-testid="gateway-list">
		{#each view.gateways as g (g.id)}
			<li class="grid gap-3 px-4 py-3" data-gateway={g.id}>
				{#if editing?.id === g.id}
					{@render form()}
				{:else}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0 text-sm">
							<p>
								<span class="font-medium">{g.name}</span>
								{#if g.active}<span
										class="ml-1.5 rounded-full border border-success/50 bg-success/10 px-2 py-0.5 text-xs text-success"
										>In use</span
									>{:else if g.paired}<span
										class="ml-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
										>Paired</span
									>{/if}
							</p>
							<p class="truncate text-muted-foreground">{g.gateway}</p>
						</div>
						<div class="flex flex-wrap gap-2">
							{#if !g.active}
								<Button
									size="sm"
									variant="outline"
									disabled={busy !== null || !!pairing}
									onclick={() => {
										editing = null;
										asking = { id: g.id, what: 'switch' };
									}}
									data-testid="gateway-switch">Switch to</Button
								>
							{/if}
							<Button
								size="sm"
								variant="ghost"
								disabled={busy !== null}
								onclick={() => {
									asking = null;
									editing = { id: g.id, name: g.name, gateway: g.gateway };
								}}
								data-testid="gateway-edit">Edit</Button
							>
							{#if !g.active}
								<Button
									size="sm"
									variant="ghost"
									disabled={busy !== null || !!pairing}
									onclick={() => {
										editing = null;
										asking = { id: g.id, what: 'remove' };
									}}
									data-testid="gateway-remove">Remove…</Button
								>
							{/if}
						</div>
					</div>
					{#if asking?.id === g.id}
						<div class="rounded-md border p-3 text-sm" role="group" aria-label="Confirm">
							<p>
								{#if asking.what === 'switch'}
									Switch to {g.name}? {switchText(g)}
								{:else}
									Remove {g.name}? {g.paired
										? 'This ship’s pairing there is revoked and its key deleted here.'
										: 'Nothing else changes.'}
								{/if}
							</p>
							<div class="mt-2 flex flex-wrap gap-2">
								<Button
									size="sm"
									variant={asking.what === 'remove' ? 'destructive' : 'default'}
									disabled={busy !== null}
									onclick={() => act(asking!.what, { id: g.id })}
									data-testid="gateway-confirm"
									>{asking.what === 'switch'
										? busy === 'switch'
											? 'Switching…'
											: `Switch to ${g.name}`
										: busy === 'remove'
											? 'Removing…'
											: 'Remove'}</Button
								>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy !== null}
									onclick={() => (asking = null)}>Cancel</Button
								>
							</div>
						</div>
					{/if}
				{/if}
			</li>
		{/each}
		{#if editing?.id === 'new'}
			<li class="px-4 py-3">{@render form()}</li>
		{/if}
	</ul>
</section>

{#if admin}
	{#if view.state !== 'not-joined'}
		<section class="mt-6 rounded-lg border bg-card" aria-label="Leave the fleet">
			{@render problems()}
			{@render leave()}
		</section>
	{:else if error || note}
		<section class="mt-6 rounded-lg border bg-card">{@render problems()}</section>
	{/if}
{:else}
	<section class="mt-6 rounded-lg border bg-card" aria-labelledby="fleet-title">
		<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
			<div class="min-w-0">
				<h2 id="fleet-title" class="font-display text-lg font-semibold">
					{view.fleet
						? view.fleet.name
						: view.state === 'not-joined'
							? 'Join a fleet'
							: 'This ship'}
				</h2>
				<p class="flex items-center gap-2 text-sm" data-state={pairing ? 'pairing' : view.state}>
					<span class="size-2 shrink-0 rounded-full {st.dot}" aria-hidden="true"></span>
					<span class="font-medium" data-testid="fleet-state">{st.label}</span>
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
					<p class="text-sm" data-testid="fleet-through">
						Through <span class="font-medium">{current?.name ?? host(view.gateway)}</span>
						<span class="text-muted-foreground">· {host(view.gateway)}</span>
					</p>
					<div class="flex flex-wrap items-center gap-2">
						{#if pairing}
							<Button
								variant="outline"
								size="sm"
								disabled={busy !== null}
								onclick={() => act('cancel')}>Cancel</Button
							>
						{:else}
							<Button
								size="sm"
								disabled={busy !== null}
								onclick={() => act('join')}
								data-testid="fleet-join">{busy === 'join' ? 'Joining…' : 'Join'}</Button
							>
						{/if}
					</div>
					<p class="max-w-prose text-xs text-muted-foreground">
						You sign in on the gateway and approve this ship with your passkey. Joining reaches
						nothing from outside: remote access stays off until you start it. To join through
						another gateway, switch to it above.
					</p>
				</div>
			{/if}

			{#if pairing}
				<div class="px-4 py-4"><FleetPairing {pairing} /></div>
			{/if}

			{#if view.state !== 'not-joined'}
				<div class="px-4 py-4"><FleetFacts {view} {now} /></div>
			{/if}

			{#if view.state === 'no-fleets'}
				<p class="px-4 py-4 text-sm text-muted-foreground" data-testid="fleet-no-fleets">
					This gateway has no fleets, so there is nothing more to show here. Remote access works
					through it as before.
				</p>
			{/if}

			{#if view.state === 'joined'}
				<div class="px-4 py-4"><FleetFeatures {view} /></div>
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
			{@render problems()}

			{#if view.state !== 'not-joined'}{@render leave()}{/if}
		</div>
	</section>
{/if}

{#snippet problems()}
	{#if view.pairing?.error}
		<p class="px-4 py-3 text-sm text-danger" role="alert">{view.pairing.error}</p>
	{/if}
	{#if error}<p class="px-4 py-3 text-sm text-danger" role="alert">{error}</p>{/if}
	{#if note}<p class="px-4 py-3 text-sm text-muted-foreground" role="status">{note}</p>{/if}
{/snippet}

{#snippet leave()}
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
{/snippet}

{#snippet form()}
	{#if editing}
		<div class="grid max-w-xl gap-3 text-sm" data-testid="gateway-form">
			<label class="grid gap-1.5">
				<span class="font-medium">Name</span>
				<input
					class="rounded-md border bg-background px-3 py-2"
					maxlength="60"
					value={editing.name}
					placeholder="Our gateway"
					disabled={busy !== null}
					oninput={(event) => (editing!.name = event.currentTarget.value)}
					aria-label="Gateway name"
				/>
			</label>
			<label class="grid gap-1.5">
				<span class="font-medium">Address</span>
				<input
					class="rounded-md border bg-background px-3 py-2"
					type="url"
					value={editing.gateway}
					placeholder="https://gateway.example.com"
					disabled={busy !== null}
					oninput={(event) => (editing!.gateway = event.currentTarget.value)}
					aria-label="Gateway URL"
				/>
				<span class="text-xs text-muted-foreground"
					>HTTPS, or HTTP on this computer for testing.</span
				>
			</label>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" disabled={busy !== null} onclick={save} data-testid="gateway-save"
					>{editing.id === 'new' ? 'Add' : 'Save'}</Button
				>
				<Button size="sm" variant="ghost" disabled={busy !== null} onclick={() => (editing = null)}
					>Cancel</Button
				>
			</div>
		</div>
	{/if}
{/snippet}
