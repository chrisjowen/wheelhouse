<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { RotateCw } from '@lucide/svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import Switch from '$lib/components/wh/Switch.svelte';
	import ChangeProgress from '$lib/components/wh/plugins/ChangeProgress.svelte';
	import SavedNote from '$lib/components/wh/plugins/SavedNote.svelte';
	import SettingsFields, { answersFor } from '$lib/components/wh/plugins/SettingsFields.svelte';
	import { Button } from '$lib/components/ui/button';
	import { live } from '$lib/client/live.svelte';
	import { afterRestart, changePlugin, loadPlugin } from '$lib/client/plugins';
	import { addsWords, defaultWords, midSentence } from '$lib/plugins/words';
	import type { PluginPageView } from '$lib/plugins/types';

	/**
	 * Settings → Plugins → one plugin: whether it is on for every project and
	 * for each one, and its settings, each saved to the plugins file as it
	 * changes and applied without a restart; and, for an installed plugin that
	 * is turned off, loading it, which restarts Wheelhouse.
	 */
	let { data } = $props();

	let fresh = $state<PluginPageView | null>(null);
	const view = $derived(fresh ?? data.view);
	const p = $derived(view.plugin);
	const token = () => page.data.sessionToken as string;

	let saving = $state(false);
	let note = $state<{ text: string; ok: boolean } | null>(null);
	let noteTimer: ReturnType<typeof setTimeout> | undefined;
	function say(text: string, ok = true) {
		note = { text, ok };
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => (note = null), ok ? 4000 : 8000);
	}
	const LIVE = 'It applies now, with no restart.';

	async function change(
		c: { enabled: boolean | null } | { project: string; enabled: boolean | null },
		done: string
	) {
		saving = true;
		const r = await changePlugin(p.id, c, token());
		saving = false;
		if (!r.ok) return say(r.error, false);
		fresh = r.value;
		say(`${done} ${LIVE}`);
	}

	// The settings form: its answers start from what the plugins file has, else each default.
	let answers = $state<Record<string, string>>({});
	let saved = $state<Record<string, string>>({});
	$effect.pre(() => {
		const start = answersFor(data.view.settings);
		answers = { ...start };
		saved = start;
	});
	const dirty = $derived(Object.keys(answers).some((k) => answers[k] !== saved[k]));
	const missing = $derived(view.settings.find((s) => s.required && !answers[s.key]?.trim()));

	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		if (missing) return say(`${missing.title} is needed.`, false);
		saving = true;
		const r = await changePlugin(p.id, { settings: { ...answers } }, token());
		saving = false;
		if (!r.ok) return say(r.error, false);
		fresh = r.value;
		saved = answersFor(r.value.settings);
		answers = { ...saved };
		say(`Settings saved. ${p.name} uses them from its next look, with no restart.`);
	}

	// Loading an installed plugin that is turned off: turn it on, then restart.
	let loading = $state<'saving' | 'restarting' | 'done' | 'slow' | null>(null);
	let loadError = $state<string | null>(null);
	async function load() {
		loading = 'saving';
		loadError = null;
		const back = afterRestart();
		const r = await loadPlugin(p.id, token());
		if (!r.ok) {
			loading = null;
			loadError = r.error;
			return;
		}
		loading = 'restarting';
		loading = (await back) ? 'done' : 'slow';
	}

	onMount(() => {
		const off = live.onRestart(() => {
			fresh = null;
			void invalidateAll();
		});
		return () => {
			off();
			clearTimeout(noteTimer);
		};
	});

	const CHOICES = [
		{ value: null, label: 'As the plugin' },
		{ value: true, label: 'On' },
		{ value: false, label: 'Off' }
	] as const;
	const from = $derived(
		p.source === 'installed' && p.repository
			? `${p.repository}${p.commit ? ` at ${p.commit.slice(0, 7)}` : ''}`
			: 'Comes with Wheelhouse'
	);
	const blocked = $derived(saving || !!view.configError);
</script>

