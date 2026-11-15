<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { DEFAULT_GATEWAY, type CloudView } from '$lib/cloud';
	import { Button } from '$lib/components/ui/button';

	let { initial }: { initial: CloudView } = $props();
	let view = $state(untrack(() => initial));
	let profileName = $state(untrack(() => initial.profileName ?? 'Fleetyard'));
	let gateway = $state(untrack(() => initial.gateway || DEFAULT_GATEWAY));
	let gatewayChoice = $state(
		untrack(() => (initial.gateway === DEFAULT_GATEWAY ? 'fleetyard' : 'custom'))
	);
	let busy = $state(false);
	let dirty = $state(false);
	let error = $state('');
	let note = $state('');
	let confirmingDisconnect = $state(false);

	const pairing = $derived(view.pairing && !view.pairing.error ? view.pairing : null);
	const status = $derived(
		pairing
			? { label: 'Waiting for approval', dot: 'bg-warning' }
			: view.state === 'online'
				? { label: 'Connected', dot: 'bg-success' }
				: view.state === 'connecting'
					? { label: 'Connecting', dot: 'bg-warning' }
					: view.state === 'stopped'
						? { label: 'Connection stopped', dot: 'bg-danger' }
						: view.device
							? { label: 'Paired, not connected', dot: 'bg-muted-foreground' }
							: { label: 'Not connected', dot: 'bg-muted-foreground' }
	);

	function chooseGateway(choice: string) {
		gatewayChoice = choice;
		if (choice === 'fleetyard') gateway = DEFAULT_GATEWAY;
		else if (gateway === DEFAULT_GATEWAY) gateway = '';
		dirty = true;
	}

	async function send(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
		try {
			const response = await fetch('/api/cloud', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ action, ...extra })
			});
			const body = (await response.json().catch(() => null)) as {
				message?: string;
				view?: CloudView;
				note?: string | null;
			} | null;
			if (body?.view) view = body.view;
			if (!response.ok) {
				error = body?.message ?? `Wheelhouse could not do that (${response.status}).`;
				return false;
			}
			note = body?.note ?? '';
			return true;
		} catch {
			error = 'Wheelhouse could not be reached. Try again.';
			return false;
		}
	}

	async function connect() {
		busy = true;
		error = '';
		note = '';
		const selectedGateway = gatewayChoice === 'fleetyard' ? DEFAULT_GATEWAY : gateway.trim();
		if (!selectedGateway) {
			error = 'Paste the URL of your self-hosted or local Gateway first.';
			busy = false;
			return;
		}
		try {
			if (
				!(await send('profile', {
					profileName,
					gateway: selectedGateway
				}))
			)
				return;
			dirty = false;
			if (!(await send('start'))) return;
			note = view.device
				? 'Gateway connection started. Wheelhouse will reconnect in the background.'
				: 'Pairing started. Approve this Wheelhouse on the Gateway to finish connecting.';
		} finally {
			busy = false;
		}
	}

	async function cancelPairing() {
		busy = true;
		error = '';
		note = '';
		try {
			if (await send('stop')) note = 'Pairing cancelled. The Gateway profile is unchanged.';
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		busy = true;
		error = '';
		note = '';
		try {
			if (await send('disconnect')) {
				confirmingDisconnect = false;
				dirty = false;
				note = 'Disconnected. The saved Gateway profile is ready to use again.';
			}
		} finally {
			busy = false;
		}
	}

	async function read() {
		try {
			const response = await fetch('/api/cloud');
			if (!response.ok) return;
			const next = (await response.json()) as CloudView;
			const wasPairing = !!pairing;
			view = next;
			if (!dirty) {
				profileName = next.profileName ?? 'Fleetyard';
				gateway = next.gateway || DEFAULT_GATEWAY;
				gatewayChoice = gateway === DEFAULT_GATEWAY ? 'fleetyard' : 'custom';
			}
			if (wasPairing && next.device) note = 'Connected. This profile is ready for remote access.';
		} catch {
			// Keep the last connection state; the next poll may work.
		}
	}

	$effect(() => {
		const timer = setInterval(
			() => void read(),
			pairing ? 1000 : view.state === 'online' ? 8000 : 3000
		);
		return () => clearInterval(timer);
	});
</script>

<section
	class="mt-6 overflow-hidden rounded-xl border bg-card"
	aria-labelledby="gateway-profile-title"
>
	<header class="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
		<div>
			<h2 id="gateway-profile-title" class="font-display text-xl font-semibold">
				Connection profile
			</h2>
			<p class="mt-1 max-w-prose text-sm text-muted-foreground">
				One sign-in and pairing are shared across the Gateway features in Wheelhouse.
			</p>
		</div>
		<p
			class="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
			data-testid="gateway-status"
		>
			<span class="size-2 rounded-full {status.dot}" aria-hidden="true"></span>
			<span>{status.label}</span>
		</p>
	</header>

	<div class="grid gap-5 p-5">
		<label class="grid gap-1.5 text-sm">
			<span class="font-medium">Profile name</span>
			<input
				class="rounded-md border bg-background px-3 py-2"
				maxlength="60"
				value={profileName}
				disabled={busy}
				oninput={(event) => {
					profileName = event.currentTarget.value;
					dirty = true;
				}}
				aria-label="Gateway profile name"
			/>
		</label>

		<div class="grid gap-1.5 text-sm">
			<label for="gateway-choice" class="font-medium">Gateway</label>
			<select
				id="gateway-choice"
				class="rounded-md border bg-background px-3 py-2"
				value={gatewayChoice}
				disabled={busy || !!view.device}
				onchange={(event) => chooseGateway(event.currentTarget.value)}
			>
				<option value="fleetyard">Fleetyard (default)</option>
				<option value="custom">Self-hosted or local testing</option>
			</select>
			<input
				class="mt-1 rounded-md border bg-background px-3 py-2 disabled:opacity-60"
				type="url"
				value={gateway}
				placeholder={gatewayChoice === 'custom'
					? 'https://gateway.example or http://127.0.0.1:4000'
					: DEFAULT_GATEWAY}
				disabled={busy || !!view.device}
				oninput={(event) => {
					gateway = event.currentTarget.value;
					gatewayChoice = gateway === DEFAULT_GATEWAY ? 'fleetyard' : 'custom';
					dirty = true;
				}}
				aria-label="Gateway URL"
			/>
			{#if view.device}
				<p class="text-xs text-muted-foreground">
					Revoke this pairing before switching Gateways. The saved URL is {view.gateway}.
				</p>
			{:else}
				<p class="text-xs text-muted-foreground">
					HTTPS is required except for HTTP on this computer, for local testing.
				</p>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Button
				size="sm"
				disabled={busy || !!pairing}
				onclick={connect}
				data-testid="gateway-connect"
			>
				{busy
					? 'Connecting…'
					: view.device
						? dirty
							? 'Save and reconnect'
							: 'Reconnect'
						: 'Connect'}
			</Button>
			{#if pairing}
				<Button variant="outline" size="sm" disabled={busy} onclick={cancelPairing}
					>Cancel pairing</Button
				>
			{/if}
			{#if view.device}
				{#if confirmingDisconnect}
					<Button variant="destructive" size="sm" disabled={busy} onclick={disconnect}
						>Confirm disconnect</Button
					>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => (confirmingDisconnect = false)}>Keep connected</Button
					>
				{:else}
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => (confirmingDisconnect = true)}>Disconnect…</Button
					>
				{/if}
			{/if}
		</div>

		{#if pairing}
			<section
				class="rounded-lg border border-warning/50 bg-warning/5 p-4"
				aria-labelledby="gateway-pairing-title"
				role="status"
			>
				<h3 id="gateway-pairing-title" class="font-medium">
					Approve this pairing with your passkey
				</h3>
				<ol class="mt-2 list-decimal space-y-1 pl-5 text-sm">
					<li>
						On a device you trust, sign in at <a
							class="break-all underline"
							href={pairing.verificationUri}
							target="_blank"
							rel="noreferrer noopener">{pairing.verificationUri}</a
						>.
					</li>
					<li>
						Type this one-time code: <code class="tabular rounded bg-background px-1.5 py-0.5"
							>{pairing.userCode}</code
						>
					</li>
					<li>
						Choose fingerprint <code class="tabular">{pairing.fingerprint}</code> and approve with your
						passkey.
					</li>
				</ol>
				<p class="mt-3 text-xs text-warning">
					Only approve a pairing you started. Approval gives this Gateway access to this Wheelhouse,
					including its terminals.
				</p>
			</section>
		{/if}

		{#if view.pairing?.error}
			<p class="rounded-md border border-danger/40 p-3 text-sm text-danger" role="alert">
				{view.pairing.error}
			</p>
		{/if}
		{#if view.reason && view.state === 'stopped'}
			<p class="rounded-md border border-danger/40 p-3 text-sm text-danger" role="alert">
				{view.reason}
			</p>
		{/if}
		{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
		{#if note}<p class="text-sm text-muted-foreground" role="status">{note}</p>{/if}

		<div
			class="grid gap-3 border-t pt-4 sm:grid-cols-3"
			aria-label="Gateway features using this profile"
		>
			<div class="rounded-lg border p-3">
				<p class="text-sm font-medium">Remote access</p>
				<p class="mt-1 text-xs text-muted-foreground">Uses this profile now.</p>
			</div>
			<div class="rounded-lg border p-3">
				<p class="text-sm font-medium">Second mates</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Will reuse this profile when Gateway setup arrives.
				</p>
			</div>
			<div class="rounded-lg border p-3">
				<p class="text-sm font-medium">Events</p>
				<p class="mt-1 text-xs text-muted-foreground">Can reuse this profile for later delivery.</p>
			</div>
		</div>
	</div>
</section>
