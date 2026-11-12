<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle, LoaderCircle, Puzzle, RefreshCw, Search } from '@lucide/svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import MarketplaceInstall from '$lib/components/wh/plugins/MarketplaceInstall.svelte';
	import SavedNote from '$lib/components/wh/plugins/SavedNote.svelte';
	import { live } from '$lib/client/live.svelte';
	import { lookUp, marketplace, pluginUpdates } from '$lib/client/plugins';
	import { ago } from '$lib/format';
	import {
		searchPlugins,
		type MarketplacePlugin,
		type MarketplaceView
	} from '$lib/plugins/marketplace';
	import type { PluginPreview } from '$lib/updates';

	/**
	 * Plugins: find plugins in the registries Wheelhouse reads (the official one
	 * unless `plugin-registries.json` names others) and install one from its row.
	 * Plugins already installed, or that come with Wheelhouse, are left out; they
	 * are managed on Settings → Plugins. **Install** looks the plugin up (fetches
	 * it and pins the exact commit) and shows the usual review; nothing is kept
	 * or run until **Install and restart**.
	 */

	let view = $state<MarketplaceView | null>(null);
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let query = $state('');
	const results = $derived(view ? searchPlugins(view.plugins, query) : []);
	const failed = $derived(view?.registries.filter((r) => r.error) ?? []);
	const unpublished = $derived(view?.registries.filter((r) => r.unpublished) ?? []);
	const skipped = $derived(view?.registries.filter((r) => !r.error && r.skipped.length) ?? []);
	const listed = $derived(view ? view.registries.reduce((n, r) => n + r.count, 0) : 0);

	async function load(refresh = false) {
		loading = true;
		const r = await marketplace(refresh);
		loading = false;
		if (!r.ok) {
			loadError = r.error;
			return;
		}
		loadError = null;
		view = r.value;
	}

	/** Each row's install: being looked up, or why it could not be. */
	let looking = $state<string | null>(null);
	let rowError = $state<Record<string, string>>({});
	let preview = $state<PluginPreview | null>(null);
	let busy = $state<string[]>([]);

	async function install(p: MarketplacePlugin) {
		if (looking) return;
		looking = p.name;
		delete rowError[p.name];
		const [r, u] = await Promise.all([
			lookUp({ repo: p.repository, ref: p.ref }, page.data.sessionToken as string),
			pluginUpdates()
		]);
		looking = null;
		if (!r.ok) {
			rowError[p.name] = r.error;
			return;
		}
		busy = u.ok ? u.value.busy : [];
		preview = r.value;
	}

	let note = $state<{ text: string; ok: boolean } | null>(null);
	let noteTimer: ReturnType<typeof setTimeout> | undefined;
	function installed(p: PluginPreview, back: boolean) {
		note = {
			text: back
				? `${p.name} is installed.`
				: `${p.name} is installed; Wheelhouse is taking a while to restart.`,
			ok: true
		};
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => (note = null), 5000);
	}

	let search: HTMLInputElement | undefined;
	onMount(() => {
		// The search has the keyboard, as in an editor's extensions view; not on a phone,
		// where it would open the keyboard over the list.
		if (window.matchMedia('(min-width: 768px)').matches) search?.focus();
		void load();
		// A restart (after an install) brings a new server with the plugin loaded: it leaves the list.
		const off = live.onRestart(() => void load());
		return () => {
			off();
			clearTimeout(noteTimer);
		};
	});

	let brokenIcons = $state<Record<string, boolean>>({});
	/** The registry a plugin comes from, by its own name once read. */
	const registryName = (p: MarketplacePlugin) =>
		view?.registries.find((r) => r.source === p.registry)?.name ?? p.registry;
</script>

