<script lang="ts">
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { WheelhouseUpdateView, UpdateSource } from '$lib/updates';

	/**
	 * Settings → Update source: choose between "Published release" (npm) and
	 * "GitHub source" (clone fast-forward). Switching performs the action for
	 * the chosen mode and restarts Wheelhouse. The page shows a plain mismatch
	 * warning when the chosen mode does not match how Wheelhouse is installed.
	 */
	let { data } = $props();

	let source: UpdateSource = $state(data.source);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let freshView = $state<WheelhouseUpdateView | null>(null);

	const view = $derived(freshView ?? (data.view as WheelhouseUpdateView));
	const mismatch = $derived(view?.mismatch ?? false);
	const kind = $derived(view?.installKind ?? data.installKind ?? 'unknown');

	async function reload() {
		try {
			const r = await fetch('/api/wheelhouse/update');
			if (r.ok) freshView = (await r.json()) as WheelhouseUpdateView;
		} catch {
			// ignore
		}
	}

	async function setMode(next: UpdateSource) {
		if (next === source) return;
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
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			if (!res.ok) {
				error = body?.message ?? `Wheelhouse could not switch (${res.status}).`;
				return;
			}
			source = next;
			// The server will restart; poll a bit to show progress if it comes back quickly
			await new Promise((r) => setTimeout(r, 800));
			await reload();
		} catch {
			error = 'Wheelhouse did not answer.';
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
							checked={source === 'published'}
							disabled={busy}
							onchange={() => setMode('published')}
						/>
						<div>
							<div class="font-medium">Published release (default)</div>
							<p class="text-muted-foreground">
								Checks npm for the latest <code>@chrisjowen/wheelhouse</code> and updates the global
								npm install.
							</p>
						</div>
					</label>
					<label class="flex items-start gap-3">
						<input
							type="radio"
							name="source"
							value="github"
							checked={source === 'github'}
							disabled={busy}
							onchange={() => setMode('github')}
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
						Wheelhouse is running as <code>{kind}</code> but the chosen source is
						<code>{source}</code>. Switch the source or reinstall to match.
					</p>
				</div>
			{/if}

			{#if error}
				<p class="text-sm text-danger" role="alert">{error}</p>
			{/if}

			<p class="text-xs text-muted-foreground">
				Checks npm or GitHub every six hours when the page is open. The header Update menu follows the
				chosen source.
			</p>
		</div>
	</div>
</main>
