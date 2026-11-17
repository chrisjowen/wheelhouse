<script lang="ts">
	import { mmss, plural } from '$lib/livereview';
	import type { LiveReviewSession } from '$lib/client/livereview.svelte';

	/**
	 * A live review's timeline, under the preview: what the captain said (gold
	 * bars) over what happened on the page (clicks, page changes, typing,
	 * errors), with a line from each remark to what it is about. It fits the
	 * whole session, at least two minutes of it, and moves with the clock.
	 */
	let { session: s }: { session: LiveReviewSession } = $props();

	let width = $state(0);
	const end = $derived(s.elapsed);
	const span = $derived(Math.max(120_000, end * 1.08));
	const x = (t: number) => (width ? (t / span) * width : 0);
	const step = $derived(span > 900_000 ? 120_000 : span > 360_000 ? 60_000 : 30_000);
	const ticks = $derived(Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step));
	const stats = $derived(s.stats());
	const errors = $derived(s.events.filter((e) => e.type === 'error').length);
	const MARK: Record<string, string> = {
		click: 'top-[7px] size-3 -ml-1.5 rounded-full border-2 border-card bg-foreground',
		input: 'top-2 size-2.5 -ml-[5px] rotate-45 rounded-[2px] bg-teal',
		choose: 'top-2 size-2.5 -ml-[5px] rotate-45 rounded-[2px] bg-teal',
		nav: 'top-0.5 h-[22px] w-0.5 -ml-px bg-working',
		start: 'top-0.5 h-[22px] w-0.5 -ml-px bg-working',
		error: 'top-1.5 size-3 -ml-1.5 rotate-45 bg-danger',
		scroll: 'top-[11px] size-1 -ml-0.5 rounded-full bg-muted-foreground/60',
		pause: 'top-0.5 h-[22px] w-0.5 -ml-px bg-muted-foreground'
	};
</script>

<div class="px-0.5 pb-1" data-review-timeline>
	<p class="flex items-baseline gap-3 pb-1">
		<span class="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase"
			>Timeline</span
		>
		<span class="text-xs text-muted-foreground"
			>{plural(stats.remarks, 'remark')} · {plural(stats.clicks, 'click')} · {plural(
				stats.pages,
				'page'
			)}{errors ? ` · ${plural(errors, 'error')}` : ''}</span
		>
	</p>
	<div class="flex gap-2.5">
		<div class="flex w-20 shrink-0 flex-col pt-1 text-[11.5px] text-muted-foreground">
			<span class="flex h-[26px] items-center">You said</span>
			<span class="flex h-[26px] items-center">On the page</span>
		</div>
		<div
			class="relative h-[76px] flex-1 overflow-hidden rounded-lg border bg-card"
			bind:clientWidth={width}
		>
			<svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
				{#each s.remarks as u (u.id)}
					{@const ev = u.anchor ? s.events.find((e) => e.id === u.anchor) : null}
					{#if ev}
						{@const x1 = x((u.t0 + u.t1) / 2)}
						{@const x2 = x(ev.t)}
						<path
							d="M{x1} 22 C {x1} 30, {x2} 28, {x2} 37"
							class="fill-none stroke-sea opacity-60"
							stroke-width="1.2"
						/>
					{/if}
				{/each}
			</svg>
			<div class="absolute inset-x-0 top-1 h-[26px]">
				{#each s.remarks as u (u.id)}
					<span
						class="absolute top-1 h-[18px] min-w-1.5 rounded-[5px] border border-sea bg-sea/30"
						style="left:{x(u.t0)}px;width:{Math.max(6, x(u.t1) - x(u.t0))}px"
						title="{mmss(u.t0)} “{u.text}”"
					></span>
				{/each}
			</div>
			<div class="absolute inset-x-0 top-[30px] h-[26px] border-t border-dashed border-hair">
				{#each s.events as e (e.id)}
					<span
						class="absolute {MARK[e.type] ?? MARK.scroll}"
						style="left:{x(e.t)}px"
						title="{mmss(e.t)} {e.label}{e.page ? ` · ${e.page}` : ''}"
					></span>
				{/each}
			</div>
			<div
				class="absolute inset-x-0 bottom-0 h-4 border-t border-hair font-mono text-[10px] text-muted-foreground"
			>
				{#each ticks as t (t)}
					<span class="absolute top-0.5 -translate-x-1/2" style="left:{x(t)}px">{mmss(t)}</span>
				{/each}
			</div>
			<span
				class="absolute inset-y-0 w-0.5 opacity-70 {s.paused ? 'bg-muted-foreground' : 'bg-danger'}"
				style="left:{x(end)}px"
			></span>
		</div>
	</div>
</div>
