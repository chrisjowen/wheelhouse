<script lang="ts">
	/**
	 * The home page's right-hand rail: what needs the captain first (failed
	 * steps, then reviews and decisions), then the work in play, then what is
	 * up next and what landed. Every card links to its task page and can start
	 * a message about the task ("Chat about this").
	 */
	import {
		Anchor,
		ArrowRight,
		ArrowUpRight,
		Check,
		ChevronRight,
		CircleX,
		GitPullRequest,
		Hand,
		MessageSquare,
		MessageSquareText,
		OctagonAlert,
		Unplug,
		X
	} from '@lucide/svelte';
	import { harbour, headline } from '$lib/harbour';
	import ChecksStrip from '$lib/components/wh/ChecksStrip.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import { showsChecks } from '$lib/checks';
	import type { Project, TaskSummary } from '$lib/types';
	import { composerBus } from './bus.svelte';

	let {
		tasks,
		projects,
		now,
		onClose,
		onChat
	}: {
		tasks: TaskSummary[];
		projects: Project[];
		now: number;
		onClose?: () => void;
		onChat?: () => void;
	} = $props();

	const h = $derived(harbour(tasks, now));
	const failedIds = $derived(new Set(h.stepFailed.map((t) => t.id)));
	const failed = $derived(h.stepFailed.filter((t) => !h.needsYou.includes(t)));
	const underWay = $derived(
		[...h.waitingOnFirstmate, ...h.underWay].filter((t) => !failedIds.has(t.id))
	);
	let showQueued = $state(false);
	let showLanded = $state(false);

	const projectName = (t: TaskSummary) =>
		projects.find((p) => p.id === t.projectId)?.name ??
		(t.projectId === 'unassigned' ? null : t.projectId);
	const href = (t: TaskSummary) => `/tasks/${encodeURIComponent(t.id)}`;
	const nowText = (t: TaskSummary) => t.activity?.text || t.summary || t.statusLabel;
	const prOf = (t: TaskSummary) => t.attention?.url ?? t.pr?.url ?? null;

	type Tone = 'danger' | 'warning' | 'sea' | 'muted';
	type Problem = { label: string; icon: typeof Hand; tone: Tone };
	/** The one problem badge a card carries: icon plus words, never colour alone. */
	function problem(t: TaskSummary): Problem | null {
		const step = t.passage.steps[t.passage.current];
		if (step?.failed) return { label: `${step.label} failed`, icon: CircleX, tone: 'danger' };
		if (t.status === 'failed') return { label: 'Failed', icon: CircleX, tone: 'danger' };
		if (t.status === 'blocked') return { label: 'Stuck', icon: OctagonAlert, tone: 'danger' };
		if (t.status === 'lost' || t.status === 'unknown')
			return { label: 'Not responding', icon: Unplug, tone: 'warning' };
		if (t.attention?.owner === 'captain')
			return t.attention.kind === 'review'
				? { label: 'Your review', icon: GitPullRequest, tone: 'sea' }
				: { label: 'Your call', icon: Hand, tone: 'sea' };
		if (t.addressingReview)
			return { label: 'Addressing your review', icon: MessageSquareText, tone: 'muted' };
		if (t.status === 'with-firstmate')
			return { label: 'Firstmate deciding', icon: Anchor, tone: 'muted' };
		return null;
	}
	const TONE: Record<Tone, string> = {
		danger: 'bg-danger/10 text-danger',
		warning: 'bg-warning/10 text-warning',
		sea: 'bg-sea/10 text-sea',
		muted: 'bg-muted text-muted-foreground'
	};
	const EDGE: Record<Tone, string> = {
		danger: 'border-l-danger',
		warning: 'border-l-warning',
		sea: 'border-l-sea',
		muted: 'border-l-border'
	};

	function chat(t: TaskSummary) {
		composerBus.pending = {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: projectName(t),
			url: null
		};
		onChat?.();
	}
</script>

