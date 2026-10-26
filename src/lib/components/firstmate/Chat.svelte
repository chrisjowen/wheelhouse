<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowDown,
		Bell,
		ChevronRight,
		CircleCheck,
		CircleX,
		Hand,
		LoaderCircle,
		Maximize2,
		Minimize2,
		PanelRight,
		RotateCw,
		SquareTerminal,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { duration, type Item } from '$lib/chat/fold';
	import type { Health } from '$lib/chat/health';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel } from '$lib/chat/outbox';
	import { chipLabel, parseRefs } from '$lib/chat/refs';
	import { act, firstmateChat } from '$lib/client/chat.svelte';
	import { enterFullscreen, leaveFullscreen } from '$lib/client/fullscreen.svelte';
	import { currentHealth } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import { matchBridgeCards } from '$lib/plugins/blocks';
	import type { SlotEntry } from '$lib/plugins/types';
	import Blocks from '$lib/components/wh/plugins/Blocks.svelte';
	import Activity from './Activity.svelte';
	import Avatar from './Avatar.svelte';
	import Composer from './Composer.svelte';
	import PickerCard from './PickerCard.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import Terminal from './Terminal.svelte';

	/**
	 * The conversation with Firstmate, rendered from its live transcript: the
	 * captain's messages, Firstmate's replies, its work folded into one line per
	 * run, its questions as buttons. Quiet background checks are kept out and
	 * summed up by the health pill in the session bar. The composer types into
	 * the session; the terminal drawer shows the session's own screen.
	 */
	let {
		token,
		railOpen,
		onToggleRail,
		waiting = 0,
		health,
		now,
		pluginEntries = []
	}: {
		token: string;
		railOpen: boolean;
		onToggleRail: () => void;
		/** Items waiting on the captain, for the rail button's dot. */
		waiting?: number;
		health: Health;
		now: number;
		/** Plugin entries for the fleet, whose bridge.card cards follow replies that link them. */
		pluginEntries?: SlotEntry[];
	} = $props();

	const HEALTH_ICON = { success: CircleCheck, sea: Hand, warning: TriangleAlert, danger: CircleX };
	const HEALTH_TEXT = {
		success: 'text-success',
		sea: 'text-sea',
		warning: 'text-warning',
		danger: 'text-danger'
	};

	const session = $derived(firstmateChat.session);
	const chat = $derived(firstmateChat.chat);
	const items = $derived(chat.items);
	const lastItem = $derived(items[items.length - 1]);
	// Wheelhouse's own session says from its screen; for another, the transcript's open turn is the best sign.
	const working = $derived(
		session?.busy === true || (lastItem?.kind === 'turn' && !lastItem.done && !lastItem.interrupted)
	);
	const picker = $derived(session?.canSend ? session.picker : null);
	const waitingOnAnswer = $derived(!!picker);
	const lastCheck = $derived(chat.checks[chat.checks.length - 1]);
	const checking = $derived(!!lastCheck && !lastCheck.done);
	const recentChecks = $derived(chat.checks.slice(-8).reverse());
	const HIcon = $derived(HEALTH_ICON[health.tone]);
	const canSend = $derived(session?.canSend === true);
	// A session elsewhere cannot be typed into; its inbox still takes messages.
	const via = $derived(
		canSend
			? ('session' as const)
			: session?.state === 'external' && currentHealth()?.messaging.available
				? ('inbox' as const)
				: null
	);

	let showChecks = $state(false);
	let terminalOpen = $state(false);
	let terminalFull = $state(false);
	let terminalPanel = $state<HTMLDivElement | null>(null);
	/** How the browser's full screen is left: 'hold' when Esc stays Claude Code's, 'press' otherwise. */
	let terminalExit = $state<'hold' | 'press' | null>(null);

	// Maximised, the panel also asks for the browser's real full screen, keeping Esc for
	// Claude Code where the browser allows (holding Esc then leaves). The terminal refits
	// to whatever size results, and the session's tmux window follows it.
	async function setTerminalFull(full: boolean) {
		terminalFull = full;
		if (!full) return leaveFullscreen(terminalPanel);
		if (!terminalPanel) return;
		const r = await enterFullscreen(terminalPanel, { keepEscape: true });
		terminalExit = r.full ? (r.escapeKept ? 'hold' : 'press') : null;
	}

	// Leaving the browser's full screen (Esc, or its own controls) restores the drawer.
	$effect(() => {
		const panel = terminalPanel;
		if (!panel) return;
		const onchange = () => {
			if (document.fullscreenElement === panel) return;
			terminalExit = null;
			terminalFull = false;
		};
		panel.addEventListener('fullscreenchange', onchange);
		return () => {
			panel.removeEventListener('fullscreenchange', onchange);
			leaveFullscreen(panel);
		};
	});
	let openNotice = $state<Record<string, boolean>>({});
	let starting = $state(false);
	let startError = $state<string | null>(null);

	let scroller: HTMLDivElement | undefined = $state();
	let atBottom = $state(true);
	const nearBottom = () =>
		!scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

	// Follow new messages while the captain is at the bottom; jump to the end on a new transcript.
	let stick = true;
	$effect.pre(() => {
		void items.length;
		void lastItem;
		void picker;
		void firstmateChat.pending.length;
		stick = nearBottom();
	});
	$effect(() => {
		void items;
		void picker;
		void firstmateChat.pending.length;
		void firstmateChat.resets;
		if (stick) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

	/** Five minutes or less after a message from the same sender: shown under it, without a header. */
	const GROUP_MS = 5 * 60_000;
	function groupedWithPrevious(i: number): boolean {
		const a = items[i - 1];
		const b = items[i];
		if (!a || !b || a.kind !== b.kind || (b.kind !== 'user' && b.kind !== 'turn')) return false;
		return Date.parse(b.at) - Date.parse(a.at) <= GROUP_MS;
	}

	const time = (at: string) =>
		new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	const status = $derived.by(() => {
		if (firstmateChat.connection === 'lost') return { dot: 'bg-danger', label: 'Reconnecting' };
		if (!session) return { dot: 'bg-muted-foreground', label: 'Connecting' };
		if (session.state === 'external') return { dot: 'bg-muted-foreground', label: 'Read-only' };
		if (session.state === 'starting') return { dot: 'animate-pulse bg-sea', label: 'Starting' };
		if (session.state !== 'ours') return { dot: 'bg-muted-foreground', label: 'Not running' };
		if (waitingOnAnswer) return { dot: 'bg-sea', label: 'Asking you' };
		return working
			? { dot: 'animate-pulse bg-sea', label: 'Working' }
			: { dot: 'bg-success', label: 'Waiting for you' };
	});

	async function start() {
		starting = true;
		startError = null;
		const r = await act('/api/firstmate/start', token);
		starting = false;
		if (!r.ok) startError = r.error;
	}

	const isLive = (item: Item, pi: number) =>
		working && item === lastItem && item.kind === 'turn' && pi === item.parts.length - 1;
</script>

<!-- The conversation is on solid paper, like the rail: its notes and meta lines never sit on the grid. -->
<section class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label="Firstmate">
	<!-- Session bar: who you are talking to, ship health, and whether Firstmate is working. -->
	<div class="border-b">
		<div class="flex h-11 items-center gap-3 px-4 text-sm sm:px-6 lg:px-10">
			<span class="font-medium">Firstmate</span>
			{#if chat.title}<span class="hidden truncate text-muted-foreground sm:inline"
					>{chat.title}</span
				>{/if}
			<div class="relative ml-auto shrink-0">
				<button
					class="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
					aria-expanded={showChecks}
					aria-haspopup="dialog"
					onclick={() => (showChecks = !showChecks)}
				>
					<HIcon class="size-3.5 {HEALTH_TEXT[health.tone]}" aria-hidden="true" />
					<span class="font-medium">{health.label}</span>
					<span class="hidden text-muted-foreground md:inline">
						·
						{#if checking}<span class="inline-flex items-center gap-1"
								><LoaderCircle class="size-3 animate-spin" aria-hidden="true" />checking now</span
							>{:else if lastCheck}checked {ago(lastCheck.at, now)}{:else}no checks yet{/if}
					</span>
				</button>
				{#if showChecks}
					<div
						class="absolute top-full right-0 z-30 mt-2 w-72 rounded-xl border bg-popover p-3 text-xs shadow-lg"
						role="dialog"
						aria-label="Background checks"
					>
						<div class="mb-2 flex items-center justify-between">
							<p class="font-medium">Background checks</p>
							<button
								class="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted"
								aria-label="Close"
								onclick={() => (showChecks = false)}><X class="size-3.5" /></button
							>
						</div>
						<p class="mb-2 text-muted-foreground">
							Firstmate wakes when the crew report in. Quiet checks are kept out of the chat.
						</p>
						{#if recentChecks.length}
							<ul class="flex flex-col gap-1">
								{#each recentChecks as c (c.id)}
									<li class="flex items-center gap-2">
										<span class="tabular w-11 shrink-0 text-muted-foreground">{time(c.at)}</span>
										{#if !c.done}
											<LoaderCircle
												class="size-3 animate-spin text-sea"
												aria-hidden="true"
											/>Checking now
										{:else if c.outcome === 'quiet'}
											<CircleCheck class="size-3 text-success" aria-hidden="true" />All quiet
										{:else}
											<Bell class="size-3 text-sea" aria-hidden="true" />Reported back in the chat
										{/if}
										{#if c.durationMs}<span class="ml-auto text-muted-foreground"
												>{duration(c.durationMs)}</span
											>{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-muted-foreground">No background checks in this conversation yet.</p>
						{/if}
					</div>
				{/if}
			</div>
			<span class="hidden shrink-0 items-center gap-2 text-muted-foreground md:flex">
				<span class="size-2 rounded-full {status.dot}" aria-hidden="true"></span>{status.label}
			</span>
			{#if canSend}
				<button
					class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted {terminalOpen
						? 'text-foreground'
						: 'text-muted-foreground'}"
					aria-label={terminalOpen ? 'Hide Firstmate’s terminal' : 'Show Firstmate’s terminal'}
					aria-pressed={terminalOpen}
					title="Firstmate’s own terminal, for anything the chat cannot show"
					onclick={() => (terminalOpen = !terminalOpen)}
				>
					<SquareTerminal class="size-4" />
				</button>
			{/if}
			<button
				class="relative -mr-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label={railOpen ? 'Hide tasks and decisions' : 'Show tasks and decisions'}
				aria-pressed={railOpen}
				onclick={onToggleRail}
			>
				<PanelRight class="size-4" />
				{#if waiting && !railOpen}<span
						class="absolute top-1.5 right-1.5 size-2 rounded-full bg-sea"
						aria-label="{waiting} waiting on you"
					></span>{/if}
			</button>
		</div>
	</div>

	<div class="relative min-h-0 flex-1">
		<div
			bind:this={scroller}
			onscroll={() => (atBottom = nearBottom())}
			class="no-scrollbar h-full overflow-y-auto"
		>
			<div class="flex flex-col gap-6 px-4 pt-8 pb-10 sm:px-6 lg:px-10">
				{#if firstmateChat.source?.truncated}
					<p class="text-xs text-muted-foreground">
						Earlier messages are not shown here; the full conversation is in Firstmate’s terminal.
					</p>
				{/if}

				{#if session && session.state !== 'ours' && session.state !== 'external'}
					<div class="my-8 flex max-w-md flex-col items-start gap-3">
						<p class="font-medium">
							{session.state === 'starting' ? 'Starting Firstmate…' : 'Firstmate is not running'}
						</p>
						{#if session.reason && session.state !== 'starting'}
							<p class="text-sm text-muted-foreground">{session.reason}</p>
						{/if}
						{#if session.state === 'none'}
							<button
								class="flex cursor-pointer items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
								disabled={starting}
								onclick={start}
							>
								{#if starting}<LoaderCircle
										class="size-4 animate-spin"
										aria-hidden="true"
									/>{/if}Start Firstmate here
							</button>
							<p class="text-xs text-muted-foreground">
								It runs in Firstmate’s checkout{session.skipPermissions
									? ' with --dangerously-skip-permissions'
									: ''}, inside a tmux session that keeps going when you close Wheelhouse.
							</p>
							{#if startError}<p class="text-sm text-danger" role="alert">{startError}</p>{/if}
						{/if}
					</div>
				{:else if !items.length}
					<p class="py-20 text-sm text-muted-foreground">
						{session ? 'No messages yet. Say hello to Firstmate.' : 'Reading the conversation…'}
					</p>
				{/if}

				{#each items as item, i (item.id)}
					{@const grouped = groupedWithPrevious(i)}
					{#if item.kind === 'user'}
						<article class="msg {grouped ? 'mt-[-1.1rem]' : ''}" aria-label="You, {time(item.at)}">
							{#if grouped}<span class="msg-gutter" aria-hidden="true"></span>{:else}<span
									class="captain-avatar">C</span
								>{/if}
							<div class="min-w-0 flex-1">
								{#if !grouped}
									<header class="msg-head">
										<span class="msg-name">You</span><time datetime={item.at}>{time(item.at)}</time>
										{#if item.queued}<span>· sent while Firstmate was working</span>{/if}
									</header>
								{/if}
								<div class="bubble bubble-captain {item.command ? 'font-mono text-sm' : ''}">
									{#each parseRefs(item.text) as piece, pi (pi)}{#if typeof piece === 'string'}{piece}{:else}<a
												href="/tasks/{encodeURIComponent(piece.id)}"
												class="mx-px inline-block rounded-md bg-sea/15 px-1.5 text-[0.875em] font-medium whitespace-nowrap text-sea no-underline hover:bg-sea/25"
												title={piece.url ?? piece.title}>{chipLabel(piece)}</a
											>{/if}{/each}
								</div>
							</div>
						</article>
					{:else if item.kind === 'output'}
						<pre
							class="no-scrollbar max-h-80 max-w-[80ch] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{item.text}</pre>
					{:else if item.kind === 'notice'}
						<div class="flex flex-col items-start">
							<button
								class="-ml-3 flex max-w-full cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								aria-expanded={!!openNotice[item.id]}
								onclick={() => (openNotice[item.id] = !openNotice[item.id])}
							>
								<Bell class="size-3.5 shrink-0" aria-hidden="true" />
								<span class="truncate">{item.title} · {time(item.at)}</span>
								<ChevronRight
									class="size-3.5 shrink-0 transition-transform {openNotice[item.id]
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>
							</button>
							{#if openNotice[item.id]}
								<div
									class="mt-2 w-full max-w-[80ch] rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-wrap text-muted-foreground"
								>
									{item.detail}
								</div>
							{/if}
						</div>
					{:else}
						<article
							class="msg {grouped ? 'mt-[-1.1rem]' : ''}"
							aria-label="Firstmate, {time(item.at)}"
						>
							{#if grouped}<span class="msg-gutter" aria-hidden="true"></span>{:else}<Avatar
									class="size-8"
								/>{/if}
							<div class="flex min-w-0 flex-1 flex-col gap-2">
								{#if !grouped}
									<header class="msg-head">
										<span class="msg-name">Firstmate</span><time datetime={item.at}
											>{time(item.at)}</time
										>
									</header>
								{/if}
								{#each item.parts as part, pi (part.id)}
									{#if part.kind === 'text'}
										<div class="chat-md bubble bubble-firstmate">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
											{@html markdown(part.text)}
										</div>
										{#each matchBridgeCards(part.text, pluginEntries) as { entry, card } (`${entry.key}:${card.key}`)}
											<div
												class="max-w-[80ch] rounded-xl border bg-card p-4"
												data-slot="bridge.card"
											>
												<p class="font-medium">{card.title}</p>
												<div class="mt-2"><Blocks blocks={card.blocks} /></div>
											</div>
										{/each}
									{:else if part.kind === 'question'}
										<QuestionCard {part} />
									{:else}
										<Activity steps={part.steps} live={isLive(item, pi)} />
									{/if}
								{/each}
								{#if item.interrupted}
									<span class="text-xs text-muted-foreground">Stopped</span>
								{:else if item.done && item.durationMs}
									<span class="text-xs text-muted-foreground"
										>Worked for {duration(item.durationMs)}</span
									>
								{/if}
							</div>
						</article>
					{/if}
				{/each}

				{#each firstmateChat.pending as p, pi (p.id)}
					{@const grouped = pi > 0 || lastItem?.kind === 'user'}
					<!-- Sent but not in the transcript yet: faded until it lands, then it becomes a normal message. -->
					<article
						class="msg {grouped ? 'mt-[-1.1rem]' : ''}"
						data-pending={p.state}
						aria-label="You, {pendingLabel(p)}"
					>
						{#if grouped}<span class="msg-gutter" aria-hidden="true"></span>{:else}<span
								class="captain-avatar">C</span
							>{/if}
						<div class="min-w-0 flex-1">
							{#if !grouped}
								<header class="msg-head"><span class="msg-name">You</span></header>
							{/if}
							<div
								class="bubble bubble-captain border-dashed {p.state === 'failed'
									? 'border-danger/60'
									: 'opacity-60'}"
							>
								{#each parseRefs(p.text) as piece, ri (ri)}{#if typeof piece === 'string'}{piece}{:else}<span
											class="mx-px inline-block rounded-md bg-sea/15 px-1.5 text-[0.875em] font-medium whitespace-nowrap text-sea"
											>{chipLabel(piece)}</span
										>{/if}{/each}
							</div>
							<p
								class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs {p.state === 'failed'
									? 'text-danger'
									: 'text-muted-foreground'}"
								role="status"
							>
								{#if p.state === 'failed'}
									<CircleX class="size-3.5" aria-hidden="true" />{pendingLabel(p)}
									<button
										class="ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
										onclick={() => firstmateChat.retry(p.id, token, working)}
										><RotateCw class="size-3" aria-hidden="true" />Retry</button
									>
									<button
										class="cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
										onclick={() => firstmateChat.dismiss(p.id)}>Discard</button
									>
								{:else}
									<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />{pendingLabel(p)}
								{/if}
							</p>
						</div>
					</article>
				{/each}

				{#if picker}
					<PickerCard {picker} {token} onterminal={() => (terminalOpen = true)} />
				{:else if working}
					<div class="flex gap-1 py-1" aria-label="Firstmate is working" role="status">
						<span
							class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]"
						></span>
						<span
							class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]"
						></span>
						<span class="size-1.5 animate-bounce rounded-full bg-muted-foreground"></span>
					</div>
				{/if}
			</div>
		</div>

		{#if !atBottom}
			<button
				class="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-muted"
				onclick={() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })}
			>
				<ArrowDown class="size-3.5" aria-hidden="true" />Latest
			</button>
		{/if}

		{#if terminalOpen && canSend}
			<!-- Maximised, the same panel (and its live connection) fills the screen. Esc belongs
			     to Claude Code inside it, so only the buttons (or holding Esc, in full screen) resize it. -->
			<div
				bind:this={terminalPanel}
				class="{terminalFull
					? 'fixed inset-0 z-50'
					: 'absolute inset-x-0 bottom-0 z-20 h-[min(70%,36rem)] border-t shadow-lg'} flex flex-col bg-panel"
				data-firstmate-terminal={terminalFull ? 'full' : 'docked'}
			>
				<div class="flex h-10 shrink-0 items-center gap-2 px-4 text-sm sm:px-6 lg:px-10">
					<SquareTerminal class="size-4 text-muted-foreground" aria-hidden="true" />
					<span class="font-medium">Firstmate’s terminal</span>
					<span class="hidden text-muted-foreground sm:inline"
						>· for anything the chat cannot show</span
					>
					{#if terminalFull && terminalExit}
						<span class="ml-auto hidden text-xs text-muted-foreground sm:inline"
							>{terminalExit === 'hold' ? 'Hold Esc' : 'Esc'} to leave full screen</span
						>
					{/if}
					<button
						class="{terminalFull && terminalExit
							? 'sm:ml-2'
							: ''} ml-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label={terminalFull ? 'Restore the terminal' : 'Open the terminal full screen'}
						title={terminalFull ? 'Restore' : 'Full screen'}
						onclick={() => setTerminalFull(!terminalFull)}
						>{#if terminalFull}<Minimize2 class="size-4" />{:else}<Maximize2
								class="size-4"
							/>{/if}</button
					>
					<button
						class="-mr-2 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Hide the terminal"
						onclick={() => {
							void setTerminalFull(false);
							terminalOpen = false;
						}}><X class="size-4" /></button
					>
				</div>
				<div class="flex min-h-0 flex-1 flex-col px-2 pb-2">
					<Terminal {token} />
				</div>
			</div>
		{/if}
	</div>

	<div class="bg-panel px-4 pb-4 sm:px-6 lg:px-10">
		<Composer
			{via}
			reason={session?.reason ?? null}
			working={working && !waitingOnAnswer}
			{token}
			commands={firstmateChat.commands}
		/>
	</div>
</section>
