<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { live } from '$lib/client/live.svelte';
	import { newSession } from '$lib/client/new-session.svelte';
	import { fetchSessions } from '$lib/client/sessions';
	import { ago } from '$lib/format';
	import { sessionLabel } from '$lib/sessions';
	import type { SessionSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import AttachHint from '$lib/components/wh/AttachHint.svelte';
	import SessionHandoff from '$lib/components/wh/SessionHandoff.svelte';
	import SessionTerminal from '$lib/components/wh/SessionTerminal.svelte';
	import { ArrowLeft, Send, SquareTerminal, X } from '@lucide/svelte';

	const POLL_MS = 5_000;
	let fresh = $state<SessionSummary | null>(null);
	const s = $derived(
		fresh && fresh.id === page.params.id ? fresh : (page.data.session as SessionSummary)
	);
	const warning = $derived(newSession.last?.session.id === s.id ? newSession.last.warning : null);
	let composing = $state(false);

	// Whether the session is still running is re-read every few seconds.
	async function refresh() {
		const v = await fetchSessions();
		const found = v?.sessions.find((x) => x.id === page.params.id);
		if (found) fresh = found;
	}
	onMount(() => {
		let stop = false;
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			await refresh();
			if (!stop) timer = setTimeout(load, POLL_MS);
		};
		timer = setTimeout(load, POLL_MS);
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	});

	const status = $derived(
		s.state === 'alive'
			? { dot: 'bg-success', label: 'Running' }
			: s.state === 'ended'
				? { dot: 'bg-muted-foreground', label: 'Ended' }
				: { dot: 'bg-warning', label: 'Unknown' }
	);
</script>

<svelte:head><title>{sessionLabel(s)} · Sessions · Wheelhouse</title></svelte:head>

<main class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-4 sm:px-6">
	<div class="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 pt-6 pb-4">
		<div class="min-w-0 flex-1">
			<a
				href="/sessions"
				class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				><ArrowLeft class="size-3.5" />Sessions</a
			>
			<h1 class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span class="text-xl font-semibold tracking-tight">{sessionLabel(s)}</span>
				<span class="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
					<span class="size-2 rounded-full {status.dot}" aria-hidden="true"></span>{status.label}
				</span>
				<time
					datetime={s.createdAt}
					title={s.createdAt}
					class="text-xs font-normal text-muted-foreground"
					>started {ago(s.createdAt, live.now)}</time
				>
			</h1>
			<p class="mt-1 truncate font-mono text-xs text-muted-foreground" title={s.dir}>{s.dir}</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			onclick={() => (composing = !composing)}
			aria-expanded={composing}><Send />Hand to Firstmate</Button
		>
	</div>

	{#if warning}
		<div
			class="mb-3 flex shrink-0 items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm"
			role="status"
		>
			<SquareTerminal class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
			<p class="min-w-0 flex-1">{warning}</p>
			<button
				class="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
				aria-label="Dismiss"
				onclick={() => (newSession.last = null)}><X class="size-4" /></button
			>
		</div>
	{/if}

	<SessionHandoff
		session={s}
		bind:composing
		class="mb-3 shrink-0 overflow-hidden rounded-xl border [&>:first-child]:border-t-0"
	/>

	{#if s.state === 'ended'}
		<div
			class="flex flex-1 flex-col items-center justify-center rounded-xl border text-center text-sm text-muted-foreground"
		>
			<SquareTerminal class="size-6 text-sea" aria-hidden="true" />
			<p class="mt-3 font-medium text-foreground">This session has ended.</p>
			<p class="mt-1 max-w-md">
				Anything it wrote is in its scratch directory. You can still hand it to Firstmate.
			</p>
		</div>
	{:else}
		{#key s.id}
			<SessionTerminal id={s.id} token={page.data.sessionToken as string} onclosed={refresh} />
		{/key}
		<div class="mt-2 shrink-0"><AttachHint command={s.attach} /></div>
	{/if}
</main>
