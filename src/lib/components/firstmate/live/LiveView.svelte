<script lang="ts">
	/**
	 * Live mode: the whole app as one quiet screen for talking things through
	 * with a discussion crew member while Firstmate keeps the watch. Before
	 * anything is said it is almost empty: the calm mark (HelmMark, moving only
	 * while there is work going on, its look read from the fleet by
	 * lib/helm.ts), "What shall we work on?", the crew's greeting, the box
	 * (LiveComposer) and three ways to start. Once the talk starts the mark
	 * sits small above what is said (LiveEntries) and the box stays at the
	 * foot. Beside it (on a phone, behind a Decisions button) the calls
	 * waiting on the captain (LiveDecisions), each opening into its card,
	 * answered in place, and raised in the talk; at the foot, Firstmate's
	 * updates as one calm line (LiveUpdates), each raised in the talk when
	 * picked. Voice is off when a call starts; the box's switch turns it on.
	 *
	 * The bar (LiveBar) ends the call: with a briefing it goes to Firstmate
	 * straight away and Live mode steps aside to the chat, which shows that
	 * briefing alone. What is left of a call that could not start, or whose
	 * briefing could not be sent, stays until put away.
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Bug, Code, FileText, ListChecks } from '@lucide/svelte';
	import { currentFleet, currentHealth, live } from '$lib/client/live.svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { calls } from '$lib/client/calls.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { liveCall } from '$lib/client/livecall.svelte';
	import { phone } from '$lib/client/phone.svelte';
	import { calmOf } from '$lib/calls';
	import { helmOf, newlyLanded } from '$lib/helm';
	import { aboutUpdate, liveUpdates, type LiveUpdate } from '$lib/live/updates';
	import { projectLabels } from '$lib/projectnames';
	import type { InboxView } from '$lib/inbox';
	import Sheet from '$lib/components/wh/Sheet.svelte';
	import HelmMark from './HelmMark.svelte';
	import LiveBar from './LiveBar.svelte';
	import LiveComposer from './LiveComposer.svelte';
	import LiveDecisions from './LiveDecisions.svelte';
	import LiveEntries from './LiveEntries.svelte';
	import LiveUpdates from './LiveUpdates.svelte';

	const seed = $derived(page.data.inbox as InboxView | undefined);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	const fleet = $derived(currentFleet());
	const tasks = $derived(fleet?.tasks ?? []);
	const waiting = $derived(calls.waiting(live.now, seed));

	const labels = $derived(projectLabels(fleet?.projects ?? [], aliases.names));
	const projectName = (id: string | null) =>
		!id || id === 'unassigned'
			? null
			: (labels.get(id)?.label ?? fleet?.projects.find((p) => p.id === id)?.name ?? id);

	// ---- the mark: still at rest, its look, tint and speed read from the fleet ----
	const crewBusy = $derived(
		['starting', 'thinking', 'transcribing', 'speaking', 'ending'].includes(liveCall.state)
	);
	const helm = $derived(helmOf(tasks, waiting.length, firstmateChat.working || crewBusy));
	// A task landing turns the wheel once.
	let flourish = $state(0);
	let landedKnown: Set<string> | null = null;
	$effect(() => {
		if (!fleet) return;
		const r = newlyLanded(landedKnown, fleet.tasks);
		landedKnown = r.known;
		if (r.landed.length) flourish++;
	});

	// ---- what has been said: the empty screen until the captain says something ----
	const talked = $derived(
		liveCall.entries.some((e) => e.kind === 'captain' || e.kind === 'scout' || e.kind === 'brief')
	);
	const greeting = $derived.by(() => {
		const crew = liveCall.entries.find((e) => e.kind === 'crew');
		return crew?.kind === 'crew' ? crew.text : '';
	});

	// ---- updates: Firstmate's reports and what moved, since a while before the call ----
	const calm = $derived(calmOf(tasks, live.now));
	const since = $derived((liveCall.startedAt || live.now) - 60 * 60_000);
	const updates = $derived(liveUpdates(calm.log, firstmateChat.chat.items, since));
	function discussUpdate(u: LiveUpdate) {
		liveCall.type(aboutUpdate(u));
	}

	// ---- decisions: on a phone behind a button ----
	let decisionsOpen = $state(false);

	// ---- the box, and quick starts that begin what is typed ----
	let composer = $state<ReturnType<typeof LiveComposer> | null>(null);
	const STARTS = [
		{ label: 'Plan a feature', icon: FileText, words: 'Let’s plan a feature: ' },
		{ label: 'Investigate an issue', icon: Bug, words: 'Help me think through an issue: ' },
		{ label: 'Review a PR', icon: Code, words: 'Let’s review a pull request: ' }
	];
	const begin = (words: string) => void tick().then(() => composer?.focus(words));
	let talkArea = $state<HTMLElement | null>(null);

	// ---- the briefing, hand-offs and scout requests go to Firstmate as the captain's messages ----
	const via = $derived(
		firstmateChat.session?.canSend
			? ('session' as const)
			: firstmateChat.session?.state === 'external' && currentHealth()?.messaging.available
				? ('inbox' as const)
				: null
	);
	$effect(() => {
		const to = via;
		liveCall.toFirstmate = async (text: string) =>
			!!to && (await firstmateChat.send(text, to, token, firstmateChat.working)).ok;
	});
	// Ended with its briefing sent: on to the chat, where the briefing is.
	let wasShown = false;
	$effect(() => {
		const shown = liveCall.shown;
		const sent = liveCall.entries.some((e) => e.kind === 'brief' && e.sent);
		if (wasShown && !shown && !liveCall.on && sent) void goto('/');
		wasShown = shown;
	});

	// What is said follows the latest, a reply as it streams in too, unless the captain scrolled up to read.
	const latest = () => {
		const e = liveCall.entries[liveCall.entries.length - 1];
		return `${liveCall.entries.length}:${e && 'text' in e ? e.text.length : 0}`;
	};
	let stick = true;
	$effect.pre(() => {
		void latest();
		const a = talkArea;
		stick = !a || a.scrollHeight - a.scrollTop - a.clientHeight < 160;
	});
	$effect(() => {
		void latest();
		if (stick) void tick().then(() => talkArea?.scrollTo({ top: talkArea.scrollHeight }));
	});

	onMount(() => {
		aliases.load();
		inbox.load();
		return firstmateChat.connect();
	});
</script>

<main class="live-calm flex min-h-0 flex-1 flex-col" aria-label="Live" data-live-view>
	<LiveBar />
	<div class="flex min-h-0 flex-1">
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				bind:this={talkArea}
				class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
				data-live-talk
			>
				{#if !talked}
					<!-- Nothing said yet: the calm mark, one question, the crew's greeting, the box and three ways to start. -->
					<div
						class="mx-auto flex min-h-full w-full max-w-[40rem] flex-col items-center justify-center px-4 py-8 text-center"
						data-live-empty
					>
						<HelmMark size={phone.current ? 200 : 260} {helm} {flourish} />
						<p
							class="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
							data-helm-legend={helm.kind}
						>
							{helm.legend}
						</p>
						<h1 class="mt-1 text-[1.65rem] font-medium tracking-tight max-md:text-[1.4rem]">
							What shall we work on?
						</h1>
						<p class="mt-1.5 min-h-5 text-sm text-muted-foreground" data-live-greeting>
							{#if liveCall.state === 'starting'}
								The crew is reading the fleet…
							{:else if liveCall.problem && !liveCall.on}
								<span class="text-danger">{liveCall.problem}</span>
							{:else}
								{greeting}
							{/if}
						</p>
						<div class="mt-6 w-full text-left">
							<LiveComposer bind:this={composer} {talkArea} {token} big />
						</div>
						<div class="mt-3 grid w-full grid-cols-3 gap-2.5 max-sm:grid-cols-1" data-live-starts>
							{#each STARTS as st (st.label)}
								<button
									type="button"
									class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-card px-3 text-sm text-foreground/90 shadow-xs transition-colors hover:border-gold/50 disabled:cursor-default disabled:opacity-50 dark:bg-card/50 dark:shadow-none"
									disabled={!liveCall.on}
									onclick={() => begin(st.words)}
									><st.icon
										class="size-4 text-muted-foreground"
										aria-hidden="true"
									/>{st.label}</button
								>
							{/each}
						</div>
					</div>
				{:else}
					<div class="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-4 pt-6 pb-10">
						<div class="flex items-center gap-2">
							<HelmMark size={phone.current ? 56 : 68} {helm} {flourish} />
							<div class="min-w-0">
								<h1 class="font-title text-[2.15rem] leading-none">
									With the <em class="text-gold">crew</em>
								</h1>
								{#if helm.legend}<p class="mt-1 text-xs text-muted-foreground">
										{helm.legend}
									</p>{/if}
							</div>
						</div>
						<LiveEntries {tasks} {token} now={live.now} {projectName} />
					</div>
				{/if}
			</div>
			<footer
				class="shrink-0 border-t bg-panel/80 px-4 pt-2 pb-3 backdrop-blur max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
			>
				<div class="mx-auto w-full max-w-[44rem]">
					{#if phone.current}
						<button
							type="button"
							class="mb-1 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-muted/50"
							aria-haspopup="dialog"
							onclick={() => (decisionsOpen = true)}
							data-live-decisions-button
							><ListChecks class="size-4 text-muted-foreground" aria-hidden="true" /><span
								class="font-medium">Decisions</span
							>
							<span class="text-muted-foreground"
								>{waiting.length ? `${waiting.length} waiting on you` : 'nothing waiting'}</span
							>{#if waiting.some((c) => !calls.isSeen(c))}<span
									class="ml-auto size-2 rounded-full bg-gold"
									aria-hidden="true"
								></span>{/if}</button
						>
					{/if}
					<LiveUpdates {calm} {updates} ondiscuss={discussUpdate} />
					{#if talked && liveCall.on}
						<div class="mt-1.5"><LiveComposer {talkArea} {token} /></div>
					{:else if !liveCall.on}
						<button
							type="button"
							class="mt-1.5 flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border bg-card text-sm font-medium hover:border-gold/50"
							onclick={() => liveCall.dismiss()}
							data-live-back>Back to the app</button
						>
					{/if}
				</div>
			</footer>
		</div>
		{#if !phone.current}
			<aside
				class="flex w-[min(26rem,36vw)] shrink-0 flex-col overflow-y-auto border-l bg-panel/60 px-4 py-5"
				aria-label="Waiting on you"
			>
				<LiveDecisions
					cards={waiting}
					now={live.now}
					{projectName}
					ondiscuss={(c) => liveCall.discussDecision(c)}
					onLeave={() => liveCall.stepOut()}
				/>
			</aside>
		{/if}
	</div>
</main>

{#if phone.current}
	<Sheet
		bind:open={decisionsOpen}
		title={waiting.length ? `Decisions · ${waiting.length} waiting` : 'Decisions'}
		onOpenAutoFocus={(e) => e.preventDefault()}
	>
		<div class="px-4 pb-6">
			<LiveDecisions
				cards={waiting}
				now={live.now}
				{projectName}
				ondiscuss={(c) => liveCall.discussDecision(c)}
				onLeave={() => liveCall.stepOut()}
				heading={false}
			/>
		</div>
	</Sheet>
{/if}