<svelte:head><title>{p.name} · Plugins · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<p class="mt-6 text-sm text-muted-foreground">
			<a href="/settings/plugins" class="hover:text-foreground hover:underline">Plugins</a>
			<span aria-hidden="true">/</span>
			{p.name}
		</p>
		<h1 class="mt-1 text-2xl">{p.name}</h1>
		{#if p.description}
			<p class="mt-1 max-w-prose text-sm text-muted-foreground">{p.description}</p>
		{/if}

		<div class="mt-8 grid max-w-3xl gap-8">
			{#if view.configError}
				<p class="rounded-lg border border-danger/40 p-4 text-sm text-danger" role="alert">
					{view.configError}
				</p>
			{/if}

			{#if p.state === 'disabled'}
				<section
					class="rounded-md border border-brass/60 bg-background px-4 py-3 text-sm"
					aria-labelledby="not-loaded"
				>
					<h2 id="not-loaded" class="font-medium">Not loaded</h2>
					{#if loading}
						<div class="mt-3"><ChangeProgress label="Turn it on" phase={loading} /></div>
					{:else}
						<p class="mt-0.5 text-muted-foreground">
							{p.name} is installed but turned off, so Wheelhouse has not started it. Wheelhouse loads
							plugins when it starts, so loading it restarts Wheelhouse; Firstmate and its crew keep running.
						</p>
						{#if data.canRestart}
							<Button class="mt-3" size="sm" onclick={load}><RotateCw />Load and restart</Button>
						{:else}
							<p class="mt-2 text-muted-foreground">
								This Wheelhouse cannot restart itself, so turn it on in a terminal with
								<code>wheelhouse plugin enable {p.id}</code>.
							</p>
						{/if}
						{#if loadError}
							<p class="mt-2 text-danger" role="alert">{loadError}</p>
						{/if}
					{/if}
				</section>
			{:else if p.state !== 'loaded'}
				<p class="rounded-lg border border-danger/40 p-4 text-sm text-danger">
					{p.reason ?? 'Wheelhouse could not load it.'}
				</p>
			{/if}

			<section aria-labelledby="where-on">
				<h2 id="where-on" class="section-label">Where it is on</h2>
				{#if p.state !== 'loaded'}
					<p class="mt-2 text-xs text-muted-foreground">
						What you choose here applies once {p.name} is loaded.
					</p>
				{/if}
				<div
					class="mt-3 flex items-center justify-between gap-4 rounded-md border bg-background px-4 py-3"
				>
					<div class="min-w-0 text-sm">
						<p class="font-medium">Every project</p>
						<p class="text-xs text-muted-foreground" data-testid="every-project">
							{#if view.enabled === null}
								By default: {midSentence(defaultWords(p))}. A project below can differ.
							{:else}
								{view.on ? 'On' : 'Off'} for every project, except where a project below says otherwise.
								<button
									type="button"
									class="cursor-pointer text-sea hover:underline disabled:cursor-not-allowed"
									disabled={blocked}
									onclick={() =>
										change(
											{ enabled: null },
											`${p.name} is back to its default: ${midSentence(defaultWords(p))}.`
										)}>Back to the default</button
								>
							{/if}
						</p>
					</div>
					<Switch
						checked={view.on}
						label="{p.name} on for every project"
						disabled={blocked}
						onchange={(on) =>
							change({ enabled: on }, `${p.name} is ${on ? 'on' : 'off'} for every project.`)}
					/>
				</div>
				{#if view.projects.length}
					<ul class="mt-2 divide-y rounded-md border bg-background" aria-label="Projects">
						{#each view.projects as proj (proj.id)}
							<li
								class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-sm"
								data-project={proj.id}
							>
								<span class="min-w-0 break-words">
									{proj.name}
									<span class="text-xs text-muted-foreground">
										· {proj.on ? 'on' : 'off'}{proj.enabled === null ? ', as the plugin' : ''}</span
									>
								</span>
								<div
									class="inline-flex rounded-md border bg-muted/50 p-0.5 text-xs"
									role="radiogroup"
									aria-label="{p.name} for {proj.name}"
								>
									{#each CHOICES as c (c.label)}
										<button
											type="button"
											role="radio"
											aria-checked={proj.enabled === c.value}
											disabled={blocked}
											onclick={() =>
												proj.enabled !== c.value &&
												change(
													{ project: proj.id, enabled: c.value },
													c.value === null
														? `${proj.name} follows the plugin again.`
														: `${p.name} is ${c.value ? 'on' : 'off'} for ${proj.name}.`
												)}
											class="min-h-7 cursor-pointer rounded px-2.5 py-1 transition-colors disabled:cursor-not-allowed {proj.enabled ===
											c.value
												? 'bg-card font-medium text-foreground shadow-sm ring-1 ring-hair'
												: 'text-muted-foreground hover:text-foreground'}">{c.label}</button
										>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">Wheelhouse knows no projects yet.</p>
				{/if}
			</section>

			<section aria-labelledby="settings">
				<h2 id="settings" class="section-label">Settings</h2>
				{#if view.settings.length === 0}
					<p class="mt-3 text-sm text-muted-foreground">{p.name} has nothing to set.</p>
				{:else}
					<form
						class="mt-3 grid max-w-xl gap-4 rounded-md border bg-background px-4 py-4"
						onsubmit={saveSettings}
					>
						<SettingsFields settings={view.settings} bind:answers disabled={!!view.configError} />
						<div class="flex flex-wrap items-center gap-3">
							<Button type="submit" size="sm" disabled={!dirty || blocked}>Save settings</Button>
							{#if dirty}
								<span class="text-xs text-muted-foreground">Not saved yet</span>
								<button
									type="button"
									class="cursor-pointer text-xs text-muted-foreground hover:text-foreground hover:underline"
									onclick={() => (answers = { ...saved })}>Undo changes</button
								>
							{/if}
						</div>
					</form>
				{/if}
			</section>

			<section aria-labelledby="about">
				<h2 id="about" class="section-label">About</h2>
				<dl class="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
					<dt class="text-muted-foreground">Adds</dt>
					<dd>{addsWords(p.slots)}</dd>
					<dt class="text-muted-foreground">From</dt>
					<dd class="break-words">{from}</dd>
					<dt class="text-muted-foreground">Version</dt>
					<dd class="tabular">{p.version}</dd>
					<dt class="text-muted-foreground">By default</dt>
					<dd>{defaultWords(p)}</dd>
				</dl>
			</section>
		</div>
	</div>
</main>

<SavedNote {note} />
