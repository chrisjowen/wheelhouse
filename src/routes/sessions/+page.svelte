<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { newSession } from '$lib/client/new-session.svelte';
	import { fetchSessions } from '$lib/client/sessions';
	import type { SessionsView } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import SessionCard from '$lib/components/wh/SessionCard.svelte';
	import { Plus, SquareTerminal } from '@lucide/svelte';

	const POLL_MS = 5_000;
	let fresh = $state<SessionsView | null>(null);
	const view = $derived(fresh ?? (page.data.sessions as SessionsView));

	// Whether each session is still running is re-read every few seconds.
	onMount(() => {
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			const v = await fetchSessions();
			if (v) fresh = v;
			if (!stop) timer = setTimeout(load, POLL_MS);
		};
		void load();
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});

	// A session just launched shows first, before the next poll lists it.
	const sessions = $derived.by(() => {
		const list = view?.sessions ?? [];
		const last = newSession.last;
		if (!last || list.some((s) => s.id === last.session.id)) return list;
		return [last.session, ...list];
	});
</script>

<svelte:head><title>Sessions · Wheelhouse</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 pt-10 pb-24 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
		<div class="max-w-2xl">
			<h1 class="text-2xl font-semibold tracking-tight">Sessions</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Your own Claude Code sessions, live in the browser, to brainstorm an idea or think through a
				project. When one has something, hand it to Firstmate. Firstmate’s crew is not listed here.
			</p>
		</div>
		<Button onclick={() => newSession.show()} disabled={view && !view.available}
			><Plus />New session</Button
		>
	</div>

	{#if view && !view.available && view.reason}
		<p class="mt-6 text-sm text-danger" role="alert">{view.reason}</p>
	{/if}

	{#if !sessions.length}
		<div class="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
			<SquareTerminal class="mx-auto size-6 text-sea" aria-hidden="true" />
			<p class="mt-3 font-medium text-foreground">No sessions yet.</p>
			<p class="mt-2">
				Start one for a project or a blank idea. It opens here, in the browser, and works in its own
				scratch directory{view?.dir ? ` under ${view.dir}` : ''}.
			</p>
		</div>
	{:else}
		<ul class="mt-6 space-y-4">
			{#each sessions as s (s.id)}<SessionCard session={s} />{/each}
		</ul>
	{/if}
</main>
