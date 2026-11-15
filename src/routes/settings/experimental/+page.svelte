<script lang="ts">
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import { untrack } from 'svelte';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { FeatureFlag, FeatureSettings } from '$lib/server/features';

	let { data } = $props();
	let saved = $state<FeatureSettings>(untrack(() => data.saved));
	let busy = $state<FeatureFlag | null>(null);
	let message = $state('');
	let problem = $state('');

	async function change(feature: FeatureFlag, input: HTMLInputElement) {
		const enabled = input.checked;
		busy = feature;
		message = '';
		problem = '';
		try {
			const response = await fetch('/api/features', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ feature, enabled })
			});
			const body = (await response.json()) as {
				saved?: FeatureSettings;
				restartRequired?: boolean;
				message?: string;
			};
			if (!response.ok || !body.saved)
				throw new Error(body.message ?? 'Could not save this setting.');
			saved = body.saved;
			message = body.restartRequired
				? 'Saved. Wheelhouse is restarting to apply the change.'
				: 'Saved. Restart Wheelhouse to apply the change.';
		} catch (error) {
			problem = (error as Error).message;
			input.checked = saved[feature];
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head><title>Experimental features · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Experimental features</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			These features are early and may change while their design is being worked out. They are off
			by default. Turning one off hides its pages and stops its background work; its saved data is
			kept and returns if you enable it again.
		</p>

		<div class="mt-6 divide-y rounded-lg border">
			{#each [{ id: 'events' as const, title: 'Events and reminders', detail: 'The Events page, local reminders, and the Firstmate events connection.' }, { id: 'remotes' as const, title: 'Remote access and second mates', detail: 'Cloud and Fleetyard pairing, remote access through a gateway, and remote second-mate connections.' }] as feature (feature.id)}
				<label class="flex cursor-pointer items-start gap-4 p-4">
					<input
						class="mt-1 size-4 accent-primary"
						type="checkbox"
						checked={saved[feature.id]}
						disabled={busy !== null}
						aria-label={`Enable ${feature.title}`}
						onchange={(event) => change(feature.id, event.currentTarget)}
					/>
					<span class="min-w-0">
						<span class="block font-medium">{feature.title}</span>
						<span class="mt-1 block text-sm text-muted-foreground">{feature.detail}</span>
					</span>
				</label>
			{/each}
		</div>
		{#if message}<p class="mt-4 text-sm" role="status">{message}</p>{/if}
		{#if problem}<p class="mt-4 text-sm text-danger" role="alert">{problem}</p>{/if}
	</div>
</main>
