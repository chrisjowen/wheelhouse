<script lang="ts">
	/**
	 * Focus mode: the whole app as one quiet screen, for the calls alone. What
	 * needs the captain shows one card at a time, in the order it arrived, with
	 * the rest peeking behind and a pager (← and → too); each is answered right
	 * there, with the same card On deck draws (ChatDecision). A new call joins
	 * the end, marked New, and never takes the place of the one being read;
	 * after an answer the first call not seen yet comes forward. A call the
	 * captain saw that cleared itself stays, saying so, until put away. With
	 * nothing waiting the screen is almost empty: the calm mark (HelmMark),
	 * "What shall we work on?", a box to tell Firstmate (FocusComposer) and
	 * three quick starts; with calls waiting the mark sits small beside "With
	 * you" and the box stays at the foot. Progress is one calm line (CalmLine). The header's project picker
	 * narrows it to one project; the calls elsewhere wait behind a line saying
	 * how many. The header's Focus switch brings the full app back.
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Bug, ChevronLeft, ChevronRight, Code, FileText } from '@lucide/svelte';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { calls } from '$lib/client/calls.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { calmOf, inArrivalOrder, inFront, isSeen } from '$lib/calls';
	import { openDecision } from '$lib/chat/decisions';
	import { projectLabels } from '$lib/projectnames';
	import type { InboxCard, InboxView } from '$lib/inbox';
	import ChatDecision from '$lib/components/firstmate/ChatDecision.svelte';
	import ClearedCall from '$lib/components/wh/inbox/ClearedCall.svelte';
	import CalmLine from './CalmLine.svelte';
	import FocusComposer from './FocusComposer.svelte';
	import HelmMark from './HelmMark.svelte';
	import { phone } from '$lib/client/phone.svelte';

	const seed = $derived(page.data.inbox as InboxView | undefined);
	const fleet = $derived(currentFleet());
	const scope = $derived(page.url.searchParams.get('project'));
	const inScope = (c: Pick<InboxCard, 'projectId'>) => !scope || c.projectId === scope;

	const waiting = $derived(calls.waiting(live.now, seed));
	const cleared = $derived(calls.cleared.filter((c) => inScope(c.card)));
	// The line: what waits, and the calls seen that cleared themselves, each where it arrived.
	const line = $derived(
		inArrivalOrder([...waiting.filter(inScope), ...cleared.map((c) => c.card)])
	);
	const elsewhere = $derived(waiting.filter((c) => !inScope(c)).length);
	// The mark moves only while there is work going on: Firstmate mid-turn, or a busy worker.
	const active = $derived(
		firstmateChat.working || (fleet?.tasks ?? []).some((t) => t.busy && t.status !== 'landed')
	);

	let chosen = $state<string | null>(null);
	const front = $derived(inFront(line, chosen, calls.seen));
	// Whatever is in front is held there: a call arriving later never moves it.
	$effect(() => {
		if (front !== chosen) chosen = front;
	});
	// The header's count (or the chat's pointer) brings a call forward.
	$effect(() => {
		const id = calls.jump;
		if (!id) return;
		if (line.some((c) => c.id === id)) chosen = id;
		calls.jump = null;
	});
	const index = $derived(line.findIndex((c) => c.id === front));
	const card = $derived(index >= 0 ? line[index] : null);
	const clearedHere = $derived(card ? (cleared.find((c) => c.card.id === card.id) ?? null) : null);
	const unseenBefore = $derived(line.slice(0, Math.max(index, 0)).some((c) => unseenCall(c)));
	const unseenAfter = $derived(line.slice(index + 1).some((c) => unseenCall(c)));
	function unseenCall(c: InboxCard) {
		return waiting.some((w) => w.id === c.id) && !isSeen(calls.seen, c);
	}

	function page_(by: number) {
		const next = line[index + by];
		if (next) chosen = next.id;
	}
	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			page_(e.key === 'ArrowRight' ? 1 : -1);
		}
	}

	const labels = $derived(projectLabels(fleet?.projects ?? [], aliases.names));
	const projectName = (id: string | null) =>
		!id || id === 'unassigned'
			? null
			: (labels.get(id)?.label ?? fleet?.projects.find((p) => p.id === id)?.name ?? id);
	const calm = $derived(
		calmOf(
			(fleet?.tasks ?? []).filter((t) => !scope || t.projectId === scope),
			live.now
		)
	);

	/** Out of focus mode, to the full app (a link from the card is followed). */
	const leave = () => calls.setFocus(false);
	const showAll = () => void goto('/', { noScroll: true, keepFocus: true });

	// ---- telling Firstmate something: the box, and quick starts that begin a message ----
	let draft = $state('');
	let composer = $state<ReturnType<typeof FocusComposer> | null>(null);
	const STARTS = [
		{ label: 'Plan a feature', icon: FileText, words: 'Plan a feature: ' },
		{ label: 'Investigate an issue', icon: Bug, words: 'Investigate an issue: ' },
		{ label: 'Review a PR', icon: Code, words: 'Review a pull request: ' }
	];
	function begin(words: string) {
		draft = words;
		void tick().then(() => composer?.focus());
	}

	onMount(() => {
		aliases.load();
		inbox.load();
		return firstmateChat.connect();
	});
</script>

<svelte:window onkeydown={onKey} />

