<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
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
		ArrowLeftRight,
		PanelLeft,
		PanelRight,
		Reply,
		RotateCw,
		SquareTerminal,
		TriangleAlert,
		Upload,
		X
	} from '@lucide/svelte';
	import { parseAttachments, UPLOAD_MAX_BYTES } from '$lib/chat/attachments';
	import { attachments } from '$lib/client/attach.svelte';
	import SentFiles from './SentFiles.svelte';
	import type { ChatApp as ChatAppView } from '$lib/apps/types';
	import {
		chatDecisions,
		placeDecisions,
		type ChatDecision as Decision
	} from '$lib/chat/decisions';
	import { discussText, parseDiscuss, pendingThreads, threads } from '$lib/chat/discuss';
	import { duration, finishedMcpCalls, type Item } from '$lib/chat/fold';
	import type { Health } from '$lib/chat/health';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel } from '$lib/chat/outbox';
	import { previewCards } from '$lib/chat/previews';
	import { chipLabel, parseRefs } from '$lib/chat/refs';
	import { parseReply, quotes, snippetOf, type ReplyTo } from '$lib/chat/reply';
	import { chatApps } from '$lib/client/apps';
	import { act, firstmateChat } from '$lib/client/chat.svelte';
	import { enterFullscreen, leaveFullscreen } from '$lib/client/fullscreen.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { currentHealth } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import type { InboxView } from '$lib/inbox';
	import type { Project, TaskSummary } from '$lib/types';
	import { matchBridgeCards } from '$lib/plugins/blocks';
	import type { SlotEntry } from '$lib/plugins/types';
	import Blocks from '$lib/components/wh/plugins/Blocks.svelte';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import Activity from './Activity.svelte';
	import Avatar from './Avatar.svelte';
	import ChatApp from './ChatApp.svelte';
	import ChatDecisionCard from './ChatDecision.svelte';
	import ChatPreview from './ChatPreview.svelte';
	import Composer from './Composer.svelte';
	import MenuCard from './MenuCard.svelte';
	import PickerCard from './PickerCard.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import Terminal from './Terminal.svelte';

	/**
	 * The conversation with Firstmate, rendered from its live transcript: the
	 * captain's messages, Firstmate's replies, its work folded into one line per
	 * run, its questions as buttons, and a way out of any Claude Code menu (such
	 * as /mcp's) the chat cannot use. A tool call to a plugin's MCP server
	 * whose tool has an app shows that app under its message, closed until the
	 * captain opens it. Any message can be replied to, as in WhatsApp, with
	 * its quote carried in the text sent (see lib/chat/reply.ts). The captain's
	 * attached files show as a card under their message (SentFiles), and files
	 * dropped on the chat are attached to the next one. Quiet background checks
	 * are kept out and summed up by the health pill in the session bar. The
	 * composer types into the session, but not while a menu is open; the
	 * terminal drawer shows the session's own screen.
	 *
	 * A task's live preview shows as a card under the reply about it (a landed
	 * one once its work has merged; lib/chat/previews.ts). Every decision in the
	 * inbox shows as a card of its own at the time it was asked, answered from
	 * there as on the Decisions page and folded to its answer after
	 * (lib/chat/decisions.ts); its Discuss thread holds the captain's questions
	 * about it and Firstmate's replies, which the conversation leaves out
	 * (lib/chat/discuss.ts).
	 */
	let {
		token,
		railOpen,
		railSide = 'right',
		onToggleRail,
		onSwapRail,
		waiting = 0,
		health,
		now,
		pluginEntries = [],
		tasks = [],
		projects = []
	}: {
		token: string;
		railOpen: boolean;
		/** Which side of the chat the On deck rail docks to. */
		railSide?: 'left' | 'right';
		onToggleRail: () => void;
		/** Moves the rail to the chat's other side; without it there is no button. */
		onSwapRail?: () => void;
		/** Items waiting on the captain, for the rail button's dot. */
		waiting?: number;
		health: Health;
		now: number;
		/** Plugin entries for the fleet, whose bridge.card cards follow replies that link them. */
		pluginEntries?: SlotEntry[];
		/** The fleet's tasks, whose live previews follow the replies about them. */
		tasks?: TaskSummary[];
		/** The fleet's projects, for the cards' project names. */
		projects?: Project[];
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
	const menu = $derived(session?.canSend ? session.menu : null);
	const waitingOnAnswer = $derived(!!picker || !!menu);
	// Nothing is typed into a menu, where Enter would choose for the captain.
	const held = $derived(
		picker
			? 'Answer the question above to send your message.'
			: menu
				? 'Close the Claude Code menu above to send your message.'
				: null
	);
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

	// Decisions, from the live inbox (the page's own until it is read), each at the time it was asked.
	const inboxView = $derived(inbox.view(page.data.inbox as InboxView | undefined));
	const decisions = $derived(
		inboxView?.available
			? chatDecisions(inboxView.cards, inboxView.answered ?? [], inbox.pending)
			: []
	);
	const placed = $derived(placeDecisions(items, decisions));
	const decisionIds = $derived(new Set(decisions.map((d) => d.head.cardId)));
	const discussed = $derived(threads(items, decisionIds));
	const asking = $derived(pendingThreads(firstmateChat.pending));
	// A question asked again after an answer shows twice; its thread sits with the newest card.
	const threadOwner = $derived.by(() => {
		// Rebuilt from scratch on each change, never mutated afterwards: a plain Map.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const owner = new Map<string, string>();
		for (const d of decisions) {
			const held = owner.get(d.head.cardId);
			if (!held || !decisions.find((x) => x.id === held)?.card) owner.set(d.head.cardId, d.id);
		}
		return owner;
	});
	// The captain's questions about a decision show in its thread, not in the conversation.
	const chatPending = $derived(
		firstmateChat.pending.filter((p) => {
			const d = parseDiscuss(p.text);
			return !d || !decisionIds.has(d.cardId);
		})
	);
	const previews = $derived(previewCards(items, tasks));
	const projectName = (id: string | null) =>
		!id || id === 'unassigned' ? null : (projects.find((p) => p.id === id)?.name ?? id);

	function ask(d: Decision, text: string) {
		const message = discussText(
			{ taskId: d.head.taskId, key: d.head.key, question: d.head.question },
			text
		);
		if (!message || !via) return;
		void firstmateChat.send(message, via, token, working && !waitingOnAnswer);
	}

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
	// The MCP tool calls with an app to draw, asked about once each as their results land.
	let apps = $state<Record<string, ChatAppView>>({});
	// Bookkeeping only, never drawn: a plain Set, so asking does not rerun the effect.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const asked = new Set<string>();
	$effect(() => {
		const fresh = finishedMcpCalls(items).filter((id) => !asked.has(id));
		if (!fresh.length || !token) return;
		for (const id of fresh) asked.add(id);
		chatApps(fresh, token).then(
			(v) => {
				if (Object.keys(v.apps).length) apps = { ...apps, ...v.apps };
			},
			() => {
				// Asked again on the next change, or the next visit.
				for (const id of fresh) asked.delete(id);
			}
		);
	});
	let openNotice = $state<Record<string, boolean>>({});
	let starting = $state(false);
	let startError = $state<string | null>(null);

	let scroller: HTMLDivElement | undefined = $state();
	let atBottom = $state(true);
	const nearBottom = () =>
		!scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

	// Follow new messages (and a composer grown by attached files) while the captain is at the
	// bottom; jump to the end on a new transcript.
	let stick = true;
	$effect.pre(() => {
		void items.length;
		void lastItem;
		void picker;
		void menu;
		void firstmateChat.pending.length;
		void attachments.drafts.length;
		void placed.end.length;
		void discussed.hidden.size;
		stick = nearBottom();
	});
	$effect(() => {
		void items;
		void picker;
		void menu;
		void firstmateChat.pending.length;
		void attachments.drafts.length;
		void placed;
		void discussed;
		void firstmateChat.resets;
		if (stick) void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

	/** Five minutes or less after a message from the same sender: shown under it, without a header. */
	const GROUP_MS = 5 * 60_000;
	function groupedWithPrevious(i: number): boolean {
		// Messages in a decision's thread are not in the conversation, and a decision card breaks a run.
		let j = i - 1;
		while (j >= 0 && discussed.hidden.has(items[j].id)) j--;
		for (let k = j + 1; k <= i; k++) if (placed.before.has(k)) return false;
		const a = items[j];
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
		if (picker) return { dot: 'bg-sea', label: 'Asking you' };
		if (menu) return { dot: 'bg-sea', label: 'Menu open' };
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

	/** The message the captain is replying to, quoted above the composer. */
	let replyTo = $state<ReplyTo | null>(null);
	/** A captain's message as its bubble shows it: no quote of its own, no attached-file lines. */
	const captainWords = (text: string) => parseAttachments(parseReply(text).body).text;
	function startReply(who: ReplyTo['who'], text: string) {
		if (!via) return;
		const snippet = snippetOf(who === 'captain' ? captainWords(text) : text);
		if (snippet) replyTo = { who, snippet };
	}

	/** The bubble a reply quotes, looked for in the messages before it (by `before`, an index into items). */
	function original(to: ReplyTo, before = items.length): string | null {
		for (let i = Math.min(before, items.length) - 1; i >= 0; i--) {
			const it = items[i];
			if (to.who === 'captain' && it.kind === 'user' && quotes(to, captainWords(it.text)))
				return it.id;
			if (to.who === 'firstmate' && it.kind === 'turn')
				for (let pi = it.parts.length - 1; pi >= 0; pi--) {
					const part = it.parts[pi];
					if (part.kind === 'text' && quotes(to, part.text)) return part.id;
				}
		}
		return null;
	}

	/** Scroll to the quoted message and light it up briefly. */
	function jumpTo(key: string | null) {
		const el = key
			? scroller?.querySelector<HTMLElement>(`[data-bubble="${CSS.escape(key)}"]`)
			: null;
		if (!el) return;
		el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		el.classList.remove('reply-flash');
		// Restarts the light when the same quote is followed again.
		requestAnimationFrame(() => el.classList.add('reply-flash'));
		setTimeout(() => el.classList.remove('reply-flash'), 1800);
	}

	/**
	 * Touch: swipe a bubble to the right to reply (as in WhatsApp), or hold it to
	 * show its Reply button. The bubble follows the finger; vertical scrolling wins,
	 * and so does sideways scrolling inside a wide code block or table. `reply` is
	 * null when the bubble can't be replied to.
	 */
	let revealed = $state<string | null>(null);
	function swipeToReply(node: HTMLElement, reply: (() => void) | null) {
		let x0 = 0;
		let y0 = 0;
		let dx = 0;
		let mode: 'idle' | 'maybe' | 'swipe' | 'scroll' = 'idle';
		let hold: ReturnType<typeof setTimeout> | undefined;
		const set = (v: number) => {
			node.style.transform = v ? `translateX(${v}px)` : '';
			node.style.setProperty('--swipe', String(Math.min(v / 56, 1)));
		};
		const scrollsSideways = (target: EventTarget | null) => {
			for (
				let el = target instanceof Element ? target : null;
				el && el !== node;
				el = el.parentElement
			) {
				const { overflowX } = getComputedStyle(el);
				if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth)
					return true;
			}
			return false;
		};
		const start = (e: TouchEvent) => {
			if (revealed && revealed !== node.dataset.bubble) revealed = null;
			if (!reply || e.touches.length !== 1 || scrollsSideways(e.target)) return;
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
			dx = 0;
			mode = 'maybe';
			node.style.transition = 'none';
			hold = setTimeout(() => {
				if (mode === 'maybe') revealed = node.dataset.bubble ?? null;
			}, 450);
		};
		const move = (e: TouchEvent) => {
			if (mode === 'idle' || mode === 'scroll') return;
			const x = e.touches[0].clientX - x0;
			const y = e.touches[0].clientY - y0;
			if (mode === 'maybe') {
				if (Math.abs(y) > 10) mode = 'scroll';
				else if (x > 12) mode = 'swipe';
				if (mode !== 'maybe') clearTimeout(hold);
			}
			if (mode !== 'swipe') return;
			dx = Math.max(0, Math.min(x, 80));
			set(dx);
		};
		const end = () => {
			clearTimeout(hold);
			if (mode === 'swipe' && dx >= 56) {
				navigator.vibrate?.(10);
				reply?.();
			}
			mode = 'idle';
			node.style.transition = 'transform 180ms ease-out';
			set(0);
		};
		node.addEventListener('touchstart', start, { passive: true });
		node.addEventListener('touchmove', move, { passive: true });
		node.addEventListener('touchend', end);
		node.addEventListener('touchcancel', end);
		return {
			update(next: (() => void) | null) {
				reply = next;
			},
			destroy() {
				clearTimeout(hold);
				node.removeEventListener('touchstart', start);
				node.removeEventListener('touchmove', move);
				node.removeEventListener('touchend', end);
				node.removeEventListener('touchcancel', end);
			}
		};
	}

	// Files dragged over the chat: a count, since entering a child fires dragenter again.
	let dragging = $state(0);
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

	const isLive = (item: Item, pi: number) =>
		working && item === lastItem && item.kind === 'turn' && pi === item.parts.length - 1;
</script>

{#snippet replyButton(key: string, who: ReplyTo['who'], text: string)}
	<button
		class="reply-btn {revealed === key ? 'is-revealed' : ''}"
		aria-label={who === 'firstmate'
			? 'Reply to this message from Firstmate'
			: 'Reply to your message'}
		title="Reply"
		onclick={() => {
			revealed = null;
			startReply(who, text);
		}}><Reply class="size-4" aria-hidden="true" /></button
	>
{/snippet}

{#snippet quote(to: ReplyTo, target: string | null)}
	<button
		class="reply-quote reply-quote-{to.who}"
		disabled={!target}
		title={target ? 'Show the message this replies to' : 'That message is no longer in the chat'}
		onclick={() => jumpTo(target)}
	>
		<span class="reply-quote-who">{to.who === 'firstmate' ? 'Firstmate' : 'You'}</span>
		<span class="reply-quote-text">{to.snippet}</span>
	</button>
{/snippet}

{#snippet decisionRow(d: Decision)}
	<div class="msg msg-firstmate msg-grouped">
		<span class="msg-gutter" aria-hidden="true"></span>
		<div class="min-w-0 flex-1">
			<ChatDecisionCard
				decision={d}
				project={projectName(d.head.projectId)}
				{now}
				thread={threadOwner.get(d.head.cardId) === d.id
					? (discussed.byCard.get(d.head.cardId) ?? null)
					: null}
				pending={threadOwner.get(d.head.cardId) === d.id ? (asking.get(d.head.cardId) ?? []) : []}
				canAsk={!!via}
				onAsk={(text) => ask(d, text)}
				onRetry={(id) => firstmateChat.retry(id, token, working && !waitingOnAnswer)}
				onDismiss={(id) => firstmateChat.dismiss(id)}
			/>
		</div>
	</div>
{/snippet}

{#snippet captainText(text: string, linked: boolean)}
	{#each parseRefs(text) as piece, pi (pi)}{#if typeof piece === 'string'}{piece}{:else if linked}<a
				href="/tasks/{encodeURIComponent(piece.id)}"
				class="mx-px inline-block rounded-md bg-sea/15 px-1.5 text-[0.875em] font-medium whitespace-nowrap text-sea no-underline hover:bg-sea/25"
				title={piece.url ?? piece.title}>{chipLabel(piece)}</a
			>{:else}<span
				class="mx-px inline-block rounded-md bg-sea/15 px-1.5 text-[0.875em] font-medium whitespace-nowrap text-sea"
				>{chipLabel(piece)}</span
			>{/if}{/each}
{/snippet}

<!-- The conversation sits on the graph-paper grid, behind its speech bubbles. -->
<section
	class="chat-grid relative flex min-h-0 min-w-0 flex-1 flex-col bg-panel"
	aria-label="Firstmate"
	ondragenter={(e) => {
		if (!hasFiles(e) || !via) return;
		e.preventDefault();
		dragging++;
	}}
	ondragover={(e) => {
		if (hasFiles(e) && via) e.preventDefault();
	}}
	ondragleave={(e) => {
		if (hasFiles(e) && via) dragging = Math.max(0, dragging - 1);
	}}
	ondrop={(e) => {
		if (!hasFiles(e) || !via) return;
		e.preventDefault();
		dragging = 0;
		attachments.dropped = [...(e.dataTransfer?.files ?? [])];
	}}
>
	{#if dragging}
		<div
			class="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-sea/60 bg-panel/80"
		>
			<div
				class="flex flex-col items-center gap-2 rounded-xl border border-hair bg-card px-8 py-6 text-center shadow-sm"
			>
				<Upload class="size-6 text-sea" aria-hidden="true" />
				<p class="font-display text-lg font-medium">Drop to attach</p>
				<p class="text-sm text-muted-foreground">
					Kept on this machine for Firstmate to open · up to {UPLOAD_MAX_BYTES / (1024 * 1024)} MB each
				</p>
			</div>
		</div>
	{/if}
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
			{#if onSwapRail && railOpen}
				<button
					class="hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
					aria-label={railSide === 'left'
						? 'Move On deck to the right'
						: 'Move On deck to the left'}
					title={railSide === 'left' ? 'Move On deck to the right' : 'Move On deck to the left'}
					onclick={onSwapRail}
				>
					<ArrowLeftRight class="size-4" />
				</button>
			{/if}
			<button
				class="relative -mr-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label={railOpen ? 'Hide tasks and decisions' : 'Show tasks and decisions'}
				aria-pressed={railOpen}
				onclick={onToggleRail}
			>
				{#if railSide === 'left'}<PanelLeft class="size-4" />{:else}<PanelRight
						class="size-4"
					/>{/if}
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
					{#each placed.before.get(i) ?? [] as d (d.id)}{@render decisionRow(d)}{/each}
					{#if discussed.hidden.has(item.id)}
						<!-- In its decision's thread. -->
					{:else if item.kind === 'user'}
						{@const reply = parseReply(item.text)}
						{@const sent = parseAttachments(reply.body)}
						<article
							class="msg msg-captain {grouped ? 'msg-grouped' : ''}"
							aria-label="You, {time(item.at)}"
						>
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
								{#if reply.to || sent.text}<div class="bubble-row">
										<div
											class="bubble bubble-captain {item.command ? 'font-mono text-sm' : ''}"
											data-bubble={item.id}
											use:swipeToReply={via && !item.command
												? () => startReply('captain', item.text)
												: null}
										>
											{#if reply.to}{@render quote(
													reply.to,
													original(reply.to, i)
												)}{/if}{@render captainText(sent.text, true)}
										</div>
										{#if via && !item.command}{@render replyButton(
												item.id,
												'captain',
												item.text
											)}{/if}
									</div>{/if}
								{#if sent.files.length}<SentFiles files={sent.files} />{/if}
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
									<LinkedText text={item.detail} />
								</div>
							{/if}
						</div>
					{:else}
						<article
							class="msg msg-firstmate {grouped ? 'msg-grouped' : ''}"
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
										<div class="bubble-row">
											<div
												class="chat-md bubble bubble-firstmate"
												data-bubble={part.id}
												use:swipeToReply={via ? () => startReply('firstmate', part.text) : null}
											>
												<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
												{@html markdown(part.text, { docLinks: true })}
											</div>
											{#if via}{@render replyButton(part.id, 'firstmate', part.text)}{/if}
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
										{#each previews.get(part.id) ?? [] as pv (pv.task.id)}
											<ChatPreview preview={pv} project={projectName(pv.task.projectId)} {now} />
										{/each}
									{:else if part.kind === 'question'}
										<QuestionCard {part} />
									{:else}
										<Activity steps={part.steps} live={isLive(item, pi)} />
										{#each part.steps as step (step.id)}
											{#if apps[step.id]}<ChatApp id={step.id} app={apps[step.id]} />{/if}
										{/each}
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

				{#each placed.end as d (d.id)}{@render decisionRow(d)}{/each}

				{#each chatPending as p, pi (p.id)}
					{@const grouped = pi > 0 || lastItem?.kind === 'user'}
					{@const reply = parseReply(p.text)}
					{@const sent = parseAttachments(reply.body)}
					<!-- Sent but not in the transcript yet: faded until it lands, then it becomes a normal message. -->
					<article
						class="msg msg-captain {grouped ? 'msg-grouped' : ''}"
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
							{#if reply.to || sent.text}<div
									class="bubble bubble-captain border-dashed {p.state === 'failed'
										? 'border-danger/60'
										: 'opacity-60'}"
								>
									{#if reply.to}{@render quote(
											reply.to,
											original(reply.to)
										)}{/if}{@render captainText(sent.text, false)}
								</div>{/if}
							{#if sent.files.length}<SentFiles files={sent.files} pending />{/if}
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
										onclick={() => firstmateChat.retry(p.id, token, working && !waitingOnAnswer)}
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
				{:else if menu}
					<MenuCard {menu} {token} onterminal={() => (terminalOpen = true)} />
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
			{held}
			{token}
			commands={firstmateChat.commands}
			reply={replyTo}
			oncancelreply={() => (replyTo = null)}
		/>
	</div>
</section>
