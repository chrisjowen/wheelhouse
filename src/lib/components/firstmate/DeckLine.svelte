<script lang="ts">
	/**
	 * One line on deck: a state icon, what the work is (or the question asked),
	 * its project and age on a single 32px row, with Chat about this on hover or
	 * focus. Selecting the line opens it in place: a task shows what its card
	 * showed (its badges, what it is doing now or its checks strip, its passage,
	 * the time left, its pull request and live preview, Open and Chat about
	 * this); a decision shows the same decision box as the Decisions page
	 * (Agree, Ask me later, Chat about this, the evidence).
	 */
	import {
		Anchor,
		ArrowUpRight,
		Check,
		CircleDashed,
		CircleX,
		GitMerge,
		GitPullRequest,
		Hand,
		Loader,
		MessageSquare,
		MessageSquareText,
		OctagonAlert,
		Unplug,
		Users
	} from '@lucide/svelte';
	import { showsChecks } from '$lib/checks';
	import { ago } from '$lib/format';
	import { decisionHref } from '$lib/handled';
	import {
		DECISION_STATE,
		lineState,
		shortAge,
		type DeckLine,
		type LineIcon,
		type Tone
	} from '$lib/ondeck';
	import { inbox } from '$lib/client/inbox.svelte';
	import CardPreview from '$lib/components/wh/CardPreview.svelte';
	import ChecksStrip from '$lib/components/wh/ChecksStrip.svelte';
	import StageTrack from '$lib/components/wh/StageTrack.svelte';
	import EtaLine from '$lib/components/wh/insights/EtaLine.svelte';
	import OpenDecision from '$lib/components/wh/inbox/OpenDecision.svelte';
	import WhereBadge from '$lib/components/wh/mates/WhereBadge.svelte';
	import type { TaskSummary } from '$lib/types';

	let {
		line,
		now,
		open,
		project,
		dim = false,
		onToggle,
		onChat
	}: {
		line: DeckLine;
		now: number;
		open: boolean;
		/** The work's project: its full name, and the short tag the line shows. */
		project: { name: string; tag: string } | null;
		/** Queued or landed work reads quieter. */
		dim?: boolean;
		onToggle: () => void;
		onChat: (t: TaskSummary) => void;
	} = $props();

	const ICON: Record<LineIcon, typeof Hand> = {
		failed: CircleX,
		stuck: OctagonAlert,
		lost: Unplug,
		merge: GitMerge,
		review: GitPullRequest,
		call: Hand,
		reviewers: Users,
		changes: MessageSquareText,
		firstmate: Anchor,
		queued: CircleDashed,
		landed: Check,
		moving: Loader
	};
	const TEXT: Record<Tone, string> = {
		danger: 'text-danger',
		warning: 'text-warning',
		sea: 'text-sea',
		muted: 'text-muted-foreground',
		busy: 'text-foreground',
		success: 'text-success',
		quiet: 'text-muted-foreground'
	};
	const CHIP: Record<Tone, string> = {
		danger: 'bg-danger/10 text-danger',
		warning: 'bg-warning/10 text-warning',
		sea: 'bg-sea/10 text-sea',
		muted: 'bg-muted text-muted-foreground',
		busy: 'bg-muted text-foreground',
		success: 'bg-success/10 text-success',
		quiet: 'bg-muted text-muted-foreground'
	};

	const state = $derived(line.kind === 'task' ? lineState(line.task) : DECISION_STATE);
	const Icon = $derived(ICON[state.icon]);
	const t = $derived(line.kind === 'task' ? line.task : null);
	const detailId = $derived(`deck-${line.key.replace(/[^\w-]/g, '-')}`);
	// The other half of what the line says: the work under its question, or the question over its work.
	const other = $derived(
		t && line.text !== t.shortTitle
			? t.shortTitle
			: t?.attention?.owner === 'captain' && t.attention.text && t.attention.text !== line.text
				? t.attention.text
				: null
	);
	const nowText = $derived(t ? t.activity?.text || t.summary || t.statusLabel : null);
	const pr = $derived(t ? (t.attention?.url ?? t.pr?.url ?? null) : null);
	const href = $derived(t ? `/tasks/${encodeURIComponent(t.id)}` : null);
	const action =
		'flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';
</script>

