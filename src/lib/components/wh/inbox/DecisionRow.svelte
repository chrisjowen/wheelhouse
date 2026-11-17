<script lang="ts">
	/**
	 * One open decision as a line, on the Decisions page and in the Decisions
	 * slide-out's list: what kind it is, its question, its project and task, and
	 * how long it has waited, marked by where it stands (waiting on the captain,
	 * followed up in the chat, or Firstmate handling it). Selecting it opens the
	 * decision in full (`onOpen`); `onAgree`, where given, sends Firstmate's
	 * recommended answer from the line, the same answer the full card sends.
	 */
	import {
		ChevronRight,
		Check,
		GitPullRequest,
		Hand,
		MessagesSquare,
		MonitorPlay,
		OctagonAlert,
		Scale
	} from '@lucide/svelte';
	import { ago } from '$lib/format';
	import { cardForm, recommendedOption } from '$lib/decisionform';
	import { KIND_LABEL, STANDING_LABEL, standing } from '$lib/decisionhome';
	import type { InboxCard, InboxKind } from '$lib/inbox';
	import { shortAge } from '$lib/ondeck';

	let {
		card,
		project = null,
		now,
		active = false,
		grouped = false,
		error = null,
		onOpen,
		onAgree
	}: {
		card: InboxCard;
		project?: string | null;
		now: number;
		active?: boolean;
		/** Under a heading that already says where it stands. */
		grouped?: boolean;
		error?: string | null;
		onOpen: () => void;
		onAgree?: () => void;
	} = $props();

	const ICON: Record<InboxKind, typeof Hand> = {
		hold: Hand,
		merge: GitPullRequest,
		preview: MonitorPlay,
		decision: Hand,
		blocked: OctagonAlert,
		review: Scale
	};
	const Icon = $derived(card.following ? MessagesSquare : ICON[card.kind]);
	const where = $derived(standing(card));
	const agreeTo = $derived(onAgree ? recommendedOption(cardForm(card)) : null);
	const norm = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	// The task, unless the question already says it (a held call is often its task's title).
	const task = $derived.by(() => {
		const t = card.secondMate?.taskTitle ?? card.taskTitle;
		const n = norm(t);
		const q = norm(card.title);
		return n && (q.includes(n.slice(0, 32)) || n.startsWith(q.slice(0, 32))) ? null : t;
	});
</script>

<div
	id="row-{card.id}"
	class="group relative flex items-stretch rounded-lg border bg-card transition-colors hover:border-foreground/20 {active
		? 'shadow-[0_0_0_2px_var(--ring)]'
		: ''}"
	data-decision-row={where}
>
	<span
		class="absolute inset-y-2 left-0 w-[3px] rounded-r-full {where === 'waiting'
			? 'bg-sea'
			: where === 'following'
				? 'bg-sea/40'
				: 'bg-brass/70'}"
		aria-hidden="true"
	></span>
	<button
		type="button"
		class="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg py-3 pr-2 pl-4 text-left focus-visible:outline-2 focus-visible:outline-ring sm:pl-5"
		aria-haspopup="dialog"
		onclick={onOpen}
		data-open-decision-row
	>
		<span
			class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full {where === 'waiting'
				? 'bg-sea/10 text-sea'
				: 'bg-muted text-foreground/70'}"
			aria-hidden="true"><Icon class="size-4" /></span
		>
		<span class="min-w-0 flex-1">
			<span
				class="line-clamp-2 text-[0.95rem] leading-snug font-medium {where === 'firstmate'
					? 'text-foreground/85'
					: 'text-foreground'}">{card.title}</span
			>
			<span
				class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
			>
				{#if project}<span
						class="rounded-sm border px-1 text-[0.8rem] leading-[0.95rem] font-semibold tracking-[0.08em] [font-variant-caps:all-small-caps]"
						>{project}</span
					>{/if}
				<span class="font-medium text-foreground/75">{KIND_LABEL[card.kind]}</span>
				{#if task}<span aria-hidden="true">·</span>
					<span class="max-w-[22rem] min-w-0 truncate">{task}</span>{/if}
				{#if card.askedAt}<span aria-hidden="true">·</span><span
						class="tabular-nums"
						title="Asked {ago(card.askedAt, now)}">waiting {shortAge(card.askedAt, now)}</span
					>{/if}
			</span>
			{#if !grouped || error}
				<span
					class="mt-1 block text-xs {where === 'waiting'
						? 'font-medium text-sea'
						: 'text-muted-foreground'}"
					>{#if !grouped}{STANDING_LABEL[where]}{/if}{#if error}<span
							class="font-normal text-danger">{grouped ? '' : ' · '}Not sent: {error}</span
						>{/if}</span
				>
			{/if}
		</span>
		<ChevronRight
			class="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
			aria-hidden="true"
		/>
	</button>
	{#if agreeTo && onAgree}
		<div class="flex shrink-0 items-center border-l border-hair/70 px-2 max-sm:hidden">
			<button
				type="button"
				class="inline-flex h-9 max-w-[12rem] cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
				title="Send Firstmate's recommendation: {agreeTo.label}"
				onclick={onAgree}
				data-agree
				><Check class="size-3.5 shrink-0 text-sea" aria-hidden="true" /><span class="truncate"
					>{agreeTo.label}</span
				></button
			>
		</div>
	{/if}
</div>