<svelte:head><title>Plugins · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<h1 class="text-2xl">Plugins</h1>
			<div class="flex flex-wrap items-center gap-2">
				{#if view?.fetchedAt}
					<span class="hidden text-xs text-muted-foreground sm:inline"
						>Read {ago(view.fetchedAt, live.now)}</span
					>
				{/if}
				<Button variant="ghost" size="sm" onclick={() => load(true)} disabled={loading}
					><RefreshCw class={loading ? 'animate-spin' : ''} />Refresh</Button
				>
				<Button variant="outline" size="sm" href="/settings/plugins">Installed plugins</Button>
			</div>
		</div>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Find plugins in Wheelhouse’s registries and install one from its row. Installing shows you
			what it is first, then restarts Wheelhouse to load it; Firstmate and its crew keep running.
		</p>

		<label
			class="mt-6 flex items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring"
		>
			<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<input
				type="search"
				bind:this={search}
				bind:value={query}
				aria-label="Search plugins"
				placeholder="Search plugins…"
				autocomplete="off"
				spellcheck="false"
				class="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground max-md:h-12 max-md:text-base"
			/>
		</label>

		{#if loadError}
			<p
				class="mt-4 flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 size-4 shrink-0" />Wheelhouse could not read the registries: {loadError}
			</p>
		{/if}
		{#if view?.config.error}
			<p
				class="mt-4 flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
				role="alert"
			>
				<AlertTriangle class="mt-0.5 size-4 shrink-0" /><span class="min-w-0 break-words"
					><code class="font-mono text-xs break-all">{view.config.file}</code>
					{view.config.error} Showing the official registry meanwhile.</span
				>
			</p>
		{/if}
		{#each failed as r (r.url)}
			<p
				class="mt-4 flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-sm text-danger"
				role="alert"
				data-registry-error={r.source}
			>
				<AlertTriangle class="mt-0.5 size-4 shrink-0" /><span class="min-w-0 break-words"
					>The {r.official ? 'official ' : ''}registry
					<a
						class="font-mono text-xs break-all underline"
						href={r.url}
						target="_blank"
						rel="noreferrer">{r.source}</a
					>
					could not be read. {r.error}</span
				>
			</p>
		{/each}
		{#each unpublished as r (r.url)}
			<p
				class="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground"
				data-registry-unpublished={r.source}
			>
				The official plugin registry
				<a
					class="font-mono text-xs break-all underline"
					href={r.url}
					target="_blank"
					rel="noreferrer">{r.source}</a
				>
				has not been published yet.
			</p>
		{/each}
		{#if skipped.length}
			<details class="mt-3 text-xs text-muted-foreground">
				<summary class="cursor-pointer">
					{skipped.reduce((n, r) => n + r.skipped.length, 0)} registry
					{skipped.reduce((n, r) => n + r.skipped.length, 0) === 1 ? 'entry was' : 'entries were'} left
					out
				</summary>
				<ul class="mt-1 grid gap-0.5">
					{#each skipped as r (r.url)}
						{#each r.skipped as s (s.index)}
							<li>
								<span class="font-mono break-all">{r.source}</span>, entry {s.index + 1}{s.name
									? ` (${s.name})`
									: ''}: {s.reason}
							</li>
						{/each}
					{/each}
				</ul>
			</details>
		{/if}

		{#if !view && loading}
			<p class="mt-8 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
				<LoaderCircle class="size-4 animate-spin" />Reading the registries…
			</p>
		{:else if view}
			{#if results.length}
				<ul class="mt-6 divide-y rounded-lg border bg-card" aria-label="Plugins to install">
					{#each results as p (p.name)}
						<li class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3" data-plugin={p.name}>
							<span
								class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/50"
								aria-hidden="true"
							>
								{#if p.icon && !brokenIcons[p.name]}
									<img
										src={p.icon}
										alt=""
										class="size-8 object-contain"
										loading="lazy"
										onerror={() => (brokenIcons[p.name] = true)}
									/>
								{:else}
									<Puzzle class="size-5 text-muted-foreground" strokeWidth={1.75} />
								{/if}
							</span>
							<div class="min-w-0 flex-1 basis-48">
								<p class="text-sm font-medium">
									{p.displayName}
									{#if p.displayName !== p.name}<span
											class="font-mono text-xs font-normal text-muted-foreground">{p.name}</span
										>{/if}
								</p>
								<p class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
								<p class="mt-1 text-xs text-muted-foreground">
									<a
										class="font-mono hover:text-foreground hover:underline"
										href="https://github.com/{p.repository}"
										target="_blank"
										rel="noreferrer">{p.repository}</a
									>{p.ref ? ` · ${p.ref}` : ''}{p.author ? ` · ${p.author}` : ''}{view.registries
										.length > 1
										? ` · from ${registryName(p)}`
										: ''}
								</p>
								{#if rowError[p.name]}
									<p
										class="mt-2 flex items-start gap-1.5 text-xs break-words text-danger"
										role="alert"
									>
										<AlertTriangle class="mt-0.5 size-3.5 shrink-0" />{rowError[p.name]}
									</p>
								{/if}
							</div>
							<Button
								size="sm"
								class="shrink-0"
								onclick={() => install(p)}
								disabled={looking !== null}
								aria-label="Install {p.displayName}"
							>
								{#if looking === p.name}<LoaderCircle
										class="animate-spin"
									/>Fetching…{:else}Install{/if}
							</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
					{#if query.trim() && view.plugins.length}
						No plugins match “{query.trim()}”.
					{:else if listed && !view.plugins.length}
						Every plugin in the registries is installed already.
					{:else if unpublished.length && failed.length + unpublished.length === view.registries.length}
						There are no plugins to show yet.
					{:else if failed.length === view.registries.length && view.registries.length}
						No registry could be read, so there is nothing to show.
					{:else if !view.registries.length}
						No registries are configured. Add one to <code class="font-mono text-xs"
							>{view.config.file}</code
						>.
					{:else}
						The registries list no plugins yet.
					{/if}
				</p>
			{/if}
			{#if view.installed}
				<p class="mt-3 text-xs text-muted-foreground">
					{view.installed}
					{view.installed === 1 ? 'plugin is' : 'plugins are'} not shown because
					{view.installed === 1 ? 'it is' : 'they are'} installed; manage
					{view.installed === 1 ? 'it' : 'them'} in
					<a class="text-sea hover:underline" href="/settings/plugins">Settings → Plugins</a>.
				</p>
			{/if}
		{/if}
	</div>
</main>

<MarketplaceInstall {preview} {busy} onclose={() => (preview = null)} oninstalled={installed} />
<SavedNote {note} />
