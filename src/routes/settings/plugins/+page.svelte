<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { ChevronRight, RefreshCw } from '@lucide/svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import InstallPlugin from '$lib/components/wh/plugins/InstallPlugin.svelte';
	import InstallFromGitHub from '$lib/components/wh/plugins/InstallFromGitHub.svelte';
	import PluginUpdate from '$lib/components/wh/plugins/PluginUpdate.svelte';
	import SavedNote from '$lib/components/wh/plugins/SavedNote.svelte';
	import EveryProjectSwitch from '$lib/components/wh/plugins/EveryProjectSwitch.svelte';
	import { Button } from '$lib/components/ui/button';
	import { live } from '$lib/client/live.svelte';
	import {
		changePlugin,
		checkPluginUpdates,
		pluginUpdates,
		type PluginsUpdates
	} from '$lib/client/plugins';
	import { ago } from '$lib/format';
	import { backToDefaultWords, whereOnWords } from '$lib/plugins/words';
	import type { PluginPageView, PluginStatus } from '$lib/plugins/types';

	/**
	 * Settings → Plugins: every plugin this Wheelhouse knows, compiled in,
	 * bundled or installed from GitHub, each with a switch that turns it on or
	 * off for every project, and a page of its own for its projects and
	 * settings. Installed ones say when something newer is out, with its
	 * update; another installs from GitHub.
	 */
	let { data } = $props();

	let fresh = $state<Record<string, PluginPageView>>({});
	const pageFor = (id: string): PluginPageView | undefined => fresh[id] ?? data.pages[id];
	let saving = $state<string | null>(null);
	let note = $state<{ text: string; ok: boolean } | null>(null);
	let noteTimer: ReturnType<typeof setTimeout> | undefined;
	function say(text: string, ok = true) {
		note = { text, ok };
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => (note = null), ok ? 4000 : 8000);
	}

	async function turn(p: PluginStatus, on: boolean | null) {
		saving = p.id;
		const r = await changePlugin(p.id, { enabled: on }, page.data.sessionToken as string);
		saving = null;
		if (!r.ok) return say(r.error, false);
		fresh[p.id] = r.value;
		say(
			`${on === null ? backToDefaultWords(r.value) : `${p.name} is ${on ? 'on' : 'off'} for every project.`} It applies now, with no restart.`
		);
	}

	let updates = $state<PluginsUpdates | null>(null);
	let checking = $state(false);
	let checkError = $state<string | null>(null);
	const updateFor = (id: string) => updates?.plugins.find((u) => u.id === id) ?? null;
	let shown = true;
	async function load() {
		const r = await pluginUpdates();
		if (!shown || !r.ok) return;
		// A restarted server has not checked yet: keep showing what this page knew (an
		// update dialog open on a row stays open) until its own check arrives.
		updates =
			r.value.checkedAt === null && updates
				? { ...updates, checking: r.value.checking, busy: r.value.busy }
				: r.value;
		// The server checks in the background when its last check is old: ask again shortly.
		if (r.value.checking) setTimeout(load, 1500);
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
		// A restart (after a plugin change) brings a new server with its own plugins and check.
		const off = live.onRestart(() => {
			fresh = {};
			void invalidateAll();
			void load();
		});
		return () => {
			shown = false;
			off();
			clearTimeout(noteTimer);
		};
	});

	const configurable = (p: PluginStatus) =>
		(p.state === 'loaded' || p.state === 'disabled') && !!pageFor(p.id);
</script>

<svelte:head><title>Plugins · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
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
			Turn a plugin on or off here; open one to choose its projects and change its settings. Those
			apply straight away. Installing or updating a plugin restarts Wheelhouse to load it; Firstmate
			and its crew keep running.
		</p>
		{#if checkError || updates?.error}
			<p class="mt-3 text-xs text-danger" role="alert">{checkError ?? updates?.error}</p>
		{/if}

		{#if data.view.installed.error}
			<p class="mt-6 rounded-lg border border-danger/40 p-4 text-sm text-danger">
				Wheelhouse could not read which plugins are installed, so none of them loaded.
			</p>
		{/if}
		{#if data.view.config.error}
			<p class="mt-6 rounded-lg border border-danger/40 p-4 text-sm text-danger">
				Wheelhouse’s plugins file is not valid, so every plugin keeps its default and nothing can be
				changed here until it is fixed.
			</p>
			<details class="mt-2 text-xs text-muted-foreground">
				<summary class="cursor-pointer">What is wrong with it</summary>
				<p class="mt-1 break-words">{data.view.config.error}</p>
			</details>
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
					{@const pg = pageFor(p.id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-plugin={p.id}>
						{#if configurable(p) && pg}
							<a href="/settings/plugins/{p.id}" class="group min-w-0 flex-1 basis-40">
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium group-hover:underline"
										>{p.name}
										<span class="font-normal text-muted-foreground">{p.version}</span></span
									>
									<span class="block text-xs text-muted-foreground">
										{#if p.state === 'disabled'}
											Installed, but not loaded
										{:else}
											<span
												class={pg.projects.some((x) => x.on) || (!pg.projects.length && pg.on)
													? 'text-success'
													: ''}
												data-where>{whereOnWords(pg)}</span
											>{p.source === 'installed' && p.repository
												? ` · from ${p.repository}`
												: ' · comes with Wheelhouse'}
										{/if}
									</span>
								</span>
							</a>
						{:else}
							<div class="min-w-0 flex-1 basis-40">
								<p class="text-sm font-medium">
									{p.name} <span class="font-normal text-muted-foreground">{p.version}</span>
								</p>
								<p class="text-xs break-words text-danger" data-state={p.state}>
									{p.reason ?? 'Wheelhouse could not load it.'}
								</p>
							</div>
						{/if}
						{#if p.source === 'installed' && updateFor(p.id)}
							<PluginUpdate
								update={updateFor(p.id)!}
								name={p.name}
								checking={checking || !!updates?.checking}
								busy={updates?.busy ?? []}
							/>
						{/if}
						{#if p.state === 'loaded' && pg}
							{#if pg.enabled !== null}
								<button
									type="button"
									class="shrink-0 cursor-pointer text-xs text-sea hover:underline disabled:cursor-not-allowed"
									disabled={saving !== null || !!pg.configError}
									onclick={() => turn(p, null)}>Back to the default</button
								>
							{/if}
							<EveryProjectSwitch
								view={pg}
								disabled={saving !== null || !!pg.configError}
								onchange={(on) => turn(p, on)}
							/>
						{:else}
							<span class="hidden w-11 shrink-0 sm:block" aria-hidden="true"></span>
						{/if}
						{#if configurable(p)}
							<a
								href="/settings/plugins/{p.id}"
								class="shrink-0 text-muted-foreground hover:text-foreground"
								tabindex="-1"
								aria-hidden="true"><ChevronRight class="size-4" /></a
							>
						{:else}
							<span class="w-4 shrink-0" aria-hidden="true"></span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>

<SavedNote {note} />
