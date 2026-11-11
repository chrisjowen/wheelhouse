<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import { wheelhouseUpdates as u } from '$lib/client/updates.svelte';
	import type { WheelhouseUpdateView, UpdateSource } from '$lib/updates';

	/**
	 * Settings → Update source: choose between "Published release" (npm) and
	 * "GitHub source" (a clone from GitHub). Switching installs from npm, or
	 * clones (or updates) and links the clone, then restarts Wheelhouse; the
	 * progress shows here and in the header's update menu. The page says
	 * plainly when the chosen mode does not match how Wheelhouse is installed,
	 * and choosing that mode again does the reinstall or relink.
	 */
	let { data } = $props();

	const view = $derived(u.view ?? data.view);
	const source = $derived(view.source);
	const mismatch = $derived(view.mismatch);
	const kind = $derived(view.installKind);
	const job = $derived(view.job);
	const switching = $derived(job?.state === 'running' || job?.state === 'restarting');
	let choice: UpdateSource = $state(untrack(() => data.view.source));
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!switching && !busy) choice = source;
	});

	async function setMode(next: UpdateSource) {
		if (next === source && !mismatch) return;
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/wheelhouse/source', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ source: next })
			});
			const body = (await res.json().catch(() => null)) as
				(WheelhouseUpdateView & { message?: string }) | null;
			if (!res.ok || !body) {
				error = body?.message ?? `Wheelhouse could not switch (${res.status}).`;
				choice = source;
				return;
			}
			if (body.job) u.follow(body);
		} catch {
			error = 'Wheelhouse did not answer.';
			choice = source;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Update · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Update</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Choose how Wheelhouse updates itself. Switching performs the reinstall or relink for the
			chosen mode and restarts Wheelhouse.
		</p>

		<div class="mt-6 space-y-6">
			<div>
				<div class="font-medium">Update source</div>
				<div class="mt-2 flex flex-col gap-3 text-sm">
					<label class="flex items-start gap-3">
						<input
							type="radio"
							name="source"
							value="published"
							bind:group={choice}
							disabled={busy || switching}
							onchange={() => setMode(choice)}
						/>
						<div>
							<div class="font-medium">Published release</div>
							<p class="text-muted-foreground">
								Checks npm for the latest <code>@chrisjowen/wheelhouse</code> and updates the global npm
								install.
							</p>
						</div>
					</label>
					<label class="flex items-start gap-3">
						<input
							type="radio"
							name="source"
							value="github"
							bind:group={choice}
							disabled={busy || switching}
							onchange={() => setMode(choice)}
						/>
						<div>
							<div class="font-medium">GitHub source</div>
							<p class="text-muted-foreground">
								Fast-forwards a local clone from GitHub, rebuilds and relinks (current behaviour).
							</p>
						</div>
					</label>
				</div>
			</div>

			{#if mismatch}
				<div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
					<div class="font-medium text-warning">Install does not match chosen mode</div>
					<p class="mt-1 text-muted-foreground">
						Wheelhouse is running {kind === 'clone' ? 'from a git clone' : 'from the npm package'},
						but the chosen source is
						{source === 'published' ? 'Published release' : 'GitHub source'}, so the header cannot
						update it. Choose the other source, or {source === 'published'
							? 'install the published release'
							: 'clone and link it from GitHub'} now.
					</p>
					<button
						type="button"
						class="mt-2 text-sm text-sea hover:underline disabled:opacity-50"
						disabled={busy || switching}
						onclick={() => setMode(source)}
						>{source === 'published'
							? 'Install from npm and restart'
							: 'Clone, link and restart'}</button
					>
				</div>
			{/if}

			{#if job}
				{#if job.state === 'failed'}
					<p class="text-sm text-danger" role="alert">That did not work: {job.error}.</p>
				{:else}
					<p class="text-sm text-muted-foreground" aria-live="polite">
						{job.state === 'restarting'
							? 'Restarting Wheelhouse…'
							: `${job.steps.find((s) => s.step === job.step)?.label ?? 'Working'}…`}
					</p>
				{/if}
			{/if}

			{#if error}
				<p class="text-sm text-danger" role="alert">{error}</p>
			{/if}

			<p class="text-xs text-muted-foreground">
				Until a source is chosen it follows how Wheelhouse is installed. The header's update menu
				checks the chosen source every six hours and upgrades from it.
			</p>
		</div>
	</div>
</main>
