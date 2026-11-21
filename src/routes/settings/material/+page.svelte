<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { MaterialGroup, MaterialView } from '$lib/material';

	/**
	 * Settings → Agent material: the skills, worker-brief rules and session
	 * context Wheelhouse gives Firstmate and its crew, each turned on or off.
	 * Turning one off removes Wheelhouse's copies (an edited copy is left as it
	 * is, and said so); turning it on installs it again.
	 */
	let { data } = $props();
	let view = $state<MaterialView | null>(untrack(() => data.view));
	let busy = $state<MaterialGroup | null>(null);
	let notes = $state<string[]>([]);
	let problem = $state('');
	const disabled = $derived(view?.state === 'disabled');

	const STATES: Record<string, string> = {
		installed: 'Installed',
		updated: 'Updated',
		current: 'Installed',
		kept: 'Your edits kept',
		modified: 'Edited locally, so left as it is',
		foreign: 'Another copy is there, so left as it is',
		refused: 'Left alone: git would see it in Firstmate’s checkout',
		off: 'Off',
		error: 'Could not be installed'
	};

	async function change(group: MaterialGroup, input: HTMLInputElement) {
		const on = input.checked;
		busy = group;
		notes = [];
		problem = '';
		try {
			const response = await fetch('/api/material', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ group, on })
			});
			const body = (await response.json().catch(() => null)) as {
				view?: MaterialView;
				notes?: string[];
				message?: string;
			} | null;
			if (!response.ok || !body?.view) throw new Error(body?.message ?? 'Could not change this.');
			view = body.view;
			notes = body.notes ?? [];
		} catch (error) {
			problem = (error as Error).message;
			input.checked = !on;
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head><title>Agent material · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Agent material</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			What Wheelhouse gives Firstmate and its crew so they work well with it. Each is kept up to
			date when Wheelhouse updates, and a copy someone edited is never overwritten.
		</p>

		{#if !view}
			<p class="mt-6 text-sm text-muted-foreground">Set up Wheelhouse first.</p>
		{:else}
			{#if disabled}
				<p class="mt-6 max-w-prose text-sm text-muted-foreground" role="status">
					This Wheelhouse installs nothing: only one started with <code>wheelhouse open</code> from its
					package does, unless WHEELHOUSE_MANAGE_SKILL=0 turns it off.
				</p>
			{/if}
			<div class="mt-6 divide-y rounded-lg border">
				{#each view.rows as row (row.group)}
					<label class="flex cursor-pointer items-start gap-4 p-4">
						<input
							class="mt-1 size-4 accent-primary"
							type="checkbox"
							checked={row.on && !row.unavailable}
							disabled={busy !== null || disabled || !!row.unavailable}
							aria-label={`Install ${row.title}`}
							onchange={(event) => change(row.group, event.currentTarget)}
						/>
						<span class="min-w-0">
							<span class="block font-medium">{row.title}</span>
							<span class="mt-1 block text-sm text-muted-foreground">{row.detail}</span>
							{#if row.unavailable}
								<span class="mt-1 block text-sm text-muted-foreground">{row.unavailable}</span>
							{:else}
								{#each row.items as item (item.id)}
									<span
										class="mt-1 block truncate text-xs text-muted-foreground"
										title={item.target}
									>
										{STATES[item.state] ?? item.state} ·
										<span class="font-mono">{item.target}</span>
									</span>
								{/each}
							{/if}
						</span>
					</label>
				{/each}
			</div>
			{#if view.drift.length}
				<p class="mt-4 max-w-prose text-sm text-muted-foreground">
					Firstmate has changed since this Wheelhouse was released: it no longer has
					{view.drift.map((d) => `${d.marker} (${d.file})`).join(', ')}, which this material relies
					on. A Wheelhouse update brings it back in line.
				</p>
			{/if}
		{/if}
		{#each notes as note (note)}<p class="mt-4 text-sm" role="status">{note}</p>{/each}
		{#if problem}<p class="mt-4 text-sm text-danger" role="alert">{problem}</p>{/if}
	</div>
</main>
