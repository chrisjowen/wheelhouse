<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { CircleCheck } from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { QuotaKeysView } from '$lib/quota-keys';

	/**
	 * Settings → Headroom: which vault secret holds each provider's API key for
	 * quota-axi. Wheelhouse reads the value only to hand it to the quota-axi run
	 * Headroom makes, under the variable that provider expects; the page and the
	 * saved mapping hold names, never a key.
	 */
	let { data } = $props();

	let view = $state<QuotaKeysView>(untrack(() => data.keys));
	let busy = $state(false);
	let problem = $state('');
	let saved = $state('');

	const token = $derived(page.data.sessionToken as string);

	async function choose(provider: string, secret: string) {
		busy = true;
		problem = '';
		saved = '';
		const mapping: Record<string, string> = {};
		for (const p of view.providers) if (p.secret) mapping[p.id] = p.secret;
		if (secret) mapping[provider] = secret;
		else delete mapping[provider];
		try {
			const r = await fetch('/api/quota-keys', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify(mapping)
			});
			if (!r.ok)
				throw new Error(
					((await r.json().catch(() => null)) as { message?: string } | null)?.message ??
						'Could not save this setting.'
				);
			view = (await r.json()) as QuotaKeysView;
			saved = 'Saved. Headroom uses it on its next reading, within a minute or two.';
		} catch (error) {
			problem = (error as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Headroom · Settings · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Headroom</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Some providers report their credit to quota-axi only with an API key. If you keep that key in
			the vault, pick its secret here: Headroom gives the key to quota-axi under the name it
			expects, for that run only. Wheelhouse never saves, logs or shows the key itself.
		</p>

		<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">
			Provider keys
		</h2>
		<ul class="mt-3 divide-y rounded-lg border">
			{#each view.providers as p (p.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 p-4">
					<div class="min-w-0">
						<p class="font-medium">{p.label}</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							quota-axi reads <code>{p.env}</code>
						</p>
					</div>
					<div class="flex min-w-0 flex-wrap items-center gap-3 text-sm">
						{#if p.secret && p.inVault}
							<span class="inline-flex items-center gap-1.5 text-success"
								><CircleCheck class="size-4" aria-hidden="true" />In the vault</span
							>
						{:else if p.secret}
							<span class="text-warning">The vault has no {p.secret}</span>
						{/if}
						<label class="flex items-center gap-2">
							<span class="sr-only">Vault secret for {p.label}</span>
							<select
								class="max-w-56 min-w-0 rounded-md border bg-card px-2 py-1.5"
								value={p.secret ?? ''}
								disabled={busy}
								onchange={(e) => choose(p.id, e.currentTarget.value)}
							>
								<option value="">Not mapped</option>
								{#if p.secret && !view.vaultNames.includes(p.secret)}
									<option value={p.secret}>{p.secret}</option>
								{/if}
								{#each view.vaultNames as name (name)}<option value={name}>{name}</option>{/each}
							</select>
						</label>
					</div>
				</li>
			{/each}
		</ul>
		{#if view.vaultNames.length === 0}
			<p class="mt-3 text-sm text-muted-foreground">
				The vault holds no secrets yet. Add a provider’s key on the Vault page, then pick it here.
			</p>
		{/if}
		{#if saved}<p class="mt-4 text-sm text-muted-foreground" role="status">{saved}</p>{/if}
		{#if problem}<p class="mt-4 text-sm text-danger" role="alert">{problem}</p>{/if}
	</div>
</main>
