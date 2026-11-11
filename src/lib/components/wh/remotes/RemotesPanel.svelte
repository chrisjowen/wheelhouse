<script lang="ts">
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { DEFAULT_GATEWAY, type CloudState, type CloudView } from '$lib/cloud';
	import { ago } from '$lib/format';
	import { Button } from '$lib/components/ui/button';

	/**
	 * Remote access through a Wheelhouse Cloud gateway, as the Remotes page and
	 * Settings → Cloud show it: whether it is started and connected, Start and
	 * Stop, the pairing Start runs when this machine is not paired yet (a code
	 * to type on the gateway's own pair page and this machine's fingerprint to
	 * pick there), the gateway (the default, or one the captain hosts), the
	 * relay sessions, and revoking the machine. Remote access is off until
	 * started here; Wheelhouse keeps it up while `wheelhouse open` runs, and a
	 * Start left on resumes when Wheelhouse opens again. These pages answer only
	 * on this machine, never through the cloud.
	 */
	let { view: initial }: { view: CloudView } = $props();

	let fresh = $state<CloudView | null>(null);
	const view = $derived(fresh ?? initial);
	let error = $state('');
	let note = $state('');
	let busy = $state<string | null>(null);
	let confirming = $state(false);
	let gatewayDraft = $state<string | null>(null);
	let now = $state(Date.now());

	const STATE: Record<CloudState, { dot: string; label: string }> = {
		online: { dot: 'bg-success', label: 'Online' },
		connecting: { dot: 'bg-warning', label: 'Connecting' },
		'not-running': { dot: 'bg-muted-foreground', label: 'Started, not connected' },
		'not-paired': { dot: 'bg-muted-foreground', label: 'Not paired' },
		off: { dot: 'bg-muted-foreground', label: 'Off' },
		stopped: { dot: 'bg-danger', label: 'Stopped' }
	};
	const pairing = $derived(view.pairing && !view.pairing.error ? view.pairing : null);
	const st = $derived(
		pairing ? { dot: 'bg-warning', label: 'Waiting for approval' } : STATE[view.state]
	);
	/** Started (or pairing): the button stops it; else it starts it. */
	const running = $derived(!!pairing || (view.enabled && view.started));

	async function read() {
		now = Date.now();
		try {
			const r = await fetch('/api/cloud');
			if (r.ok) fresh = (await r.json()) as CloudView;
		} catch {
			// keep the last view; the next look may work
		}
	}

	async function act(action: string, extra: Record<string, unknown> = {}) {
		busy = action;
		error = '';
		note = '';
		try {
			const r = await fetch('/api/cloud', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ action, ...extra })
			});
			const body = (await r.json().catch(() => null)) as {
				message?: string;
				view?: CloudView;
				note?: string | null;
			} | null;
			if (!r.ok) {
				error = body?.message ?? `Wheelhouse could not do that (${r.status}).`;
				return;
			}
			if (body?.view) fresh = body.view;
			note = body?.note ?? '';
			if (action === 'gateway') gatewayDraft = null;
		} catch {
			error = 'Wheelhouse could not be reached. Try again.';
		} finally {
			busy = null;
			confirming = false;
		}
	}

	// Look again every few seconds (each second while pairing), so an approval and the connection show up.
	$effect(() => {
		const t = setInterval(read, pairing ? 1000 : view.state === 'online' ? 10_000 : 3000);
		return () => clearInterval(t);
	});
</script>