<div
	class="group relative flex h-8 items-center rounded-md transition-colors {open
		? 'bg-muted/70'
		: 'hover:bg-muted/50'}"
>
	<button
		type="button"
		data-deck-line
		class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pr-1 pl-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
		aria-expanded={open}
		aria-controls={detailId}
		title={other ? `${line.text} (${other})` : line.text}
		onclick={onToggle}
	>
		{#if state.tone === 'busy'}
			<span
				class="flex size-3.5 shrink-0 items-center justify-center"
				role="img"
				aria-label={state.label}
				><span class="size-1.5 rounded-full bg-foreground motion-safe:animate-pulse"></span></span
			>
		{:else}
			<Icon class="size-3.5 shrink-0 {TEXT[state.tone]}" role="img" aria-label={state.label} />
		{/if}
		<span
			class="min-w-0 flex-1 truncate text-[0.875rem] {dim
				? 'text-muted-foreground'
				: 'text-foreground'}">{line.text}</span
		>
		{#if project}
			<span
				class="max-w-[7rem] shrink-0 truncate text-[0.95rem] leading-none font-semibold tracking-[0.06em] text-muted-foreground [font-variant-caps:all-small-caps]"
				title={project.name}
				data-project-tag>{project.tag}</span
			>
		{/if}
		<span
			class="w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
			title={line.at ? ago(line.at, now) : undefined}>{shortAge(line.at, now)}</span
		>
	</button>
	{#if t}
		<button
			type="button"
			class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring {open
				? 'opacity-100'
				: ''}"
			aria-label="Chat about {t.shortTitle}"
			title="Chat about this"
			onclick={() => onChat(t)}><MessageSquare class="size-3.5" /></button
		>
	{:else if line.kind === 'decision'}
		<a
			href={decisionHref(line.card.id)}
			class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring {open
				? 'opacity-100'
				: ''}"
			aria-label="Chat about this question"
			title="Chat about this"><MessageSquare class="size-3.5" /></a
		>
	{/if}
</div>

{#if open}
	<div
		id={detailId}
		class="mt-0.5 mb-2 ml-[0.85rem] border-l-2 border-hair pr-1 pl-3"
		data-deck-detail
	>
		{#if line.kind === 'decision'}
			<OpenDecision
				card={line.card}
				project={project?.name ?? null}
				{now}
				onLater={() => inbox.later(line.card.id)}
			/>
		{:else if t}
			<div class="flex flex-col gap-2 text-xs">
				<div class="flex flex-wrap items-center gap-1.5">
					<span
						class="flex items-center gap-1 rounded px-1.5 leading-[1.15rem] font-medium {CHIP[
							state.tone
						]}"><Icon class="size-3" aria-hidden="true" />{state.label}</span
					>
					<WhereBadge task={t} />
					{#if project}<span class="text-muted-foreground">{project.name}</span>{/if}
					{#if line.at}<span class="ml-auto text-muted-foreground">{ago(line.at, now)}</span>{/if}
				</div>
				{#if other}<p class="leading-snug text-muted-foreground">{other}</p>{/if}
				{#if showsChecks(t)}
					<ChecksStrip pipeline={t.pipeline} busy={t.busy} size="rail" />
				{:else if nowText && nowText !== line.text}
					<p class="leading-snug text-muted-foreground" data-now>{nowText}</p>
				{/if}
				{#if t.passage.steps.length > 1}<div class="pt-1"><StageTrack task={t} /></div>{/if}
				{#if t.eta}<EtaLine eta={t.eta} />{/if}
				{#if pr}
					<a
						href={pr}
						target="_blank"
						rel="noreferrer"
						class="flex items-start gap-1 break-all text-sea hover:underline"
						><GitPullRequest class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{pr}</a
					>
				{/if}
				{#if t.preview}<div class="-mt-2"><CardPreview task={t} /></div>{/if}
				<div class="-ml-1.5 flex flex-wrap gap-0.5">
					<a {href} class={action}><ArrowUpRight class="size-3.5" aria-hidden="true" />Open</a>
					<button type="button" class="{action} cursor-pointer" onclick={() => onChat(t)}
						><MessageSquare class="size-3.5" aria-hidden="true" />Chat about this</button
					>
				</div>
			</div>
		{/if}
	</div>
{/if}
