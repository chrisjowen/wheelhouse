<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw } from '@lucide/svelte';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';
	import InstallPlugin from '$lib/components/wh/plugins/InstallPlugin.svelte';
	import InstallFromGitHub from '$lib/components/wh/plugins/InstallFromGitHub.svelte';
	import PluginUpdate from '$lib/components/wh/plugins/PluginUpdate.svelte';
	import { Button } from '$lib/components/ui/button';
	import { live } from '$lib/client/live.svelte';
	import { checkPluginUpdates, pluginUpdates, type PluginsUpdates } from '$lib/client/plugins';
	import { ago } from '$lib/format';
	import type { PluginStatus } from '$lib/plugins/types';

	/**
	 * Every plugin this Wheelhouse knows: compiled in or installed from GitHub,
	 * whether it loaded and, when it did not, why; whether each installed one has
	 * something newer, with its update; and installing another from GitHub.
	 */
	let { data } = $props();

	let updates = $state<PluginsUpdates | null>(null);
	let checking = $state(false);
	let checkError = $state<string | null>(null);
	const updateFor = (id: string) => updates?.plugins.find((u) => u.id === id) ?? null;

	let shown = true;
	async function load() {
		const r = await pluginUpdates();
		if (!shown) return;
		if (r.ok) updates = r.value;
		// The server checks in the background when its last check is old: ask again shortly.
		if (r.ok && r.value.checking) setTimeout(load, 1500);
	}
	async function checkNow() {
		checking = true;
		checkError = null;
		const r = await checkPluginUpdates(data.sessionToken);
		if (r.ok) updates = r.value;
		else checkError = r.error;
		checking = false;
	}
	onMount(() => {
		void load();
		// A restart (after a plugin change) brings a new server with its own check.
		const off = live.onRestart(() => void load());
		return () => {
			shown = false;
			off();
		};
	});

	const STATE: Record<PluginStatus['state'], { label: string; tone: string }> = {
		loaded: { label: 'Loaded', tone: 'text-success' },
		disabled: { label: 'Off', tone: 'text-muted-foreground' },
		refused: { label: 'Refused', tone: 'text-danger' },
		failed: { label: 'Failed', tone: 'text-danger' }
	};
	const defaultOn = (p: PluginStatus) =>
		p.enabledWhenHomeFile
			? `while the Firstmate home has ${p.enabledWhenHomeFile}`
			: p.enabledWhenFile
				? `for projects with ${p.enabledWhenFile}`
				: p.enabledByDefault
					? 'for every project'
					: 'only where the plugins file turns it on';
	const github = (repo: string, commit: string | null) =>
		`https://github.com/${repo}${commit ? `/tree/${commit}` : ''}`;
</script>

<svelte:head><title>Plugins · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<InsightsNav />
		<div class="mt-6 flex flex-wrap items-end justify-between gap-3">
			<h1 class="text-2xl">Plugins</h1>
			<div class="flex flex-wrap items-center gap-2">
				{#if updates?.checkedAt}
					<span class="hidden text-xs text-muted-foreground sm:inline"
						>Checked {ago(updates.checkedAt, live.now)}</span
					>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					onclick={checkNow}
					disabled={checking || updates?.checking}
					><RefreshCw class={checking || updates?.checking ? 'animate-spin' : ''} />Check for
					updates</Button
				>
				<InstallFromGitHub busy={updates?.busy ?? []} />
			</div>
		</div>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Plugins compiled into Wheelhouse and those installed from GitHub. Installing or updating one
			here restarts Wheelhouse to load it; Firstmate and its crew keep running.
		</p>
		{#if checkError || updates?.error}
			<p class="mt-3 text-xs text-danger" role="alert">{checkError ?? updates?.error}</p>
		{/if}

		{#if data.view.installed.error}
			<p class="mt-6 rounded-lg border border-danger/40 p-4 text-sm text-danger">
				Installed plugins could not be read: {data.view.installed.error}
			</p>
		{/if}
		{#if data.view.config.error}
			<p class="mt-6 rounded-lg border border-danger/40 p-4 text-sm text-danger">
				The plugins file could not be used, so every plugin keeps its default: {data.view.config
					.error}
			</p>
		{/if}

		{#each data.view.suggested as s (s.id)}
			<div class="mt-6"><InstallPlugin plugin={s} /></div>
		{/each}

		{#if data.view.plugins.length === 0}
			<p class="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				No plugins.
			</p>
		{:else}
			<ul class="mt-8 divide-y rounded-lg border bg-card" aria-label="Plugins">
				{#each data.view.plugins as p, i (`${p.id}-${i}`)}
					<li
						class="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-center"
					>
						<div class="min-w-0">
							<p class="text-sm font-medium">
								{p.name}
								<span class="font-normal text-muted-foreground">{p.version}</span>
							</p>
							<p class="text-xs text-muted-foreground">
								{#if p.source === 'installed' && p.repository}
									<a
										href={github(p.repository, p.commit)}
										target="_blank"
										rel="noreferrer"
										class="hover:underline">{p.repository}</a
									>{p.commit ? ` @ ${p.commit.slice(0, 7)}` : ''}
								{:else}
									Built in
								{/if}
							</p>
						</div>
						<div class="min-w-0 text-sm">
							<p>
								<span class="font-medium {STATE[p.state].tone}" data-state={p.state}
									>{STATE[p.state].label}</span
								>{#if p.state === 'loaded'}<span class="text-muted-foreground"
										>{` · on by default ${defaultOn(p)}`}{p.slots.length
											? ` · ${p.slots.join(', ')}`
											: ''}</span
									>{/if}
							</p>
							{#if p.reason}
								<p class="mt-0.5 text-xs break-words text-muted-foreground">{p.reason}</p>
							{:else if p.state === 'disabled'}
								<p class="mt-0.5 text-xs text-muted-foreground">
									Turned off. <code>wheelhouse plugin enable {p.id}</code> turns it on (restarting Wheelhouse
									to load it).
								</p>
							{/if}
						</div>
						{#if p.source === 'installed' && updateFor(p.id)}
							<PluginUpdate
								update={updateFor(p.id)!}
								name={p.name}
								checking={checking || !!updates?.checking}
								busy={updates?.busy ?? []}
							/>
						{:else}
							<span class="hidden sm:block"></span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="mt-6 text-xs leading-relaxed text-muted-foreground">
				Which projects a plugin is on for is set in {data.view.config.file ?? 'the plugins file'}.
				{#if data.view.installed.dir}Installed plugins live in {data.view.installed.dir}.{/if}
			</p>
		{/if}
	</div>
</main>