{#snippet card(t: TaskSummary, ask: string | null)}
	{@const p = problem(t)}
	{@const pr = prOf(t)}
	{@const Icon = p?.icon}
	<li
		class="rounded-lg border border-l-[3px] bg-card px-3 pt-2.5 pb-1.5 {p
			? EDGE[p.tone]
			: 'border-l-border'}"
	>
		<div class="flex flex-wrap items-center gap-1.5">
			{#if projectName(t)}
				<span
					class="rounded border px-1.5 font-mono text-[10.5px] leading-[1.15rem] text-muted-foreground"
					>{projectName(t)}</span
				>
			{/if}
			{#if p && Icon}
				<span
					class="flex items-center gap-1 rounded px-1.5 text-[11px] leading-[1.15rem] font-medium {TONE[
						p.tone
					]}"><Icon class="size-3" aria-hidden="true" />{p.label}</span
				>
			{:else if t.busy}
				<span class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
					><span class="size-1.5 animate-pulse rounded-full bg-sea" aria-hidden="true"
					></span>Working</span
				>
			{/if}
		</div>
		<a
			href={href(t)}
			class="mt-1.5 line-clamp-2 block text-sm leading-snug font-medium hover:underline"
			>{ask ?? t.shortTitle}</a
		>
		{#if ask}
			<p class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{t.shortTitle}</p>
		{/if}
		{#if showsChecks(t)}
			<!-- In the checks stage the strip and its line say what is happening now (as on Harbour). -->
			<div class="mt-1.5"><ChecksStrip pipeline={t.pipeline} busy={t.busy} size="rail" /></div>
		{:else if !ask}
			<p class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{nowText(t)}</p>
		{/if}
		{#if pr}
			<a
				href={pr}
				target="_blank"
				rel="noreferrer"
				class="mt-1 block text-xs break-all text-sea hover:underline">{pr}</a
			>
		{/if}
		{#if t.passage.steps.length > 1}
			<div class="mt-2.5"><StageTrack task={t} /></div>
		{/if}
		<div class="mt-1.5 -mr-1.5 flex justify-end gap-0.5">
			<a
				href={href(t)}
				class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				><ArrowUpRight class="size-3.5" />Open</a
			>
			<button
				class="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => chat(t)}><MessageSquare class="size-3.5" />Chat about this</button
			>
		</div>
	</li>
{/snippet}

<aside class="flex h-full min-h-0 flex-col" aria-label="Tasks and decisions">
	<div class="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm">
		<span class="font-medium">In play</span>
		{#if onClose}
			<button
				class="-mr-2 ml-auto flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
				onclick={onClose}><X class="size-4" /></button
			>
		{/if}
	</div>

	<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
		<p class="mb-5 text-sm leading-relaxed text-muted-foreground">{headline(h)}</p>

		<h2 class="mb-2 text-xs font-medium text-muted-foreground">Waiting on you</h2>
		{#if failed.length || h.needsYou.length}
			<ul class="mb-6 flex flex-col gap-2">
				{#each failed as t (t.id)}
					{@render card(t, `${t.passage.steps[t.passage.current].label} failed: ${t.shortTitle}`)}
				{/each}
				{#each h.needsYou as t (t.id)}
					{@render card(t, t.attention?.text || null)}
				{/each}
			</ul>
		{:else}
			<p class="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
				<Check class="size-4 text-success" />Nothing needs you right now.
			</p>
		{/if}

		<h2 class="mb-2 text-xs font-medium text-muted-foreground">Under way</h2>
		{#if underWay.length}
			<ul class="mb-6 flex flex-col gap-2">
				{#each underWay as t (t.id)}
					{@render card(t, null)}
				{/each}
			</ul>
		{:else}
			<p class="mb-6 text-sm text-muted-foreground">Nothing under way.</p>
		{/if}

		{#if h.queued.length}
			<button
				class="mb-2 flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
				aria-expanded={showQueued}
				onclick={() => (showQueued = !showQueued)}
			>
				Up next · {h.queued.length}
				<ChevronRight class="size-3.5 transition-transform {showQueued ? 'rotate-90' : ''}" />
			</button>
			{#if showQueued}
				<ul class="mb-4 flex flex-col">
					{#each h.queued as t (t.id)}
						<li>
							<a
								href={href(t)}
								class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
								>{#if projectName(t)}<span
										class="shrink-0 rounded border px-1 font-mono text-[10px] leading-4"
										>{projectName(t)}</span
									>{/if}<span class="truncate">{t.shortTitle}</span></a
							>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if h.landedRecent.length}
			<button
				class="mb-2 flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
				aria-expanded={showLanded}
				onclick={() => (showLanded = !showLanded)}
			>
				Landed in the last day · {h.landedRecent.length}
				<ChevronRight class="size-3.5 transition-transform {showLanded ? 'rotate-90' : ''}" />
			</button>
			{#if showLanded}
				<ul class="mb-4 flex flex-col">
					{#each h.landedRecent as t (t.id)}
						<li>
							<a
								href={href(t)}
								class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
								><Check
									class="size-3.5 shrink-0 text-success"
									aria-label="Landed"
								/>{#if projectName(t)}<span
										class="shrink-0 rounded border px-1 font-mono text-[10px] leading-4"
										>{projectName(t)}</span
									>{/if}<span class="truncate">{t.shortTitle}</span></a
							>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<a
			href="/harbour"
			class="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
			>Open the full board in Harbour <ArrowRight class="size-3.5" /></a
		>
	</div>
</aside>
