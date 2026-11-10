<script lang="ts">
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import type { CloudState, CloudView } from '$lib/cloud';
	import { ago } from '$lib/format';
	import { Button } from '$lib/components/ui/button';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/**
	 * Settings → Cloud: whether this machine can be reached through a Wheelhouse
	 * Cloud gateway, which relays the captain's browser to this Wheelhouse while
	 * Firstmate and the crew keep running here. Pairing happens in a terminal
	 * on this machine (`wheelhouse remote connect`), never on this page; here
	 * the captain sees the connection and the relay sessions, and can turn it
	 * off or disconnect the machine.
	 */
	let { data } = $props();

	let fresh = $state<CloudView | null>(null);
	const view = $derived(fresh ?? (data.view as CloudView));
	let error = $state('');
	let note = $state('');
	let busy = $state<string | null>(null);
	let confirming = $state(false);
	let gatewayDraft = $state<string | null>(null);
	let now = $state(Date.now());

	const STATE: Record<CloudState, { dot: string; label: string }> = {
		online: { dot: 'bg-success', label: 'Online' },
		connecting: { dot: 'bg-warning', label: 'Connecting' },
		'not-running': { dot: 'bg-muted-foreground', label: 'Not running' },
		'not-paired': { dot: 'bg-muted-foreground', label: 'Not paired' },
		off: { dot: 'bg-muted-foreground', label: 'Off' },
		stopped: { dot: 'bg-danger', label: 'Stopped' }
	};
	const st = $derived(STATE[view.state]);

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

	// Look again every few seconds, so a pairing made in the terminal and the connection show up.
	$effect(() => {
		const t = setInterval(read, view.state === 'online' ? 10_000 : 3000);
		return () => clearInterval(t);
	});
</script>

<svelte:head><title>Cloud · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Cloud</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Reach this Wheelhouse from any browser through a Wheelhouse Cloud gateway. Firstmate, its crew
			and this page keep running on this machine; the gateway only carries the connection, which
			this machine opens to it. It is off until you pair this machine.
		</p>

		{#if view.viaRelay}
			<p class="mt-4 max-w-prose rounded-md border border-brass/60 px-4 py-3 text-sm">
				You are looking at this page through the cloud. Turning it off or disconnecting ends this
				connection; you would need this machine to turn it on again.
			</p>
		{/if}

		<section class="mt-8 rounded-lg border bg-card" aria-labelledby="cloud-machine">
			<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
				<div class="min-w-0">
					<h2 id="cloud-machine" class="font-display text-lg font-semibold">This machine</h2>
					<p class="flex items-center gap-2 text-sm" data-state={view.state}>
						<span class="size-2 shrink-0 rounded-full {st.dot}" aria-hidden="true"></span>
						<span class="font-medium">{st.label}</span>
						{#if view.state === 'online' && view.since}
							<span class="truncate text-muted-foreground">since {ago(view.since, now)}</span>
						{/if}
					</p>
				</div>
				{#if view.device}
					<div class="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={busy !== null}
							onclick={() => act(view.enabled ? 'off' : 'on')}
							>{view.enabled ? 'Turn off' : 'Turn on'}</Button
						>
						{#if confirming}
							<Button
								variant="destructive"
								size="sm"
								disabled={busy !== null}
								onclick={() => act('disconnect')}
								data-testid="confirm-disconnect">Disconnect this machine</Button
							>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy !== null}
								onclick={() => (confirming = false)}>Keep it</Button
							>
						{:else}
							<Button
								variant="outline"
								size="sm"
								disabled={busy !== null}
								onclick={() => (confirming = true)}>Disconnect</Button
							>
						{/if}
					</div>
				{/if}
			</header>

			<div class="divide-y">
				{#if view.reason}
					<p
						class="px-4 py-3 text-sm break-words {view.state === 'stopped'
							? 'text-danger'
							: 'text-muted-foreground'}"
					>
						{view.reason}
					</p>
				{/if}
				{#if confirming}
					<p class="px-4 py-3 text-sm">
						Disconnecting revokes this machine on the gateway and deletes its key here. To use it
						from the cloud again, pair it again in a terminal.
					</p>
				{/if}

				<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
					<p class="text-sm font-medium">Gateway</p>
					<div class="min-w-0 text-sm">
						{#if view.device}
							<p class="break-all">{view.gateway}</p>
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
									placeholder="https://cloud.example.com"
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
								The gateway you have an account on. None is set until you name one.
							</p>
						{/if}
					</div>
				</div>

				<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
					<p class="text-sm font-medium">Pairing</p>
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
								>, kept in <code class="break-all">{view.keyStore}</code>, readable by your user
								only. It never leaves this machine.
							</p>
						{:else}
							<p class="text-muted-foreground">
								Not paired. In a terminal on this machine, run
								<code class="text-xs"
									>wheelhouse remote connect{view.gateway ? '' : ' --gateway <url>'}</code
								>. It shows a code to type on the gateway and this machine’s fingerprint to check
								there; whoever approves it can use this Wheelhouse, terminals included.
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
									Wheelhouse keeps the connection up while <code>wheelhouse open</code> runs;
									otherwise run <code>wheelhouse remote run</code>.
								</p>
							{/if}
						</div>
					</div>

					<div class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
						<p class="text-sm font-medium">Relay sessions</p>
						<div class="min-w-0 text-sm">
							{#if view.sessions.length}
								<ul class="space-y-1">
									{#each view.sessions as s (s.id)}
										<li>
											<span class="font-medium">{s.user || 'Someone'}</span>
											<span class="text-muted-foreground"
												>· {s.requests} request{s.requests === 1 ? '' : 's'} · last {ago(
													s.lastAt,
													now
												)} · <code class="text-xs">{s.id.slice(0, 8)}</code></span
											>
										</li>
									{/each}
								</ul>
								<p class="mt-1 text-xs text-muted-foreground">
									Who has opened this machine through the gateway. Only counts are kept, never what
									was sent.
								</p>
							{:else}
								<p class="text-muted-foreground">
									No one has opened this machine through the cloud.
								</p>
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
	</div>
</main>
