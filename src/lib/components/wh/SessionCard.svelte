<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import { sessionLabel } from '$lib/sessions';
	import type { SessionSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import SessionHandoff from './SessionHandoff.svelte';
	import { Send, SquareTerminal } from '@lucide/svelte';

	let { session: s }: { session: SessionSummary } = $props();

	let composing = $state(false);
	const href = $derived(`/sessions/${encodeURIComponent(s.id)}`);

	const status = $derived(
		s.state === 'alive'
			? { dot: 'bg-success', label: 'Running' }
			: s.state === 'ended'
				? { dot: 'bg-muted-foreground', label: 'Ended' }
				: { dot: 'bg-warning', label: 'Unknown' }
	);
</script>

<li class="rounded-xl border">
	<div class="flex flex-wrap items-start gap-x-6 gap-y-3 p-4">
		<div class="min-w-0 flex-1">
			<p class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<a {href} class="font-medium hover:underline">{sessionLabel(s)}</a>
				<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
					<span class="size-2 rounded-full {status.dot}" aria-hidden="true"></span>{status.label}
				</span>
				<time datetime={s.createdAt} title={s.createdAt} class="text-xs text-muted-foreground"
					>started {ago(s.createdAt, live.now)}</time
				>
			</p>
			{#if s.prompt}
				<p class="mt-1 line-clamp-2 text-sm break-words text-muted-foreground">{s.prompt}</p>
			{/if}
			<p class="mt-2 truncate font-mono text-xs text-muted-foreground" title={s.dir}>{s.dir}</p>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if s.state !== 'ended'}
				<Button variant="outline" size="sm" {href} title="Use it here, in the browser"
					><SquareTerminal />Open</Button
				>
			{/if}
			<Button
				variant="outline"
				size="sm"
				onclick={() => (composing = !composing)}
				aria-expanded={composing}><Send />Hand to Firstmate</Button
			>
		</div>
	</div>
	<SessionHandoff session={s} bind:composing />
</li>
