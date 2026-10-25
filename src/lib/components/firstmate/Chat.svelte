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
		PanelRight,
		SquareTerminal,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { duration, type Item } from '$lib/chat/fold';
	import type { Health } from '$lib/chat/health';
	import { markdown } from '$lib/chat/markdown';
	import { chipLabel, parseRefs } from '$lib/chat/refs';
	import { act, firstmateChat } from '$lib/client/chat.svelte';
	import { currentHealth } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import { matchBridgeCards } from '$lib/plugins/blocks';
	import type { SlotEntry } from '$lib/plugins/types';
	import Blocks from '$lib/components/wh/plugins/Blocks.svelte';
	import Activity from './Activity.svelte';
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
		stick = nearBottom();
	});
	$effect(() => {
		void items;
		void picker;
		void firstmateChat.resets;
		if (stick) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

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

<section class="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Firstmate">
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
					<p class="text-center text-xs text-muted-foreground">
						Earlier messages are not shown here; the full conversation is in Firstmate’s terminal.
					</p>
				{/if}

				{#if session && session.state !== 'ours' && session.state !== 'external'}
					<div class="mx-auto my-8 flex max-w-md flex-col items-center gap-3 text-center">
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
					<p class="py-20 text-center text-sm text-muted-foreground">
						{session ? 'No messages yet. Say hello to Firstmate.' : 'Reading the conversation…'}
					</p>
				{/if}

				{#each items as item (item.id)}
					{#if item.kind === 'user'}
						<div class="group flex flex-col items-end gap-1">
							<div
								class="max-w-[min(85%,62ch)] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap {item.command
									? 'font-mono text-sm'
									: ''}"
							>
								{#each parseRefs(item.text) as piece, i (i)}{#if typeof piece === 'string'}{piece}{:else}<a
											href="/tasks/{encodeURIComponent(piece.id)}"
											class="mx-px inline-block rounded-md bg-sea/15 px-1.5 text-[0.875em] font-medium whitespace-nowrap text-sea no-underline hover:bg-sea/25"
											title={piece.url ?? piece.title}>{chipLabel(piece)}</a
										>{/if}{/each}
							</div>
							<span
								class="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
							>
								{item.queued ? 'Sent while Firstmate was working · ' : ''}{time(item.at)}
							</span>
						</div>
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
						<div class="flex flex-col gap-3">
							{#each item.parts as part, pi (part.id)}
								{#if part.kind === 'text'}
									<div class="chat-md max-w-[80ch] text-[15px] leading-relaxed">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(part.text)}
									</div>
									{#each matchBridgeCards(part.text, pluginEntries) as { entry, card } (`${entry.key}:${card.key}`)}
										<div class="max-w-[80ch] rounded-xl border bg-card p-4" data-slot="bridge.card">
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
								<span class="text-xs text-muted-foreground/70">Stopped</span>
							{:else if item.done && item.durationMs}
								<span class="text-xs text-muted-foreground/70"
									>Worked for {duration(item.durationMs)}</span
								>
							{/if}
						</div>
					{/if}
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
			<div
				class="absolute inset-x-0 bottom-0 z-20 flex h-[min(70%,36rem)] flex-col border-t bg-background shadow-lg"
			>
				<div class="flex h-10 shrink-0 items-center gap-2 px-4 text-sm sm:px-6 lg:px-10">
					<SquareTerminal class="size-4 text-muted-foreground" aria-hidden="true" />
					<span class="font-medium">Firstmate’s terminal</span>
					<span class="hidden text-muted-foreground sm:inline"
						>· for anything the chat cannot show</span
					>
					<button
						class="-mr-2 ml-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Hide the terminal"
						onclick={() => (terminalOpen = false)}><X class="size-4" /></button
					>
				</div>
				<div class="flex min-h-0 flex-1 flex-col px-2 pb-2">
					<Terminal {token} />
				</div>
			</div>
		{/if}
	</div>

	<div class="bg-background px-4 pb-4 sm:px-6 lg:px-10">
		<Composer
			{via}
			reason={session?.reason ?? null}
			working={working && !waitingOnAnswer}
			{token}
			commands={firstmateChat.commands}
		/>
	</div>
</section>
