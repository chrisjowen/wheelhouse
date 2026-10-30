<script lang="ts">
	import { ACTIVITY_DAYS, dayCounts, type Berth } from '$lib/berths';
	import { ago } from '$lib/format';
	import { completedAt } from '$lib/harbour';
	import type { ProjectLabel } from '$lib/projectnames';
	import type { TaskSummary } from '$lib/types';
	import { ArrowRight, Check, Hand, ShieldAlert, TriangleAlert } from '@lucide/svelte';
	import ActivityPulse from './ActivityPulse.svelte';
	import ProjectStateMark from './ProjectStateMark.svelte';
	import StepTicks from './StepTicks.svelte';

	/**
	 * A project on the Harbour, as a card that answers, top to bottom: is it all right
	 * (one word), does it need me (the first thing waiting on you, else what is stuck),
	 * what is moving and at which step, is work landing, and how busy it has been. The
	 * whole card opens the project's page; its inner links open the work they name.
	 */
	let {
		berth: b,
		label,
		commits,
		now
	}: {
		berth: Berth;
		label: ProjectLabel | undefined;
		commits: number[] | null;
		now: number;
	} = $props();

	const p = $derived(b.project);
	const href = $derived(`/projects/${encodeURIComponent(p.id)}`);
	const task = (t: TaskSummary) => `/tasks/${encodeURIComponent(t.id)}`;
	const move = $derived(b.yourMove[0] ?? null);
	const held = $derived(move ? null : (b.heldUp[0] ?? null));
	// Everything else open, held-up work first, three at most.
	const rest = $derived([...b.heldUp, ...b.moving].filter((t) => t !== held));
	const verb = (t: TaskSummary) =>
		t.attention?.kind === 'decision' ? 'Decide' : t.attention?.approved ? 'Merge' : 'Review';
	const when = (t: TaskSummary | null) => {
		const at = t ? completedAt(t) : null;
		return at === null ? null : ago(new Date(at).toISOString(), now);
	};
	const landedDays = $derived(dayCounts(b.landings, now, ACTIVITY_DAYS));
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const footnote = $derived(
		[
			b.openPullRequests
				? plural(b.openPullRequests, 'open pull request', 'open pull requests')
				: null,
			b.lastActivity === null
				? 'No activity yet'
				: `Last activity ${ago(new Date(b.lastActivity).toISOString(), now)}`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<article
	class="surface relative flex min-w-0 flex-col p-5 transition-colors hover:border-foreground/30"
	aria-labelledby="berth-{p.id}"
	data-project={p.id}
>
	<div class="flex items-start gap-3">
		{#if label}
			<span class="project-tile mt-1.5" data-hue={label.hue} aria-hidden="true"
				>{label.monogram}</span
			>
		{/if}
		<h2
			id="berth-{p.id}"
			class="min-w-0 flex-1 font-display text-[1.4rem] leading-tight font-medium [overflow-wrap:anywhere]"
			title={label?.full ?? p.name}
		>
			<a
				{href}
				class="after:absolute after:inset-0 after:rounded-lg focus-visible:underline focus-visible:outline-none"
				>{#if label?.group}<span class="block font-sans text-xs font-normal text-muted-foreground"
						>{label.group}</span
					>{/if}{label?.label ?? p.name}</a
			>
		</h2>
		<ProjectStateMark state={b.state} />
	</div>

	{#if move}
		<a
			href={task(move)}
			class="relative z-10 mt-4 flex items-start gap-3 rounded-md border border-l-4 border-sea/40 border-l-sea bg-sea/5 px-3 py-2.5 hover:bg-sea/10"
		>
			<Hand class="mt-1 size-4 shrink-0 text-sea" aria-hidden="true" />
			<span class="min-w-0 flex-1">
				<span class="block font-medium">{verb(move)}: {move.shortTitle}</span>
				<span class="block text-xs text-muted-foreground"
					>{move.attention?.text ?? 'Waiting on you.'}{b.yourMove.length > 1
						? ` And ${b.yourMove.length - 1} more.`
						: ''}</span
				>
			</span>
			<ArrowRight class="mt-1 size-4 shrink-0 text-sea" aria-hidden="true" />
		</a>
	{:else if held}
		{@const step = held.passage.steps[held.passage.current]}
		<a
			href={task(held)}
			class="relative z-10 mt-4 flex items-start gap-3 rounded-md border border-l-4 border-danger/40 border-l-danger bg-danger/5 px-3 py-2.5 hover:bg-danger/10"
		>
			<TriangleAlert class="mt-1 size-4 shrink-0 text-danger" aria-hidden="true" />
			<span class="min-w-0 flex-1">
				<span class="block font-medium">{held.shortTitle}</span>
				<span class="line-clamp-2 block text-xs text-muted-foreground"
					>{step?.failed ? `${step.label} failed.` : `${held.statusLabel}.`}{held.summary
						? ` ${held.summary}`
						: ''}</span
				>
			</span>
		</a>
	{:else if p.passage?.problems || p.passage?.needsConsent}
		<a
			href="{href}/passage"
			class="relative z-10 mt-4 flex items-center gap-3 rounded-md border border-l-4 px-3 py-2.5 text-sm {p
				.passage.problems
				? 'border-danger/40 border-l-danger bg-danger/5 hover:bg-danger/10'
				: 'border-sea/40 border-l-sea bg-sea/5 hover:bg-sea/10'}"
		>
			<ShieldAlert
				class="size-4 shrink-0 {p.passage.problems ? 'text-danger' : 'text-sea'}"
				aria-hidden="true"
			/>
			{p.passage.problems ? 'Its passage file has problems.' : 'Its passage checks need enabling.'}
		</a>
	{/if}

	<h3 class="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">Under way</h3>
	{#if rest.length}
		<ul class="mt-1.5 space-y-2">
			{#each rest.slice(0, 3) as t (t.id)}
				<li class="flex items-center justify-between gap-3 text-sm">
					<a href={task(t)} class="relative z-10 min-w-0 truncate hover:underline">{t.shortTitle}</a
					>
					<StepTicks task={t} />
				</li>
			{/each}
		</ul>
	{/if}
	{#if !rest.length || rest.length > 3 || b.queued.length}
		<p class="mt-1.5 text-sm text-muted-foreground">
			{[
				rest.length > 3
					? `${rest.length - 3} more under way.`
					: rest.length
						? null
						: move || held
							? 'Nothing else under way.'
							: 'Nothing under way.',
				b.queued.length ? `${b.queued.length} queued.` : null
			]
				.filter(Boolean)
				.join(' ')}
		</p>
	{/if}

	<p class="mt-4 mb-5 flex items-start gap-2 text-sm">
		<Check class="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
		<span class="min-w-0">
			{#if b.landed.length}
				{b.landed.length} landed this week.
				<span class="text-muted-foreground"
					>Latest: {b.landed[0].shortTitle}, {when(b.landed[0])}.</span
				>
			{:else if b.lastLanded}
				Nothing landed this week.
				<span class="text-muted-foreground"
					>Last: {b.lastLanded.shortTitle}, {when(b.lastLanded)}.</span
				>
			{:else}
				<span class="text-muted-foreground">Nothing has landed yet.</span>
			{/if}
		</span>
	</p>

	<div
		class="mt-auto flex items-center gap-3 border-t border-hair pt-3 text-xs text-muted-foreground"
	>
		<ActivityPulse {commits} landed={landedDays} />
		<span class="ml-auto text-right">{footnote}</span>
	</div>
</article>