<section class="mt-8 rounded-lg border bg-card" aria-labelledby="remote-machine">
	<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
		<div class="min-w-0">
			<h2 id="remote-machine" class="font-display text-lg font-semibold">Remote access</h2>
			<p class="flex items-center gap-2 text-sm" data-state={pairing ? 'pairing' : view.state}>
				<span class="size-2 shrink-0 rounded-full {st.dot}" aria-hidden="true"></span>
				<span class="font-medium" data-testid="remote-state">{st.label}</span>
				{#if view.state === 'online' && view.since}
					<span class="truncate text-muted-foreground">since {ago(view.since, now)}</span>
				{/if}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if running}
				<Button
					variant="outline"
					size="sm"
					disabled={busy !== null}
					onclick={() => act('stop')}
					data-testid="remote-toggle">Stop</Button
				>
			{:else}
				<Button
					size="sm"
					disabled={busy !== null}
					onclick={() => act('start')}
					data-testid="remote-toggle">{busy === 'start' ? 'Starting…' : 'Start'}</Button
				>
			{/if}
		</div>
	</header>

	<div class="divide-y">
		{#if view.reason && !pairing}
			<p
				class="px-4 py-3 text-sm break-words {view.state === 'stopped'
					? 'text-danger'
					: 'text-muted-foreground'}"
			>
				{view.reason}
			</p>
		{/if}
		{#if view.pairing?.error}
			<p class="px-4 py-3 text-sm break-words text-danger" role="alert">{view.pairing.error}</p>
		{/if}

		{#if pairing}
			<div class="space-y-3 px-4 py-4 text-sm" data-testid="pairing">
				<p class="font-medium">Pair this machine with {pairing.gateway}</p>
				<ol class="list-decimal space-y-1.5 pl-5">
					<li>
						On a device you trust, open
						<a
							class="break-all underline"
							href={pairing.verificationUri}
							target="_blank"
							rel="noreferrer noopener">{pairing.verificationUri}</a
						> yourself and sign in.
					</li>
					<li>
						Type this code there:
						<code class="tabular rounded bg-muted px-1.5 py-0.5 text-base" data-testid="pair-code"
							>{pairing.userCode}</code
						>
					</li>
					<li>
						Pick this machine’s fingerprint:
						<code class="tabular" data-testid="pair-fingerprint">{pairing.fingerprint}</code>
					</li>
				</ol>
				<p class="text-xs text-warning">
					Whoever approves this code can use this machine’s Wheelhouse from anywhere, terminals
					included, so they can run commands here. Type the code yourself, only at the address
					above, and approve only when the fingerprint matches. If someone asked you for the code,
					press Stop.
				</p>
				<p class="text-xs text-muted-foreground">
					Waiting for approval; the code works until {new Date(
						pairing.expiresAt
					).toLocaleTimeString()}. Remote access starts once it is approved.
				</p>
			</div>
		{/if}

		<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
			<p class="text-sm font-medium">Gateway</p>
			<div class="min-w-0 text-sm">
				{#if view.device || pairing}
					<p class="break-all" data-testid="gateway">{view.gateway}</p>
					{#if view.device}
						<p class="mt-1 text-xs text-muted-foreground">
							This machine is paired there. Revoke it to use another gateway.
						</p>
					{/if}
				{:else}
					<form
						class="flex flex-wrap items-center gap-2"
						onsubmit={(e) => {
							e.preventDefault();
							void act('gateway', { gateway: gatewayDraft ?? view.gateway });
						}}
					>
						<input
							type="url"
							class="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
							placeholder={DEFAULT_GATEWAY}
							aria-label="Gateway URL"
							value={gatewayDraft ?? view.gateway}
							oninput={(e) => (gatewayDraft = (e.currentTarget as HTMLInputElement).value)}
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={busy !== null || gatewayDraft === null}>Save</Button
						>
					</form>
					<p class="mt-1 text-xs text-muted-foreground">
						{view.gateway === DEFAULT_GATEWAY
							? 'The default gateway.'
							: `Your own gateway (the default is ${DEFAULT_GATEWAY}; clear the field to go back to it).`}
						Anyone can host a gateway: point this at yours.
					</p>
				{/if}
			</div>
		</div>

		<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
			<p class="text-sm font-medium">This machine</p>
			<div class="min-w-0 text-sm">
				{#if view.device}
					<p>
						<span class="font-medium">{view.device.name}</span>
						<span class="text-muted-foreground"
							>{view.device.user ? ` · approved by ${view.device.user}` : ''} · paired {new Date(
								view.device.pairedAt
							).toLocaleDateString()}</span
						>
					</p>
					<p class="mt-0.5 text-xs text-muted-foreground">
						Key fingerprint <code class="tabular" data-testid="fingerprint"
							>{view.device.fingerprint}</code
						>, kept in <code class="break-all">{view.keyStore}</code>, readable by your user only.
						It never leaves this machine.
					</p>
				{:else}
					<p class="text-muted-foreground">
						Not paired. Start pairs it first: it shows a code to type on the gateway and this
						machine’s fingerprint to pick there. (In a terminal, <code class="text-xs"
							>wheelhouse remote connect</code
						> does the same.)
					</p>
				{/if}
			</div>
		</div>

		{#if view.device}
			<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
				<p class="text-sm font-medium">Last seen</p>
				<div class="min-w-0 text-sm text-muted-foreground">
					<p data-testid="last-seen">
						{view.lastSeen
							? `The gateway was last heard from ${ago(view.lastSeen, now)}.`
							: 'Not connected yet.'}
					</p>
					{#if view.state === 'not-running'}
						<p class="mt-0.5 text-xs">
							Wheelhouse keeps the connection up while <code>wheelhouse open</code> runs; otherwise
							run <code>wheelhouse remote run</code>.
						</p>
					{:else if view.state === 'off'}
						<p class="mt-0.5 text-xs">
							Remote access is off: nothing reaches this machine until you press Start. Once
							started, it stays on, across restarts too, until you stop it.
						</p>
					{/if}
				</div>
			</div>

			<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
				<p class="text-sm font-medium">Sessions</p>
				<div class="min-w-0 text-sm">
					{#if view.sessions.length}
						<ul class="space-y-1">
							{#each view.sessions as s (s.id)}
								<li>
									<span class="font-medium">{s.user || 'Someone'}</span>
									<span class="text-muted-foreground"
										>· {s.requests} request{s.requests === 1 ? '' : 's'} · last {ago(s.lastAt, now)}
										· <code class="text-xs">{s.id.slice(0, 8)}</code></span
									>
								</li>
							{/each}
						</ul>
						<p class="mt-1 text-xs text-muted-foreground">
							Who has opened this machine through the gateway. Only counts are kept, never what was
							sent. Stop disconnects them all.
						</p>
					{:else}
						<p class="text-muted-foreground">No one has opened this machine through the cloud.</p>
					{/if}
				</div>
			</div>

			<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
				<p class="text-sm font-medium">Revoke</p>
				<div class="min-w-0 text-sm">
					{#if confirming}
						<p>
							Revoking removes this machine on the gateway and deletes its key here. To use it
							remotely again, Start pairs it again.
						</p>
						<div class="mt-2 flex flex-wrap gap-2">
							<Button
								variant="destructive"
								size="sm"
								disabled={busy !== null}
								onclick={() => act('disconnect')}
								data-testid="confirm-disconnect">Revoke this machine</Button
							>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy !== null}
								onclick={() => (confirming = false)}>Keep it</Button
							>
						</div>
					{:else}
						<Button
							variant="outline"
							size="sm"
							disabled={busy !== null}
							onclick={() => (confirming = true)}>Revoke…</Button
						>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if error}
		<p class="border-t px-4 py-3 text-sm text-danger" role="alert">{error}</p>
	{/if}
	{#if note}
		<p class="border-t px-4 py-3 text-sm text-warning" role="status">{note}</p>
	{/if}
</section>
