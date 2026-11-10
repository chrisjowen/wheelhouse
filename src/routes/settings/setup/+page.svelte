<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { SetupView } from '$lib/setup';

	/**
	 * Settings → Setup: which Firstmate Wheelhouse uses and how it found it, and
	 * the setup wizard to run again (tools, Claude Code, checks and plugins).
	 */
	let { data } = $props();
	const view = $derived(data.setup as SetupView);
	const SOURCE = {
		flag: 'given with --firstmate',
		cwd: 'the Firstmate checkout Wheelhouse was started in',
		remembered: 'chosen in setup, and remembered in Wheelhouse’s config'
	};
</script>

<svelte:head><title>Setup · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Setup</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			The setup wizard clones Firstmate or finds the one you have, checks the tools it needs and
			Claude Code, runs Firstmate’s own checks and suggests plugins. Run it again any time: nothing
			is installed or changed without you agreeing first.
		</p>
		<dl class="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
			<dt class="font-medium">Firstmate</dt>
			<dd class="min-w-0 text-muted-foreground">
				{#if view.install}
					<code class="text-xs break-all text-foreground">{view.install.firstmateDir}</code>,
					{SOURCE[view.install.source]}
				{:else}
					Not connected: {view.problem}
				{/if}
			</dd>
			{#if view.install && view.install.homeDir !== view.install.firstmateDir}
				<dt class="font-medium">Home</dt>
				<dd class="min-w-0"><code class="text-xs break-all">{view.install.homeDir}</code></dd>
			{/if}
		</dl>
		<div class="mt-6">
			<Button href="/setup">Run the setup wizard</Button>
		</div>
	</div>
</main>
