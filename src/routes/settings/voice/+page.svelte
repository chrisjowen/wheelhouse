<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { CircleCheck, KeyRound, Volume2 } from '@lucide/svelte';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import VaultAdd from '$lib/components/firstmate/VaultAdd.svelte';
	import type { VaultRequest } from '$lib/chat/vaultrequest';
	import { BROWSER, type VoiceSettings, type VoiceView } from '$lib/voice/settings';

	/**
	 * Settings → Voice: how the discussion crew speaks and hears the captain in
	 * Live mode. The browser's own voice is the default and needs nothing set up.
	 * A provider (ElevenLabs is built in; plugins may add more) sounds natural and
	 * hears project names right; its key is typed into the vault's hidden prompt
	 * and stays in the vault, never in a settings file. With no key, or when the
	 * provider fails, the browser takes over without a fuss.
	 */
	let { data } = $props();

	let view = $state<VoiceView>(untrack(() => data.voice));
	let busy = $state(false);
	let problem = $state('');
	let vaultOpen = $state(false);
	let vaultAsk = $state<VaultRequest | null>(null);
	let trying = $state(false);

	const token = $derived(page.data.sessionToken as string);
	const chosen = $derived(view.providers.find((p) => p.id === view.settings.speak) ?? null);
	const hearer = $derived(view.providers.find((p) => p.canHear) ?? null);

	async function save(next: Partial<VoiceSettings>) {
		busy = true;
		problem = '';
		try {
			const r = await fetch('/api/voice', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ ...view.settings, ...next })
			});
			if (!r.ok)
				throw new Error(
					((await r.json().catch(() => null)) as { message?: string } | null)?.message ??
						'Could not save this setting.'
				);
			view = (await r.json()) as VoiceView;
		} catch (error) {
			problem = (error as Error).message;
		} finally {
			busy = false;
		}
	}

	async function reload() {
		const r = await fetch('/api/voice').catch(() => null);
		if (r?.ok) view = (await r.json()) as VoiceView;
	}

	function addKey(secret: string, label: string) {
		vaultAsk = {
			name: secret,
			purpose: `${label} voice for Live mode (Settings → Voice)`,
			projects: []
		};
		vaultOpen = true;
	}

	/** Say a line with the voice as it would be used now: the provider, else the browser. */
	async function tryVoice() {
		trying = true;
		const line = 'Captain, this is how I sound in Live mode.';
		try {
			const r = await fetch('/api/voice/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ text: line, speed: 1 })
			});
			if (r.status === 200) {
				const audio = new Audio(URL.createObjectURL(await r.blob()));
				await audio.play();
				await new Promise((done) => (audio.onended = done));
				return;
			}
			if (typeof speechSynthesis !== 'undefined') {
				const u = new SpeechSynthesisUtterance(line);
				await new Promise((done) => {
					u.onend = u.onerror = done;
					speechSynthesis.speak(u);
				});
			}
		} finally {
			trying = false;
		}
	}
</script>

