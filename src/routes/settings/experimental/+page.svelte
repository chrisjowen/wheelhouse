<script lang="ts">
	import { invalidateAll } from '$app/navigation';
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
			// The chat reads its lanes flag from the page data: refresh it, no restart needed.
			if (feature === 'lanes' || feature === 'livereview' || feature === 'soundings')
				await invalidateAll();
			message = body.restartRequired
				? 'Saved. Wheelhouse is restarting to apply the change.'
				: feature === 'automaticProviderSwitching'
					? 'Saved. Automatic provider switching is updated immediately.'
					: feature === 'soundings'
						? `Saved. Soundings is ${enabled ? 'on: its first scan runs within a minute, and Logbook → Health shows it' : 'off'}.`
						: feature === 'livereview'
							? `Saved. Live review sessions are ${enabled ? 'on: open a task’s Preview tab' : 'off'}.`
							: feature === 'lanes'
								? `Saved. The Firstmate chat ${enabled ? 'shows its lanes' : 'is back to one stream'} now.`
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
			Experimental features are early and may change while their design is being worked out. They
			are off by default. Automatic provider switching is on by default and can be disabled here.
		</p>

		<div class="mt-6 divide-y rounded-lg border">
			{#each [{ id: 'events' as const, title: 'Events and reminders', detail: 'Settings → Events, local reminders, and the Firstmate events connection.' }, { id: 'remotes' as const, title: 'Remote access', detail: 'Cloud and Fleetyard pairing, remote access through a gateway, and remote second-mate connections.' }, { id: 'hosted-second-mates' as const, title: 'Hosted second mates', detail: 'Add and launch a second mate on a Fleetyard or gateway machine.' }, { id: 'lanes' as const, title: 'Chat lanes', detail: 'Lanes over the Firstmate chat, one per project with its new messages and calls waiting on you, and a row of its tasks. Switch with ⌥1–9 (⌥0 for all) and ⌥↓ for the next lane with news. A message goes where its To line says: the lane you read, the message you reply to, or the thread of the last message.' }, { id: 'livereview' as const, title: 'Live review sessions', detail: 'Start live session on a task’s preview: use the page and talk while a scribe records what you do and say, answers when you ask, and keeps notes. Hold ⌥ Option to talk (tap it twice for hands-free). End makes a feedback pack, with screenshots, that goes to Firstmate for the same task.' }, { id: 'discussion' as const, title: 'Live mode', detail: 'A Live switch in the Firstmate chat: talk a decision through out loud with a discussion crew member while Firstmate keeps the watch, then send Firstmate the Captain’s briefing. Voices are set in Settings → Voice.' }, { id: 'soundings' as const, title: 'Soundings (health check)', detail: 'Watches this computer and Wheelhouse itself: background services that keep crashing and restarting, CPU and memory hogs, memory pressure, nearly full disks, ballooning logs, dev servers left running, and Wheelhouse’s own memory, speed and page errors. A light scan runs every few minutes at low priority; plain rules ring the ship’s bell at once, and about hourly a short AI report explains what is wrong and what to do. Report only: fixes are requests to Firstmate you send with a tap. Process details stay on this computer, and secrets are masked before anything reaches the AI. Logbook → Health.' }, { id: 'automaticProviderSwitching' as const, title: 'Automatic provider switching', detail: 'Detect worker usage-limit and credit errors, mark the provider out, and relaunch the task on an eligible dispatch profile.' }] as feature (feature.id)}
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
