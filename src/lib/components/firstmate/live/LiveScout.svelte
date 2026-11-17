<script lang="ts">
	import { ArrowUpRight, FileText, LoaderCircle, Telescope } from '@lucide/svelte';
	import { liveCall } from '$lib/client/livecall.svelte';

	/**
	 * A scout from a Live mode discussion. As a request: the crew's offer
	 * waiting for the captain's OK, or the scout on its way (asked of
	 * Firstmate, then running as a task). As a report: its gist and a link to
	 * the full report, at the point in the conversation where it came in.
	 */
	let { scoutKey, report = false }: { scoutKey: string; report?: boolean } = $props();

	const s = $derived(liveCall.scout(scoutKey));
	const taskHref = $derived(s?.task ? `/tasks/${encodeURIComponent(s.task)}` : null);

	const LINE: Record<string, string> = {
		offered: 'A scout investigates this and reports back into the conversation.',
		declined: 'Not sent.',
		sending: 'Asking Firstmate for a scout…',
		failed: 'Could not reach Firstmate’s chat to ask for the scout.',
		requested: 'Asked of Firstmate. Waiting for the scout to set off…',
		running: 'Scout under way. Its report comes back here.',
		reported: 'Report in, below.'
	};
</script>

{#if s && report}
	<section
		class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border border-sea/45 bg-card"
		aria-label="Scout report"
		data-live-scout-report
	>
		<header
			class="flex min-w-0 items-center gap-2 border-b border-sea/25 bg-sea/10 px-4 py-2.5 text-sm font-semibold text-sea"
		>
			<FileText class="size-4 shrink-0" aria-hidden="true" />Scout report
			{#if s.task}<span class="ml-auto truncate font-mono text-[0.7rem] font-normal">{s.task}</span
				>{/if}
		</header>
		<div class="bg-paper px-5 py-4 font-reading text-ink">
			<p class="text-[0.8rem] text-muted-foreground">{s.question}</p>
			<p class="mt-2 leading-relaxed">
				{s.summary || 'The report has no summary; open it to read.'}
			</p>
		</div>
		<footer class="flex flex-wrap items-center gap-3 border-t border-hair px-4 py-2.5 text-xs">
			<span class="text-muted-foreground"
				>{s.told
					? 'Brought into the conversation.'
					: liveCall.on
						? 'The crew picks it up when you pause.'
						: 'Came in after the call ended.'}</span
			>
			{#if taskHref}
				<a
					class="ml-auto inline-flex items-center gap-1 font-medium text-sea hover:underline"
					href={taskHref}>Open the report<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
				>
			{/if}
		</footer>
	</section>
{:else if s}
	{@const offered = s.state === 'offered'}
	{@const busy = s.state === 'sending' || s.state === 'requested' || s.state === 'running'}
	<div
		class="w-full max-w-[min(100%,40rem)] overflow-hidden rounded-xl border text-sm {offered || busy
			? 'border-sea/45 bg-card'
			: 'border-hair bg-card/60'}"
		data-live-scout={s.state}
	>
		<header
			class="flex items-center gap-2 px-4 pt-2.5 pb-1 text-xs font-medium tracking-wider uppercase {s.state ===
			'declined'
				? 'text-muted-foreground'
				: 'text-sea'}"
		>
			<Telescope class="size-3.5" aria-hidden="true" />Scout
			<span class="font-normal tracking-normal normal-case"
				>· {s.asked ? 'you asked for one' : 'suggested by the crew'}</span
			>
		</header>
		<p class="px-4 pb-2.5 leading-snug {s.state === 'declined' ? 'text-muted-foreground' : ''}">
			{s.question}
		</p>
		<footer
			class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair px-4 py-2 {s.state ===
			'failed'
				? 'bg-danger/5'
				: 'bg-muted/30'}"
		>
			<span
				class="flex min-w-[13rem] flex-1 items-center gap-1.5 text-xs {s.state === 'failed'
					? 'text-danger'
					: 'text-muted-foreground'}"
				role="status"
			>
				{#if busy}<LoaderCircle
						class="size-3.5 shrink-0 animate-spin text-sea"
						aria-hidden="true"
					/>{/if}{LINE[s.state]}
				{#if s.state === 'running' && s.statusLabel}<span
						class="rounded-full border px-1.5 text-[0.7rem]">{s.statusLabel}</span
					>{/if}
			</span>
			{#if offered || s.state === 'failed'}
				<span class="ml-auto flex shrink-0 gap-2">
					{#if offered}
						<button
							class="inline-flex h-8 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
							onclick={() => liveCall.declineScout(scoutKey)}>Not now</button
						>
					{/if}
					<button
						class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-sea px-3 text-xs font-medium text-on-accent"
						onclick={() => liveCall.approveScout(scoutKey)}
						><Telescope class="size-3.5" aria-hidden="true" />{offered
							? 'Send a scout'
							: 'Try again'}</button
					>
				</span>
			{:else if taskHref}
				<a
					class="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-xs text-sea hover:underline"
					href={taskHref}>{s.task}<ArrowUpRight class="size-3" aria-hidden="true" /></a
				>
			{/if}
		</footer>
	</div>
{/if}