<svelte:head><title>Voice · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Voice</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			How the discussion crew speaks and hears you in Live mode (an experimental feature). Your
			browser’s own voice needs nothing set up. A provider sounds natural and hears your project
			names right; its key stays in the vault. Without a key, or if the provider fails, the browser
			takes over.
		</p>

		<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">
			The crew’s voice
		</h2>
		<div class="mt-3 divide-y rounded-lg border">
			<label class="flex cursor-pointer items-start gap-4 p-4">
				<input
					class="mt-1 size-4 accent-primary"
					type="radio"
					name="speak"
					checked={view.settings.speak === BROWSER}
					disabled={busy}
					onchange={() => save({ speak: BROWSER, hear: BROWSER })}
				/>
				<span class="min-w-0">
					<span class="block font-medium">Browser voice</span>
					<span class="mt-1 block text-sm text-muted-foreground"
						>Your browser’s built-in voices. Nothing to set up.</span
					>
				</span>
			</label>
			{#each view.providers as p (p.id)}
				<div class="flex items-start gap-4 p-4">
					<input
						id="speak-{p.id}"
						class="mt-1 size-4 accent-primary"
						type="radio"
						name="speak"
						checked={view.settings.speak === p.id}
						disabled={busy}
						onchange={() =>
							save({ speak: p.id, voice: view.settings.voice ?? p.voices[0]?.id ?? null })}
					/>
					<div class="min-w-0 flex-1">
						<label for="speak-{p.id}" class="block cursor-pointer font-medium">{p.label}</label>
						<p class="mt-1 text-sm text-muted-foreground">{p.about}</p>
						<p class="mt-2 flex flex-wrap items-center gap-3 text-sm">
							{#if p.hasKey}
								<span class="inline-flex items-center gap-1.5 text-success"
									><CircleCheck class="size-4" aria-hidden="true" />Key in the vault ({p.secret})</span
								>
							{:else}
								<span class="text-muted-foreground"
									>No key yet{view.settings.speak === p.id
										? ': the browser speaks until you add one'
										: ''}.</span
								>
							{/if}
							<button
								class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 hover:bg-muted"
								onclick={() => addKey(p.secret, p.label)}
								><KeyRound class="size-3.5" aria-hidden="true" />{p.hasKey
									? 'Replace the key'
									: `Add your ${p.label} key`}</button
							>
						</p>
						{#if view.settings.speak === p.id}
							<label class="mt-3 flex max-w-sm items-center gap-3 text-sm">
								Voice
								<select
									class="min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5"
									value={view.settings.voice ?? p.voices[0]?.id}
									disabled={busy}
									onchange={(e) => save({ voice: e.currentTarget.value })}
								>
									{#each p.voices as v (v.id)}<option value={v.id}>{v.name} · {v.note}</option
										>{/each}
								</select>
							</label>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<button
			class="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
			disabled={trying}
			onclick={tryVoice}
			><Volume2 class="size-4" aria-hidden="true" />{trying ? 'Speaking…' : 'Try the voice'}</button
		>
		{#if chosen && !chosen.hasKey}
			<p class="mt-2 text-sm text-muted-foreground">
				Until the key is in the vault, you will hear the browser voice.
			</p>
		{/if}

		{#if hearer}
			<h2 class="mt-8 text-sm font-medium tracking-wider text-muted-foreground uppercase">
				Hearing you
			</h2>
			<label class="mt-3 flex cursor-pointer items-start gap-4 rounded-lg border p-4">
				<input
					class="mt-1 size-4 accent-primary"
					type="checkbox"
					checked={view.settings.hear === hearer.id}
					disabled={busy}
					onchange={(e) => save({ hear: e.currentTarget.checked ? hearer.id : BROWSER })}
				/>
				<span class="min-w-0">
					<span class="block font-medium">Use {hearer.label} to hear me</span>
					<span class="mt-1 block text-sm text-muted-foreground">
						Your words go to {hearer.label} with your project and task names as hints, so they come out
						spelled right. The browser’s recogniser still shows what it hears as you talk; it cannot learn
						your voice or your vocabulary.{hearer.hasKey ? '' : ` Needs the ${hearer.label} key.`}
					</span>
				</span>
			</label>
		{/if}

		<p class="mt-6 text-sm text-muted-foreground">
			Now in use: {view.effective.speak === BROWSER
				? 'the browser voice'
				: view.providers.find((p) => p.id === view.effective.speak)?.label}, heard by {view
				.effective.hear === BROWSER
				? 'the browser'
				: view.providers.find((p) => p.id === view.effective.hear)?.label}.
		</p>
		{#if problem}<p class="mt-4 text-sm text-danger" role="alert">{problem}</p>{/if}
	</div>
</main>

<VaultAdd
	bind:open={vaultOpen}
	ask={vaultAsk}
	projects={data.projects}
	{token}
	onstored={() => void reload()}
/>
