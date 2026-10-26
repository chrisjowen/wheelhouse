<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { crossfade, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { SvelteMap } from 'svelte/reactivity';
	import { clock } from '$lib/format';
	import {
		laneLabel,
		laneMap,
		moves as movesOf,
		radar,
		SIGNAL_LABEL,
		stay,
		type Blip,
		type Lane,
		type Move,
		type Signal
	} from '$lib/radar';
	import type { Project, TaskSummary } from '$lib/types';
	import { ArrowRight } from '@lucide/svelte';

	/**
	 * The fleet radar: one dot per task in lanes from Queued to Landed. Dots move
	 * between lanes as the live fleet read changes (the page's one /api/events
	 * stream; this opens no connection of its own), pulse while the worker is busy,
	 * turn amber when the captain is needed and red when stuck. Hover, focus or tap
	 * a dot for its card. Under prefers-reduced-motion nothing moves or pulses.
	 */
	let {
		tasks,
		projects,
		now,
		connection = 'open'
	}: {
		tasks: TaskSummary[];
		projects: Project[];
		now: number;
		connection?: 'connecting' | 'open' | 'lost';
	} = $props();

	const r = $derived(radar(tasks, now));
	const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

	let reduced = $state(false);
	onMount(() => {
		const q = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = q.matches;
		const on = () => (reduced = q.matches);
		q.addEventListener('change', on);
		return () => q.removeEventListener('change', on);
	});
	const [send, receive] = crossfade({
		duration: () => (reduced ? 0 : 700),
		fallback: (node) => fade(node, { duration: reduced ? 0 : 400 })
	});

	// What this page saw happen: when each dot moved lane, and the latest moves.
	const entered = new SvelteMap<string, number>();
	let log = $state<Move[]>([]);
	let last: Map<string, Lane> | null = null;
	$effect(() => {
		const next = r;
		untrack(() => {
			const at = Date.now();
			const moved = movesOf(last, next, at);
			for (const m of moved) entered.set(m.id, at);
			if (moved.length) log = [...moved.toReversed(), ...log].slice(0, 6);
			last = laneMap(next);
		});
	});
	const sinceOf = (b: Blip) => entered.get(b.id) ?? b.since;

	// The card: what the pointer is over (or what has focus), else the dot tapped.
	let pinned = $state<string | null>(null);
	let hovered = $state<string | null>(null);
	let leaving: ReturnType<typeof setTimeout> | null = null;
	const shown = $derived.by(() => {
		const id = hovered ?? pinned;
		return id ? (r.lanes.flatMap((l) => l.blips).find((b) => b.id === id) ?? null) : null;
	});
	function hover(id: string) {
		if (leaving) clearTimeout(leaving);
		leaving = null;
		hovered = id;
	}
	function unhover() {
		if (leaving) clearTimeout(leaving);
		leaving = setTimeout(() => (hovered = null), 160);
	}

	// On wide screens the card floats under its dot, inside the board; narrow ones show it below.
	let board = $state<HTMLElement | null>(null);
	let at = $state<{ left: number; top: number } | null>(null);
	$effect(() => {
		const id = shown?.id;
		void r;
		if (!id || !board) return void (at = null);
		const place = () => {
			const dot = board?.querySelector<HTMLElement>(`[data-blip="${CSS.escape(id)}"]`);
			if (!dot || !board) return;
			const b = board.getBoundingClientRect();
			const d = dot.getBoundingClientRect();
			const width = Math.min(320, b.width);
			const left = Math.max(
				0,
				Math.min(d.left - b.left + d.width / 2 - width / 2, b.width - width)
			);
			at = { left, top: d.bottom - b.top + 6 };
		};
		place();
		// A dot that just moved lands after its transition.
		const t = setTimeout(place, reduced ? 0 : 750);
		return () => clearTimeout(t);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			pinned = null;
			hovered = null;
		}
	}
	function onclickOutside(e: MouseEvent) {
		if (!(e.target as HTMLElement | null)?.closest?.('[data-blip], [data-radar-card]'))
			pinned = null;
	}

	const SHAPE: Record<Signal, string> = {
		busy: 'rounded-full bg-sea',
		idle: 'rounded-full border-2 border-sea bg-card',
		you: 'rounded-full bg-amber ring-[3px] ring-amber/35',
		stuck: 'rotate-45 rounded-[2px] bg-danger',
		firstmate: 'rounded-full border-2 border-brass bg-card',
		landed: 'rounded-full bg-success'
	};
	const LEGEND: Signal[] = ['busy', 'idle', 'you', 'stuck', 'firstmate', 'landed'];
	const TEXT: Record<Signal, string> = {
		busy: 'text-sea',
		idle: 'text-muted-foreground',
		you: 'text-warning',
		stuck: 'text-danger',
		firstmate: 'text-muted-foreground',
		landed: 'text-success'
	};

	const total = $derived(r.lanes.reduce((n, l) => n + l.blips.length, 0));
	const summary = $derived.by(() => {
		const c = r.counts;
		const parts = [
			c.busy && `${c.busy} busy`,
			c.you && `${c.you} waiting on you`,
			c.stuck && `${c.stuck} stuck`,
			c.firstmate && `${c.firstmate} with Firstmate`,
			c.landed && `${c.landed} landed in the last day`
		].filter(Boolean);
		return parts.length ? parts.join(', ') : 'Nothing on the radar';
	});
	const latest = $derived(log[0] ?? null);
</script>

<svelte:window {onkeydown} onclick={onclickOutside} />

{#snippet dot(signal: Signal, size = 'size-3.5')}
	<span class="relative inline-flex shrink-0 {size}" aria-hidden="true">
		{#if signal === 'busy'}
			<span class="radar-ping absolute inset-0 rounded-full bg-sea"></span>
		{/if}
		<span class="relative block size-full {SHAPE[signal]}"></span>
	</span>
{/snippet}

<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
	<p class="text-sm text-muted-foreground">
		<span class="text-foreground">{summary}.</span>
		{#if r.landedOlder}
			{r.landedOlder} landed earlier {r.landedOlder === 1 ? 'is' : 'are'} off the radar.
		{/if}
	</p>
	<p class="flex items-center gap-2 text-sm text-muted-foreground" aria-live="off">
		<span
			class="size-2 rounded-full {connection === 'open'
				? 'bg-success'
				: connection === 'lost'
					? 'bg-danger'
					: 'bg-warning'}"
			aria-hidden="true"
		></span>
		{connection === 'open'
			? 'Live'
			: connection === 'lost'
				? 'Lost contact with Wheelhouse'
				: 'Reconnecting…'}
	</p>
</div>

<ul class="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-label="Key">
	{#each LEGEND as s (s)}
		<li class="flex items-center gap-2">{@render dot(s, 'size-3')}{SIGNAL_LABEL[s]}</li>
	{/each}
</ul>

<!-- Lanes sit side by side only when the board itself is wide enough for five readable headers. -->
<div bind:this={board} class="@container relative mt-5">
	<ol
		class="grid overflow-hidden rounded-md border border-hair @4xl:grid-cols-5"
		aria-label="Fleet radar, {total} {total === 1 ? 'task' : 'tasks'}"
	>
		{#each r.lanes as lane, i (lane.key)}
			<li
				class="radar-lane flex min-w-0 gap-3 border-t border-hair p-3 first:border-t-0 @4xl:flex-col @4xl:border-t-0 @4xl:border-l @4xl:first:border-l-0"
				aria-label="{lane.label}, {lane.blips.length}"
			>
				<div class="w-[8.5rem] shrink-0 @4xl:w-auto">
					<h3 class="radar-lane-label truncate">
						<span class="tabular text-brass" aria-hidden="true">{i + 1}</span>
						{lane.label}
					</h3>
					<p class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
						<span
							class="tabular rounded-full bg-muted px-1.5 leading-5 font-medium text-foreground"
							aria-hidden="true">{lane.blips.length}</span
						>
						<span class="min-w-0">{lane.hint}</span>
					</p>
				</div>
				<ul
					class="flex min-h-14 flex-1 flex-wrap content-start gap-x-1 gap-y-2 @4xl:min-h-[max(16rem,calc(100dvh-22rem))]"
				>
					{#each lane.blips as b (b.id)}
						<li
							class="w-[6.25rem]"
							style="opacity: {b.opacity}"
							in:receive={{ key: b.id }}
							out:send={{ key: b.id }}
							animate:flip={{ duration: reduced ? 0 : 500 }}
						>
							<button
								type="button"
								data-blip={b.id}
								class="flex w-full flex-col items-center gap-1.5 rounded-md px-1 py-1.5 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring {shown?.id ===
								b.id
									? 'bg-muted'
									: ''}"
								aria-label="{b.task.shortTitle}: {lane.label}, {SIGNAL_LABEL[
									b.signal
								].toLowerCase()}, for {stay(sinceOf(b), now)}"
								aria-expanded={shown?.id === b.id}
								onpointerenter={(e) => e.pointerType === 'mouse' && hover(b.id)}
								onpointerleave={(e) => e.pointerType === 'mouse' && unhover()}
								onfocus={() => hover(b.id)}
								onblur={unhover}
								onclick={() => (pinned = pinned === b.id ? null : b.id)}
							>
								{@render dot(b.signal, 'size-4')}
								<span class="line-clamp-2 w-full text-center text-xs leading-tight break-words">
									{b.task.shortTitle}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ol>

	{#if shown}
		{@const t = shown.task}
		{@const step = t.passage.steps[t.passage.current]}
		<div
			data-radar-card
			role="region"
			aria-label="{t.shortTitle} details"
			class="z-10 mt-3 rounded-md border border-hair bg-popover p-4 text-popover-foreground shadow-lg @4xl:absolute @4xl:mt-0 @4xl:w-80"
			style={at ? `left: ${at.left}px; top: ${at.top}px` : undefined}
			onpointerenter={() => hover(shown.id)}
			onpointerleave={unhover}
		>
			<p class="text-xs tracking-wide text-muted-foreground uppercase">
				{projectName(t.projectId)}
			</p>
			<p class="mt-1 leading-snug font-medium">{t.shortTitle}</p>
			<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
				<dt class="text-muted-foreground">Step</dt>
				<dd>{step?.label ?? laneLabel(shown.lane)}{step?.failed ? ', failed' : ''}</dd>
				<dt class="text-muted-foreground">In step</dt>
				<dd class="tabular">{stay(sinceOf(shown), now)}</dd>
				<dt class="text-muted-foreground">State</dt>
				<dd class="flex items-center gap-2 {TEXT[shown.signal]}">
					{@render dot(shown.signal, 'size-2.5')}{SIGNAL_LABEL[shown.signal]}
				</dd>
			</dl>
			{#if t.attention?.owner === 'captain' || t.activity || t.summary}
				<p class="mt-3 text-sm text-muted-foreground">
					{t.attention?.owner === 'captain' ? t.attention.text : (t.activity?.text ?? t.summary)}
				</p>
			{/if}
			<a
				href="/tasks/{encodeURIComponent(t.id)}"
				class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-sea hover:underline"
				>Open the task<ArrowRight class="size-4" aria-hidden="true" /></a
			>
		</div>
	{/if}
</div>

<section class="mt-6" aria-labelledby="radar-log">
	<h3 id="radar-log" class="section-label text-base">Just moved</h3>
	{#if log.length}
		<ol class="mt-2 space-y-1 text-sm">
			{#each log as m (`${m.id}-${m.at}`)}
				<li class="flex gap-3" in:fade={{ duration: reduced ? 0 : 300 }}>
					<span class="tabular w-12 shrink-0 text-muted-foreground"
						>{clock(new Date(m.at).toISOString())}</span
					>
					<span class="min-w-0 truncate"
						><span class="font-medium">{m.title}</span>
						{m.from
							? `${laneLabel(m.from)} → ${laneLabel(m.to)}`
							: `joined ${laneLabel(m.to)}`}</span
					>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="mt-2 text-sm text-muted-foreground">
			Moves show here as they happen while this page is open.
		</p>
	{/if}
	<p class="sr-only" aria-live="polite">
		{latest ? `${latest.title} ${latest.from ? 'moved to' : 'joined'} ${laneLabel(latest.to)}` : ''}
	</p>
</section>

<style>
	.radar-lane-label {
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		font-variant-caps: all-small-caps;
	}
	.radar-ping {
		animation: radar-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
	@keyframes radar-ping {
		0% {
			transform: scale(1);
			opacity: 0.55;
		}
		80%,
		100% {
			transform: scale(2.4);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.radar-ping {
			animation: none;
			opacity: 0;
		}
	}
</style>
