<script lang="ts">
	import { page } from '$app/state';
	import { ALERT_KINDS } from '$lib/bell';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { clock } from '$lib/format';
	import type { GatewayChannelView, GatewayState, GatewayView } from '$lib/gateway';
	import type { AlertKind } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';

	/**
	 * Settings → Gateway: the chat channels that reach Firstmate from the
	 * captain's phone. Pairing shows a one-time code here, and only here; the
	 * bot token is set in a terminal (`wheelhouse gateway connect`), never on
	 * this page.
	 */
	let { data } = $props();

	let fresh = $state<GatewayView | null>(null);
	const view = $derived(fresh ?? (data.view as GatewayView));
	let codes = $state<Record<string, { code: string; expiresAt: string }>>({});
	let errors = $state<Record<string, string>>({});
	let busy = $state<string | null>(null);

	const GUIDE =
		'https://github.com/chrisjowen/wheelhouse/blob/main/docs/guide.md#the-messaging-gateway';

	const STATE: Record<GatewayState, { dot: string; label: string }> = {
		connected: { dot: 'bg-success', label: 'Connected' },
		connecting: { dot: 'bg-warning', label: 'Connecting' },
		'no-token': { dot: 'bg-muted-foreground', label: 'No bot token' },
		off: { dot: 'bg-muted-foreground', label: 'Off' },
		down: { dot: 'bg-danger', label: 'Stopped' }
	};

	async function read() {
		try {
			const r = await fetch('/api/gateway');
			if (r.ok) fresh = (await r.json()) as GatewayView;
		} catch {
			// keep the last view; the next look may work
		}
	}

	async function act(channel: string, action: string, extra: Record<string, unknown> = {}) {
		busy = `${channel}:${action}`;
		errors = { ...errors, [channel]: '' };
		try {
			const r = await fetch('/api/gateway', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ channel, action, ...extra })
			});
			const body = (await r.json().catch(() => null)) as {
				message?: string;
				view?: GatewayView;
				pairing?: { code: string; expiresAt: string } | null;
			} | null;
			if (!r.ok) {
				errors = {
					...errors,
					[channel]: body?.message ?? `Wheelhouse could not do that (${r.status}).`
				};
				return;
			}
			if (body?.view) fresh = body.view;
			const { [channel]: _, ...rest } = codes;
			void _;
			codes = body?.pairing ? { ...rest, [channel]: body.pairing } : rest;
		} catch {
			errors = { ...errors, [channel]: 'Wheelhouse could not be reached. Try again.' };
		} finally {
			busy = null;
		}
	}

	function toggleAlert(c: GatewayChannelView, kind: AlertKind, on: boolean) {
		const next = on ? [...c.alerts, kind] : c.alerts.filter((k) => k !== kind);
		void act(c.channel, 'alerts', { alerts: next });
	}

	// Until a channel is connected (a token set in the terminal shows up here), and while a
	// pairing waits for its code, look again every few seconds.
	const watching = $derived(view.channels.some((c) => c.pairing || c.state !== 'connected'));
	$effect(() => {
		if (!watching) return;
		const t = setInterval(read, 2500);
		return () => clearInterval(t);
	});
</script>

