<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SESSION_HEADER } from '$lib/client/messages';
	import SettingsNav from '$lib/components/wh/settings/SettingsNav.svelte';
	import type { ChatArchiveStats } from '$lib/types';

	/**
	 * Settings → Chat history: how much of the conversation with Firstmate
	 * Wheelhouse keeps (lib/server/chatarchive), where, and for how long.
	 * Keeping everything is the default; a shorter time deletes the sessions
	 * that ended before it at once, always keeping the newest.
	 */
	let { data } = $props();

	const CHOICES: { days: number | null; label: string }[] = [
		{ days: null, label: 'Keep everything' },
		{ days: 365, label: 'One year' },
		{ days: 180, label: 'Six months' },
		{ days: 90, label: 'Three months' },
		{ days: 30, label: 'One month' }
	];

	let stats = $state<ChatArchiveStats | null>(untrack(() => data.stats));
	let choice = $state<number | null>(untrack(() => data.stats?.retentionDays ?? null));
	let busy = $state(false);
	let error = $state<string | null>(null);

	const shrinking = $derived(
		!!stats && choice !== null && (stats.retentionDays === null || choice < stats.retentionDays)
	);

	const size = (bytes: number) =>
		bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	const day = (at: string | null) =>
		at
			? new Date(at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
			: '—';

	async function save() {
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/firstmate/chat/archive', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					[SESSION_HEADER]: page.data.sessionToken as string
				},
				body: JSON.stringify({ retentionDays: choice })
			});
			const body = (await res.json().catch(() => null)) as
				(ChatArchiveStats & { message?: string }) | null;
			if (!res.ok || !body) {
				error = body?.message ?? `Wheelhouse could not save it (${res.status}).`;
				return;
			}
			stats = body;
			choice = body.retentionDays;
		} catch {
			error = 'Wheelhouse did not answer.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Chat history · Wheelhouse</title></svelte:head>

<main class="px-4 py-6 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<SettingsNav />
		<h1 class="mt-6 text-2xl">Chat history</h1>
		<p class="mt-1 max-w-prose text-sm text-muted-foreground">
			Wheelhouse keeps every message of the conversation with Firstmate, from every session, so the
			chat carries on after Firstmate restarts and can be searched back to its start.
		</p>

		{#if !stats}
			<p class="mt-6 text-sm text-muted-foreground" role="status">{data.reason}</p>
		{:else}
			<dl
				class="mt-6 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm"
				data-archive-stats
			>
				<dt class="text-muted-foreground">Sessions</dt>
				<dd>{stats.sessions.toLocaleString()}</dd>
				<dt class="text-muted-foreground">Records</dt>
				<dd>{stats.records.toLocaleString()}</dd>
				<dt class="text-muted-foreground">On disk</dt>
				<dd>{size(stats.bytes)}</dd>
				<dt class="text-muted-foreground">From</dt>
				<dd>{day(stats.oldest)} to {day(stats.newest)}</dd>
				<dt class="text-muted-foreground">Kept in</dt>
				<dd class="font-mono text-xs break-all">{stats.dir}</dd>
			</dl>

			<div class="mt-8 max-w-xl">
				<label class="font-medium" for="retention">Keep the chat history</label>
				<div class="mt-2 flex flex-wrap items-center gap-3">
					<select
						id="retention"
						class="h-9 rounded-lg border bg-card px-3 text-sm"
						bind:value={choice}
						disabled={busy}
					>
						{#each CHOICES as c (c.days)}
							<option value={c.days}>{c.label}</option>
						{/each}
					</select>
					<button
						class="h-9 cursor-pointer rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:cursor-default disabled:opacity-50"
						disabled={busy || choice === stats.retentionDays}
						onclick={save}>Save</button
					>
				</div>
				{#if shrinking}
					<p class="mt-2 text-sm text-warning" role="status">
						Sessions that ended more than {CHOICES.find(
							(c) => c.days === choice
						)?.label.toLowerCase()}
						ago are deleted from the history when you save. The newest session is always kept.
					</p>
				{/if}
				{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
				<p class="mt-3 text-xs text-muted-foreground">
					The history is Wheelhouse’s own copy; Firstmate’s transcripts are only ever read, never
					changed. It survives restarts and upgrades of Wheelhouse.
				</p>
			</div>
		{/if}
	</div>
</main>