<main class="focus-calm flex min-h-0 flex-1 flex-col" aria-label="Focus" data-focus-view>
	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-focus-scroll>
		{#if card}
			<div class="mx-auto w-full max-w-[44rem] px-4 pt-6 pb-10 max-md:pt-4">
				<div class="mb-3 flex items-center gap-2">
					<HelmMark size={phone.current ? 56 : 68} {active} />
					<h1 class="font-title text-[2.15rem] leading-none">
						With <em class="text-gold">you</em>
					</h1>
					<div class="ml-auto flex items-center gap-1.5" data-focus-pager>
						<button
							type="button"
							class="relative grid size-9 cursor-pointer place-items-center rounded-full border bg-card/60 text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:size-11"
							aria-label="Previous call{unseenBefore ? ' (one not seen yet)' : ''}"
							disabled={index <= 0}
							onclick={() => page_(-1)}
							><ChevronLeft class="size-4" aria-hidden="true" />{#if unseenBefore}<span
									class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-gold"
									aria-hidden="true"
								></span>{/if}</button
						>
						<span
							class="min-w-14 text-center text-sm text-muted-foreground tabular-nums"
							aria-live="polite">{index + 1} of {line.length}</span
						>
						<button
							type="button"
							class="relative grid size-9 cursor-pointer place-items-center rounded-full border bg-card/60 text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40 max-md:size-11"
							aria-label="Next call{unseenAfter ? ' (one not seen yet)' : ''}"
							disabled={index >= line.length - 1}
							onclick={() => page_(1)}
							><ChevronRight class="size-4" aria-hidden="true" />{#if unseenAfter}<span
									class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-gold"
									aria-hidden="true"
								></span>{/if}</button
						>
					</div>
				</div>

				<!-- One card at a time; the rest peek out behind it. -->
				<div class="relative" data-focus-card={card.id}>
					{#if line.length > 2}<div
							class="absolute inset-x-4 -bottom-3 h-6 rounded-b-lg border border-t-0 bg-card/50"
							aria-hidden="true"
						></div>{/if}
					{#if line.length > 1}<div
							class="absolute inset-x-2 -bottom-1.5 h-6 rounded-b-lg border border-t-0 bg-card/80"
							aria-hidden="true"
						></div>{/if}
					<div class="relative [&>article]:max-w-none [&>div]:max-w-none">
						{#key card.id}
							{#if clearedHere}
								<ClearedCall cleared={clearedHere} project={projectName(card.projectId)} />
							{:else}
								<ChatDecision
									decision={openDecision(card)}
									project={projectName(card.projectId)}
									now={live.now}
									variant="focus"
									onLeave={leave}
									onRetry={() => {}}
									onDismiss={() => {}}
								/>
							{/if}
						{/key}
					</div>
				</div>

				{#if line.length > 1}
					<div class="mt-6 flex justify-center gap-1.5" aria-label="Calls" data-focus-pips>
						{#each line as c (c.id)}
							<button
								type="button"
								class="h-1.5 cursor-pointer rounded-full transition-all {c.id === card.id
									? 'w-5 bg-foreground'
									: unseenCall(c)
										? 'w-1.5 bg-gold'
										: 'w-1.5 bg-muted-foreground/40'}"
								aria-label="{c.title}{unseenCall(c) ? ' (not seen yet)' : ''}"
								aria-current={c.id === card.id ? 'true' : undefined}
								onclick={() => (chosen = c.id)}
							></button>
						{/each}
					</div>
				{/if}
				{#if elsewhere}
					<p class="mt-5 text-center text-sm text-muted-foreground" data-focus-elsewhere>
						{elsewhere} more waiting in other projects ·
						<button
							type="button"
							class="cursor-pointer font-medium text-gold hover:underline"
							onclick={showAll}>Show all projects</button
						>
					</p>
				{/if}
			</div>
		{:else}
			<!-- Nothing needs the captain: the calm mark, one question, the box and three ways to start. -->
			<div
				class="mx-auto flex min-h-full w-full max-w-[40rem] flex-col items-center justify-center px-4 py-8 text-center"
				data-focus-empty
			>
				<HelmMark size={phone.current ? 200 : 260} {active} />
				<h1 class="mt-4 text-[1.65rem] font-medium tracking-tight max-md:text-[1.4rem]">
					What shall we work on?
				</h1>
				<p class="mt-1.5 text-sm text-muted-foreground">
					Nothing needs you{scope ? ` in ${projectName(scope)}` : ''}. {calm.underWay} under way, {calm.landedToday}
					landed today.
				</p>
				{#if elsewhere}
					<p class="mt-1 text-sm text-muted-foreground" data-focus-elsewhere>
						{elsewhere} waiting in other projects ·
						<button
							type="button"
							class="cursor-pointer font-medium text-gold hover:underline"
							onclick={showAll}>Show all projects</button
						>
					</p>
				{/if}
				<div class="mt-6 w-full text-left">
					<FocusComposer bind:this={composer} bind:draft big />
				</div>
				<div class="mt-3 grid w-full grid-cols-3 gap-2.5 max-sm:grid-cols-1" data-focus-starts>
					{#each STARTS as st (st.label)}
						<button
							type="button"
							class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-card px-3 text-sm text-foreground/90 shadow-xs transition-colors hover:border-gold/50 dark:bg-card/50 dark:shadow-none"
							onclick={() => begin(st.words)}
							><st.icon class="size-4 text-muted-foreground" aria-hidden="true" />{st.label}</button
						>
					{/each}
				</div>
				<div class="mt-6 w-full text-left"><CalmLine {calm} /></div>
			</div>
		{/if}
	</div>

	{#if card}
		<footer
			class="shrink-0 border-t bg-panel/80 px-4 pt-2 pb-3 backdrop-blur max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
		>
			<div class="mx-auto w-full max-w-[44rem]">
				<CalmLine {calm} />
				<div class="mt-1.5"><FocusComposer bind:draft /></div>
			</div>
		</footer>
	{/if}
</main>