<svelte:head><title>Gateway · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Gateway</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Reach Firstmate from your phone. What you send the bot reaches Firstmate the way this page’s
			messages do; its answers, the ship’s bell and open decisions come back to you, with buttons.
			Only the account you pair is heard; everyone else is ignored.
		</p>

		{#if !view.available}
			<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{view.reason}
			</p>
		{:else}
			{#each view.channels as c (c.channel)}
				{@const st = STATE[c.state]}
				{@const code = c.pairing ? codes[c.channel] : undefined}
				<section class="mt-8 rounded-lg border bg-card" aria-labelledby="gw-{c.channel}">
					<header class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
						<div class="min-w-0">
							<h2 id="gw-{c.channel}" class="font-display text-lg font-semibold">{c.label}</h2>
							<p class="flex items-center gap-2 text-sm" data-state={c.state}>
								<span class="size-2 shrink-0 rounded-full {st.dot}" aria-hidden="true"></span>
								<span class="font-medium">{st.label}</span>
								{#if c.state === 'connected' && c.bot}
									<span class="truncate text-muted-foreground">as {c.bot.name}</span>
								{/if}
							</p>
						</div>
						{#if c.token}
							<Button
								variant="outline"
								size="sm"
								disabled={busy !== null}
								onclick={() => act(c.channel, c.enabled ? 'off' : 'on')}
								>{c.enabled ? 'Turn off' : 'Turn on'}</Button
							>
						{/if}
					</header>

					<div class="divide-y">
						{#if c.reason && c.state !== 'connected'}
							<p
								class="px-4 py-3 text-sm break-words {c.state === 'down'
									? 'text-danger'
									: 'text-muted-foreground'}"
							>
								{c.reason}
							</p>
						{/if}

						<div
							class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
						>
							<p class="text-sm font-medium">Bot token</p>
							<div class="min-w-0 text-sm text-muted-foreground">
								{#if c.token}
									<p>
										Set, in <code class="text-xs break-all">{c.tokenStore}</code>, readable by your
										user only. Replace it with
										<code class="text-xs">wheelhouse gateway connect {c.channel}</code>.
									</p>
								{:else}
									<p>
										Create the bot (see <a
											class="text-sea hover:underline"
											href={GUIDE}
											target="_blank"
											rel="noreferrer">setting up {c.label}</a
										>), then run <code class="text-xs">wheelhouse gateway connect {c.channel}</code> in
										a terminal. It asks for the token there; it is never typed into this page.
									</p>
								{/if}
							</div>
						</div>

						<div
							class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
						>
							<p class="text-sm font-medium">Paired account</p>
							<div class="min-w-0 text-sm">
								{#if c.paired}
									<p>
										<span class="font-medium">{c.paired.name}</span>
										<span class="text-muted-foreground">
											· {c.label} id {c.paired.id} · paired {new Date(
												c.paired.at
											).toLocaleDateString()}</span
										>
									</p>
									<p class="mt-0.5 text-xs text-muted-foreground">
										Only this account’s direct messages reach Firstmate.
									</p>
								{:else}
									<p class="text-muted-foreground">
										Not paired: no one’s messages reach Firstmate.
									</p>
								{/if}

								{#if c.pairing && code}
									<div
										class="mt-3 rounded-md border border-brass/60 bg-background px-4 py-3"
										aria-live="polite"
									>
										<p class="text-xs text-muted-foreground">
											Send this code to the bot in a direct message
										</p>
										<p
											class="tabular mt-1 font-mono text-2xl font-semibold tracking-[0.2em]"
											data-testid="pairing-code"
										>
											{code.code}
										</p>
										<p class="mt-1 text-xs text-muted-foreground">
											It works once, until {clock(code.expiresAt)}. The account that sends it
											becomes the paired one{c.paired ? `, in place of ${c.paired.name}` : ''}.
										</p>
									</div>
								{:else if c.pairing}
									<p class="mt-2 text-xs text-muted-foreground">
										A pairing is waiting for its code until {clock(c.pairing.expiresAt)}; the code
										was shown where it was started. Start again for a new one.
									</p>
								{/if}
								{#if c.pairingNote && !c.pairing}
									<p class="mt-2 text-xs text-muted-foreground">{c.pairingNote}</p>
								{/if}

								<div class="mt-3 flex flex-wrap gap-2">
									{#if c.pairing}
										<Button
											variant="outline"
											size="sm"
											disabled={busy !== null}
											onclick={() => act(c.channel, 'cancel-pairing')}>Cancel pairing</Button
										>
									{/if}
									<Button
										variant={c.paired ? 'outline' : 'default'}
										size="sm"
										disabled={busy !== null || c.state !== 'connected'}
										onclick={() => act(c.channel, 'pair')}
										>{c.pairing
											? 'New code'
											: c.paired
												? 'Pair another account'
												: 'Pair an account'}</Button
									>
									{#if c.paired}
										<Button
											variant="outline"
											size="sm"
											disabled={busy !== null}
											onclick={() => act(c.channel, 'unbind')}>Unbind</Button
										>
									{/if}
								</div>
							</div>
						</div>

						<fieldset
							class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
						>
							<legend class="sr-only">Alerts sent to {c.label}</legend>
							<p class="text-sm font-medium" aria-hidden="true">Alerts sent</p>
							<div class="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
								{#each ALERT_KINDS as k (k.kind)}
									<label class="flex items-start gap-2 text-sm">
										<input
											type="checkbox"
											class="mt-0.5 size-4 accent-[var(--sea)]"
											checked={c.alerts.includes(k.kind)}
											disabled={busy !== null}
											onchange={(e) =>
												toggleAlert(c, k.kind, (e.currentTarget as HTMLInputElement).checked)}
										/>
										<span
											>{k.label}<span class="block text-xs text-muted-foreground">{k.hint}</span
											></span
										>
									</label>
								{/each}
								<label class="flex items-start gap-2 text-sm sm:col-span-2">
									<input
										type="checkbox"
										class="mt-0.5 size-4 accent-[var(--sea)]"
										checked={c.titlesOnly}
										disabled={busy !== null}
										onchange={(e) =>
											act(c.channel, 'titles-only', {
												titlesOnly: (e.currentTarget as HTMLInputElement).checked
											})}
									/>
									<span
										>Titles only<span class="block text-xs text-muted-foreground"
											>Alerts and decisions say only what happened and to which task, without their
											text, question or recommendation.</span
										></span
									>
								</label>
							</div>
						</fieldset>
					</div>

					{#if errors[c.channel]}
						<p class="border-t px-4 py-3 text-sm text-danger" role="alert">{errors[c.channel]}</p>
					{/if}
				</section>
			{/each}

			<p class="mt-6 max-w-prose text-xs leading-relaxed text-muted-foreground">
				The gateway runs inside Wheelhouse, so it works only while Wheelhouse runs: for use away
				from the keyboard, keep it running (for example <code>wheelhouse open --no-browser</code> in tmux)
				and the Mac awake. Each message tells Firstmate it came from your phone, and nothing from a chat
				types into Firstmate’s session or answers its prompts.
			</p>
		{/if}
	</div>
</main>
