<script lang="ts">
	import { page } from '$app/state';
	import { AlertTriangle, LoaderCircle, Plus, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { live } from '$lib/client/live.svelte';
	import { addRegistry, removeRegistry } from '$lib/client/plugins';
	import { ago } from '$lib/format';
	import type { MarketplaceView } from '$lib/plugins/marketplace';

	/**
	 * The Plugins page's sources: each registry Wheelhouse reads, in order (the
	 * official one first unless the configuration says otherwise), when its clone
	 * was last brought up to date and why the last try failed, with **Remove**
	 * on each but the official one; and a field to add another by `org/repo` or its GitHub address. A change is
	 * kept in `plugin-registries.json`, and `onchange` gets the marketplace as it
	 * then stands.
	 */
	let {
		view,
		onchange
	}: {
		view: MarketplaceView;
		onchange: (v: MarketplaceView) => void;
	} = $props();

	let adding = $state('');
	let pending = $state<string | null>(null);
	let error = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	const token = () => page.data.sessionToken as string;

	async function add(e: Event) {
		e.preventDefault();
		if (!adding.trim() || pending) return;
		pending = 'add';
		error = null;
		const r = await addRegistry(adding.trim(), token());
		pending = null;
		if (!r.ok) {
			error = r.error;
			return;
		}
		adding = '';
		onchange(r.value);
	}

	async function remove(id: string) {
		if (pending) return;
		pending = id;
		error = null;
		const r = await removeRegistry(id, token());
		pending = null;
		confirming = null;
		if (!r.ok) {
			error = r.error;
			return;
		}
		onchange(r.value);
	}
</script>

<section class="mt-3 rounded-lg border px-4 py-3 text-sm" aria-label="Plugin sources">
	{#if view.registries.length}
		<ul class="divide-y">
			{#each view.registries as r (r.id)}
				<li class="flex flex-wrap items-start gap-x-3 gap-y-1 py-2" data-registry={r.source}>
					<div class="min-w-0 flex-1 basis-56">
						<p class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-medium">{r.name ?? r.source}</span>
							{#if r.official}<span
									class="rounded-sm border px-1 text-[0.6875rem] text-muted-foreground"
									>Official</span
								>{/if}
							<a
								class="font-mono text-xs break-all text-muted-foreground hover:text-foreground hover:underline"
								href={r.url}
								target="_blank"
								rel="noreferrer">{r.source}</a
							>
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground" data-registry-synced>
							{r.syncedAt ? `Synced ${ago(r.syncedAt, live.now)}` : 'Not synced yet'}{!r.error &&
							!r.unpublished
								? ` · ${r.count} ${r.count === 1 ? 'plugin' : 'plugins'}`
								: ''}{#if r.syncing}<span
									class="ml-1 inline-flex items-center gap-1"
									data-registry-syncing>· <LoaderCircle class="size-3 animate-spin" />Syncing…</span
								>{/if}
						</p>
						{#if r.syncError && !r.error && !r.unpublished}
							<p
								class="mt-0.5 flex items-start gap-1.5 text-xs break-words text-danger"
								data-registry-sync-error
							>
								<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />Could not resync: {r.syncError} Showing
								the copy from {r.syncedAt ? ago(r.syncedAt, live.now) : 'before'}.
							</p>
						{/if}
					</div>
					{#if confirming === r.id}
						<span class="flex shrink-0 items-center gap-1">
							<Button
								size="sm"
								variant="destructive"
								onclick={() => remove(r.id)}
								disabled={pending !== null}
								>{#if pending === r.id}<LoaderCircle class="animate-spin" />{/if}Remove</Button
							>
							<Button size="sm" variant="ghost" onclick={() => (confirming = null)}>Keep</Button>
						</span>
					{:else if !r.official}
						<Button
							size="sm"
							variant="ghost"
							class="shrink-0"
							onclick={() => (confirming = r.id)}
							disabled={pending !== null}
							aria-label="Remove {r.source}"><X />Remove</Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-2 text-muted-foreground">No registries are configured.</p>
	{/if}

	<form class="mt-2 flex flex-wrap items-center gap-2 border-t pt-3" onsubmit={add}>
		<input
			type="text"
			bind:value={adding}
			aria-label="GitHub repository of a registry"
			placeholder="org/repo or https://github.com/org/repo"
			autocomplete="off"
			spellcheck="false"
			class="h-9 min-w-0 flex-1 basis-56 rounded-md border border-input bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:text-base"
		/>
		<Button type="submit" size="sm" variant="outline" disabled={!adding.trim() || pending !== null}
			>{#if pending === 'add'}<LoaderCircle class="animate-spin" />Cloning…{:else}<Plus />Add
				registry{/if}</Button
		>
	</form>
	{#if error}
		<p class="mt-2 flex items-start gap-1.5 text-xs break-words text-danger" role="alert">
			<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{error}
		</p>
	{/if}
	<p class="mt-2 text-xs text-muted-foreground">
		A registry is a GitHub repository with a <code class="font-mono">wheelhouse-registry.json</code>
		(see
		<a
			class="text-sea hover:underline"
			href="https://github.com/chrisjowen/wheelhouse/blob/main/docs/plugin-registry.md"
			target="_blank"
			rel="noreferrer">Plugin registries</a
		>). Wheelhouse keeps a copy of each and resyncs it hourly when you open this page.
	</p>
</section>
