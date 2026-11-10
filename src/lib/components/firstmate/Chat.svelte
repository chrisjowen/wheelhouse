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
		KeyRound,
		LoaderCircle,
		Maximize2,
		Minimize2,
		ArrowLeftRight,
		PanelLeft,
		PanelRight,
		Reply,
		ThumbsUp,
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
	import { answerText, chatForms } from '$lib/chat/forms';
	import { storedText, vaultAsks, vaultRequests, type VaultRequest } from '$lib/chat/vaultrequest';
	import type { Health } from '$lib/chat/health';
	import { markdown } from '$lib/chat/markdown';
	import { pendingLabel } from '$lib/chat/outbox';
	import { previewCards } from '$lib/chat/previews';
	import { chipLabel, parseRefs } from '$lib/chat/refs';
	import {
		cardTag,
		foldRuns,
		parseMarkers,
		parseThread,
		tagChat,
		threadRows,
		topicName,
		UNSORTED,
		UNSORTED_TAG,
		type FoldRun,
		type Tag,
		type TaggedSection
	} from '$lib/chat/topics';
	import { chatTags } from '$lib/client/chattags.svelte';
	import { chatThreads } from '$lib/client/chatthreads.svelte';
	import { aliases } from '$lib/client/aliases.svelte';
	import { hue as hueOf, projectLabels } from '$lib/projectnames';
	import { parseReply, quotes, snippetOf, type ReplyTo } from '$lib/chat/reply';
	import { chatApps } from '$lib/client/apps';
	import { act, firstmateChat } from '$lib/client/chat.svelte';
	import { enterFullscreen, leaveFullscreen } from '$lib/client/fullscreen.svelte';
	import { inbox } from '$lib/client/inbox.svelte';
	import { openedDecisions } from '$lib/client/opened.svelte';
	import { reactions } from '$lib/client/reactions.svelte';
	import { reactionText } from '$lib/chat/reaction';
	import { composerBus } from './bus.svelte';
	import { currentHealth, currentMessages } from '$lib/client/live.svelte';
	import type { FormAnswer } from '$lib/decisionform';
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
	import FeedbackBatch from './FeedbackBatch.svelte';
	import { chatBatches, placeBatches, type ChatBatch } from '$lib/chat/batches';
	import ChatPreview from './ChatPreview.svelte';
	import Composer from './Composer.svelte';
	import DecisionForm from './DecisionForm.svelte';
	import MenuCard from './MenuCard.svelte';
	import PickerCard from './PickerCard.svelte';
	import QuestionCard from './QuestionCard.svelte';
	import Terminal from './Terminal.svelte';
	import ThreadTag from './ThreadTag.svelte';
	import VaultAdd from './VaultAdd.svelte';

	/**
	 * The conversation with Firstmate, rendered from its live transcript: the
	 * captain's messages, Firstmate's replies, its work folded into one line per
	 * run, its questions as buttons, and a way out of any Claude Code menu (such
	 * as /mcp's) the chat cannot use. A tool call to a plugin's MCP server
	 * whose tool has an app shows that app under its message, expanded until the
	 * captain collapses it. Any message can be replied to, as in WhatsApp, with
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
	 * (lib/chat/discuss.ts). A reply of Firstmate's that ends with a
	 * decision-form block shows that form under its words, answered with a chat
	 * message naming what the captain decided (lib/chat/forms.ts).
	 *
	 * Every message and card is tagged with its thread, a project or a topic
	 * (lib/chat/topics.ts), and the tag moves it to another. Picking a thread
	 * in the header's project switcher reads the chat one thread at a time: the
	 * others are left out, or folded to a line per run, and what the captain
	 * sends from there is sent in that thread. The chat's threads, with their
	 * counts, are offered there (lib/client/chatthreads.svelte.ts).
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
		projects = [],
		thread = null,
		onPickThread
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
		/** The thread being read (a project id, a topic or Unsorted), or null for all. */
		thread?: string | null;
		/** Picks the thread to read; without it the chat keeps the choice itself. */
		onPickThread?: (topic: string | null) => void;
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
	// A question Firstmate is settling itself shows once the captain opened it here or talked about it.
	$effect(() => openedDecisions.load());
	const opened = $derived(
		new Set([
			...openedDecisions.ids,
			...(composerBus.decision ? [composerBus.decision] : []),
			...items.flatMap((it) => {
				const d = it.kind === 'user' ? parseDiscuss(it.text) : null;
				return d ? [d.cardId] : [];
			}),
			...firstmateChat.pending.flatMap((p) => {
				const d = parseDiscuss(p.text);
				return d ? [d.cardId] : [];
			})
		])
	);
	const decisions = $derived(
		inboxView?.available
			? chatDecisions(inboxView.cards, inboxView.answered ?? [], inbox.pending, opened)
			: []
	);
	const placed = $derived(placeDecisions(items, decisions));
	// Feedback lists sent from a preview, from Wheelhouse's record of what it sent.
	const batches = $derived(placeBatches(items, chatBatches(currentMessages()?.messages ?? [])));
	// Only the decisions drawn hold threads, so a question is never hidden without its card.
	const shown = $derived([...[...placed.before.values()].flat(), ...placed.end]);
	const decisionIds = $derived(new Set(shown.map((d) => d.head.cardId)));
	const discussed = $derived(threads(items, decisionIds));
	const asking = $derived(pendingThreads(firstmateChat.pending));
	// A question asked again after an answer shows twice; its thread sits with the newest card.
	const threadOwner = $derived.by(() => {
		// Rebuilt from scratch on each change, never mutated afterwards: a plain Map.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const owner = new Map<string, string>();
		for (const d of shown) {
			const held = owner.get(d.head.cardId);
			if (!held || !shown.find((x) => x.id === held)?.card) owner.set(d.head.cardId, d.id);
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

	// Forms Firstmate asked in the conversation, answered from the transcript, the inbox record and messages being sent.
	const forms = $derived(
		chatForms(items, discussed.hidden, firstmateChat.pending, currentMessages()?.messages ?? [])
	);
	/** A reply's words as its bubble shows them: without the form it ends with, its secret requests, or its thread markers. */
	const replyWords = (part: { id: string; text: string }) =>
		parseMarkers(vaultRequests(forms.get(part.id)?.words ?? part.text).words)
			.map((s) => s.text)
			.join('\n\n');
	/** Firstmate's Markdown, without the secret requests that show as cards under it. */
	const md = (text: string) => markdown(vaultRequests(text).words, { docLinks: true });

	// Secrets Firstmate asked for in its replies (lib/chat/vaultrequest.ts), stored or not yet.
	const asks = $derived(vaultAsks(items, firstmateChat.pending, currentMessages()?.messages ?? []));
	// The Add a secret popup: opened only by the captain, from the key button or a request's card.
	let vaultOpen = $state(false);
	let vaultAsk = $state<VaultRequest | null>(null);
	/** A stored secret Firstmate could not be told about, until dismissed. */
	let vaultNotice = $state<string | null>(null);
	function addSecret(ask: VaultRequest | null) {
		vaultAsk = ask;
		vaultNotice = null;
		vaultOpen = true;
	}
	/** Tell Firstmate a secret is stored: its name and who can use it, never its value. */
	function secretStored(name: string, granted: string[]) {
		const text = storedText(name, granted);
		if (via && !held) {
			void firstmateChat.send(text, via, token, working && !waitingOnAnswer);
			return;
		}
		vaultNotice = `${text} Firstmate was not told: ${held ?? 'there is no Firstmate session to send to.'}`;
	}

	// Threads: every message and card tagged with its project or topic (lib/chat/topics.ts).
	$effect(() => {
		chatTags.load();
		aliases.load();
	});
	let ownThread = $state<string | null>(null);
	const current = $derived(onPickThread ? thread : ownThread);
	const pickThread = (topic: string | null) => {
		openRuns = {};
		if (onPickThread) onPickThread(topic);
		else ownThread = topic;
	};
	const tagged = $derived(tagChat(items, tasks, projects, chatTags.retags));
	const labels = $derived(projectLabels(projects, aliases.names));
	const threadName = (topic: string) =>
		topic === UNSORTED ? 'Unsorted' : (labels.get(topic)?.label ?? topicName(topic));
	const threadHue = (topic: string) =>
		topic === UNSORTED ? null : (labels.get(topic)?.hue ?? hueOf(topic));
	const decisionTag = (d: Decision) =>
		cardTag(`decision:${d.head.cardId}`, d.head.projectId, 'decision', chatTags.retags);
	const batchTag = (b: ChatBatch) =>
		cardTag(
			`batch:${b.id}`,
			tasks.find((t) => t.id === b.batch.taskId)?.projectId,
			'task',
			chatTags.retags
		);
	const previewTag = (taskId: string, projectId: string) =>
		cardTag(`preview:${taskId}`, projectId, 'task', chatTags.retags);
	/** Every thread a message is about: a reply's sections and preview cards, else its own. */
	function itemTopics(it: Item): string[] {
		if (it.kind === 'user') return [tagged.users.get(it.id)?.topic ?? UNSORTED];
		if (it.kind !== 'turn') return [UNSORTED];
		// Rebuilt on each call, never kept: a plain Set.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const out = new Set<string>();
		for (const p of it.parts) {
			if (p.kind !== 'text') continue;
			for (const sec of tagged.parts.get(p.id) ?? []) if (!sec.intro) out.add(sec.tag.topic);
			for (const pv of previews.get(p.id) ?? [])
				out.add(previewTag(pv.task.id, pv.task.projectId).topic);
		}
		if (!out.size) out.add(tagged.turns.get(it.id)?.topic ?? UNSORTED);
		return [...out];
	}
	/** Every message and card in the order drawn, with its threads. */
	const entries = $derived.by(() => {
		const out: { key: string; topics: string[]; at: string | null; needs: boolean }[] = [];
		const decision = (d: Decision) =>
			out.push({
				key: `d:${d.id}`,
				topics: [decisionTag(d).topic],
				at: d.head.askedAt,
				needs: !!d.card && !d.answer
			});
		const batch = (b: ChatBatch) =>
			out.push({ key: `b:${b.id}`, topics: [batchTag(b).topic], at: b.at, needs: false });
		items.forEach((it, i) => {
			for (const d of placed.before.get(i) ?? []) decision(d);
			for (const b of batches.before.get(i) ?? []) batch(b);
			if (!discussed.hidden.has(it.id))
				out.push({ key: it.id, topics: itemTopics(it), at: it.at, needs: false });
		});
		for (const d of placed.end) decision(d);
		for (const b of batches.end) batch(b);
		return out;
	});
	const topicsOf = $derived(new Map(entries.map((e) => [e.key, e.topics])));
	const rows = $derived(threadRows(entries, current));
	// Offered in the header's project switcher while the chat is open.
	$effect(() => {
		chatThreads.rows = rows.map((r) => ({
			topic: r.topic,
			name: threadName(r.topic),
			hue: threadHue(r.topic),
			count: r.count,
			needs: r.needs,
			project: projects.some((p) => p.id === r.topic)
		}));
	});
	$effect(() => () => {
		chatThreads.rows = [];
	});
	const inThread = $derived(
		current ? entries.filter((e) => e.topics.includes(current)).length : entries.length
	);
	/** Where a message can be moved: the threads in the chat, then the other projects, then Unsorted. */
	const moveTo = $derived.by(() => {
		const seen = new Set(rows.map((r) => r.topic).filter((t) => t !== UNSORTED));
		const topics = [
			...seen,
			...projects
				.filter((p) => p.registered && !seen.has(p.id))
				.map((p) => p.id)
				.sort((a, b) => threadName(a).localeCompare(threadName(b))),
			UNSORTED
		];
		return topics.map((topic) => ({ topic, name: threadName(topic), hue: threadHue(topic) }));
	});
	const runs = $derived(
		current && chatTags.fold ? foldRuns(entries, current) : new Map<string, FoldRun>()
	);
	/** Runs of other threads opened in place, by their first entry's key. */
	let openRuns = $state<Record<string, boolean>>({});
	/** How an entry shows while a thread is read: in full, dimmed in an opened run, as its run's line, or not at all. */
	function view(key: string): 'show' | 'dim' | 'line' | 'hide' {
		const topics = topicsOf.get(key);
		if (!current || !topics || topics.includes(current)) return 'show';
		const run = runs.get(key);
		if (!run) return 'hide';
		if (openRuns[run.first]) return 'dim';
		return run.first === key ? 'line' : 'hide';
	}
	/** The thread a message ends in, for whether the next one needs its own tag. */
	function lastTopic(it: Item): string | null {
		if (it.kind === 'user') return tagged.users.get(it.id)?.topic ?? null;
		if (it.kind !== 'turn') return null;
		for (let pi = it.parts.length - 1; pi >= 0; pi--) {
			const secs = tagged.parts.get(it.parts[pi].id);
			if (secs?.length) return secs[secs.length - 1].tag.topic;
		}
		return tagged.turns.get(it.id)?.topic ?? null;
	}
	/**
	 * How a Firstmate turn shows its threads: each text part's sections (only
	 * the thread's while one is read, unless dimmed), the tag in its header, and
	 * a tag above any bubble whose thread differs from the one before it.
	 */
	function layoutTurn(
		it: Extract<Item, { kind: 'turn' }>,
		all: boolean,
		grouped: boolean,
		prev: string | null
	) {
		// Rebuilt on each call, never kept: a plain Map.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const parts = new Map<
			string,
			{ secs: TaggedSection[]; whole: boolean; above: TaggedSection | null }
		>();
		let head: TaggedSection | null = null;
		let hidden = 0;
		let first = true;
		for (const p of it.parts) {
			if (p.kind !== 'text') continue;
			const every = tagged.parts.get(p.id) ?? [];
			const inCurrent = (x: TaggedSection) => !x.intro && x.tag.topic === current;
			// A reply with a form shows whole: in a thread as one bubble under it, else in its tagged sections without the form.
			const asked = forms.get(p.id);
			const words = asked && parseMarkers(asked.words);
			const own = !words
				? every
				: all
					? every.map((s, i) => ({ ...s, text: words[i]?.text ?? '' }))
					: every.length
						? [every.find(inCurrent) || every[0]]
						: [];
			const filed = all ? own : own.filter(inCurrent);
			// A round-up's intro shows with any of its sections.
			const secs =
				filed.length && own[0]?.intro && !filed.includes(own[0]) ? [own[0], ...filed] : filed;
			hidden += own.length - secs.length - (own[0]?.intro && !secs.length ? 1 : 0);
			let above: TaggedSection | null = null;
			if (secs.length === 1) {
				if (first && !grouped) head = secs[0];
				else if (secs[0].tag.topic !== prev) above = secs[0];
				prev = secs[0].tag.topic;
			} else if (secs.length) prev = null;
			if (secs.length) first = false;
			parts.set(p.id, { secs, whole: secs.length === own.length, above });
		}
		if (first && !grouped)
			head = {
				key: `turn:${it.id}`,
				text: '',
				tag: tagged.turns.get(it.id) ?? UNSORTED_TAG,
				intro: false
			};
		return { parts, head, hidden };
	}

	function decide(partId: string, a: FormAnswer, note: string | null) {
		const asked = forms.get(partId);
		const text = asked ? answerText(asked.form, a, note) : '';
		// Never typed into an open menu, where Enter would choose for the captain.
		if (!text || !via || held) return;
		void firstmateChat.send(text, via, token, working && !waitingOnAnswer);
	}

	function ask(d: Decision, text: string) {
		const message = discussText(
			{ taskId: d.head.taskId, key: d.head.key, question: d.head.question },
			text
		);
		if (!message || !via) return false;
		void firstmateChat.send(message, via, token, working && !waitingOnAnswer);
		return true;
	}

	// The captain's 👍 on Firstmate's messages, kept by the server, read again when the page regains focus.
	$effect(() => {
		const refresh = () => void reactions.refresh();
		refresh();
		window.addEventListener('focus', refresh);
		return () => window.removeEventListener('focus', refresh);
	});
	/** Marks a Firstmate message 👍 (telling Firstmate which, once the server has newly kept it), or takes the mark back, which sends nothing. */
	async function thumbsUp(partId: string, words: string) {
		if (reactions.has(partId)) {
			void reactions.set(partId, false, token);
			return;
		}
		const text = reactionText(words);
		const to = via;
		if (!text || !to || held) return;
		if (await reactions.set(partId, true, token))
			void firstmateChat.send(text, to, token, working && !waitingOnAnswer);
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
	// Apps open expanded; the ones the captain collapsed stay so while the chat is open.
	let collapsedApps = $state<Record<string, boolean>>({});
	let openNotice = $state<Record<string, boolean>>({});
	let starting = $state(false);
	let startError = $state<string | null>(null);

	let scroller: HTMLDivElement | undefined = $state();
	let atBottom = $state(true);
	// A decision brought into view (Chat about this) holds the place until the captain scrolls back down.
	let holding = false;
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
		stick = nearBottom() && !holding;
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
	// What lands grows after it is drawn (an expanded app sizes its frame to the app): keep
	// following the latest while the captain is at the bottom.
	let stream = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const el = scroller;
		if (!stream || !el) return;
		const watch = new ResizeObserver(() => {
			if (atBottom && !holding) el.scrollTo({ top: el.scrollHeight });
		});
		watch.observe(stream);
		return () => watch.disconnect();
	});

	/** Five minutes or less after a message from the same sender: shown under it, without a header. */
	const GROUP_MS = 5 * 60_000;
	/** The message drawn before items[i]: not in a decision's thread, nor left out of the thread read. */
	function previousShown(i: number): number {
		let j = i - 1;
		while (j >= 0 && (discussed.hidden.has(items[j].id) || view(items[j].id) === 'hide')) j--;
		return j;
	}
	function groupedWithPrevious(i: number): boolean {
		// Messages in a decision's thread are not in the conversation, and a decision card, or a
		// fold line for other threads, breaks a run.
		const j = previousShown(i);
		const v = view(items[i].id);
		if (v !== 'show' && runs.get(items[i].id)?.first === items[i].id) return false;
		if (j >= 0 && view(items[j].id) !== v) return false;
		for (let k = j + 1; k <= i; k++)
			if (
				(placed.before.get(k) ?? []).some((d) => view(`d:${d.id}`) !== 'hide') ||
				(batches.before.get(k) ?? []).some((b) => view(`b:${b.id}`) !== 'hide')
			)
				return false;
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
	const captainWords = (text: string) =>
		parseAttachments(parseThread(parseReply(text).body).text).text;
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
					if (part.kind === 'text' && quotes(to, replyWords(part))) return part.id;
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

{#snippet thumbsButton(key: string, words: string)}
	{@const on = reactions.has(key)}
	<button
		class="reply-btn thumbs-btn {revealed === key ? 'is-revealed' : ''} {on ? 'is-on' : ''}"
		aria-label={on ? 'Take back your thumbs-up' : 'Thumbs up this message from Firstmate'}
		aria-pressed={on}
		title={on ? 'Take back 👍' : '👍'}
		disabled={!on && !!held}
		onclick={() => {
			revealed = null;
			void thumbsUp(key, words);
		}}><ThumbsUp class="size-4" aria-hidden="true" /></button
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
			<div class="msg-tagline">{@render tagOf(decisionTag(d), `decision:${d.head.cardId}`)}</div>
			<ChatDecisionCard
				decision={d}
				project={projectName(d.head.projectId)}
				{now}
				thread={threadOwner.get(d.head.cardId) === d.id
					? (discussed.byCard.get(d.head.cardId) ?? null)
					: null}
				pending={threadOwner.get(d.head.cardId) === d.id ? (asking.get(d.head.cardId) ?? []) : []}
				canAsk={!!via}
				focus={firstmateChat.synced &&
					composerBus.decision === d.head.cardId &&
					threadOwner.get(d.head.cardId) === d.id}
				onFocused={() => {
					// Opened here, it keeps its card in the conversation.
					openedDecisions.add(d.head.cardId);
					composerBus.decision = null;
					holding = true;
				}}
				onAsk={(text) => ask(d, text)}
				onRetry={(id) => firstmateChat.retry(id, token, working && !waitingOnAnswer)}
				onDismiss={(id) => firstmateChat.dismiss(id)}
			/>
		</div>
	</div>
{/snippet}

{#snippet decisionEntry(d: Decision)}
	{@const key = `d:${d.id}`}
	{@const v = view(key)}
	{#if v !== 'show' && runs.get(key)?.first === key}{@render foldLine(runs.get(key)!)}{/if}
	{#if v === 'show' || v === 'dim'}<div class={v === 'dim' ? 'thread-dim' : 'contents'}>
			{@render decisionRow(d)}
		</div>{/if}
{/snippet}

{#snippet batchEntry(b: ChatBatch)}
	{@const key = `b:${b.id}`}
	{@const v = view(key)}
	{#if v !== 'show' && runs.get(key)?.first === key}{@render foldLine(runs.get(key)!)}{/if}
	{#if v === 'show' || v === 'dim'}
		<div class="flex flex-col gap-1 {v === 'dim' ? 'thread-dim' : ''}">
			<div class="msg-tagline">{@render tagOf(batchTag(b), `batch:${b.id}`)}</div>
			<FeedbackBatch
				batch={b}
				project={projectName(tasks.find((t) => t.id === b.batch.taskId)?.projectId ?? null)}
			/>
		</div>
	{/if}
{/snippet}

{#snippet tagOf(tag: Tag, key: string)}
	<ThreadTag {tag} threads={moveTo} onMove={(topic) => chatTags.move(key, topic)} />
{/snippet}

{#snippet foldLine(run: FoldRun)}
	<button
		class="thread-fold"
		aria-expanded={!!openRuns[run.first]}
		data-fold={run.first}
		onclick={() => (openRuns = { ...openRuns, [run.first]: !openRuns[run.first] })}
	>
		<ChevronRight
			class="size-3.5 shrink-0 transition-transform {openRuns[run.first] ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
		<span class="shrink-0">{run.count} {run.count === 1 ? 'message' : 'messages'} about</span>
		<span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
			{#each run.topics as t (t)}<span class="inline-flex items-center gap-1"
					><span class="thread-dot" data-hue={threadHue(t) ?? undefined} aria-hidden="true"
					></span>{threadName(t)}</span
				>{/each}
		</span>
		{#if run.from && run.to}<span class="tabular ml-auto shrink-0"
				>{time(run.from)}{run.to !== run.from ? `–${time(run.to)}` : ''}</span
			>{/if}
	</button>
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
			onscroll={() => {
				atBottom = nearBottom();
				if (atBottom) holding = false;
			}}
			class="no-scrollbar h-full overflow-y-auto"
		>
			<div bind:this={stream} class="flex flex-col gap-6 px-4 pt-8 pb-10 sm:px-6 lg:px-10">
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

				{#if current}
					<div class="thread-note" role="status" data-thread-note>
						<p>
							Showing the <b>{threadName(current)}</b> thread: {inThread} of {entries.length}
							{entries.length === 1 ? 'message' : 'messages'}.{current !== UNSORTED
								? ' What you send from here is sent in it.'
								: ''}
						</p>
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
							<label class="flex cursor-pointer items-center gap-1.5">
								<input
									type="checkbox"
									class="accent-sea"
									checked={chatTags.fold}
									onchange={(e) => {
										openRuns = {};
										chatTags.setFold(e.currentTarget.checked);
									}}
								/>Fold other threads to a line
							</label>
							<button
								class="cursor-pointer font-medium text-sea hover:underline"
								onclick={() => pickThread(null)}>Show all threads</button
							>
						</div>
					</div>
				{/if}

				{#each items as item, i (item.id)}
					{@const grouped = groupedWithPrevious(i)}
					{@const v = view(item.id)}
					{#each placed.before.get(i) ?? [] as d (d.id)}{@render decisionEntry(d)}{/each}
					{#each batches.before.get(i) ?? [] as b (b.id)}{@render batchEntry(b)}{/each}
					{#if discussed.hidden.has(item.id)}
						<!-- In its decision's thread. -->
					{:else if v !== 'show' && runs.get(item.id)?.first === item.id}
						{@render foldLine(runs.get(item.id)!)}
					{/if}
					{#if discussed.hidden.has(item.id) || v === 'hide' || v === 'line'}
						<!-- In its decision's thread, or another thread's. -->
					{:else if item.kind === 'user'}
						{@const reply = parseReply(item.text)}
						{@const sent = parseAttachments(parseThread(reply.body).text)}
						{@const tag = tagged.users.get(item.id) ?? UNSORTED_TAG}
						{@const prevAt = previousShown(i)}
						<article
							class="msg msg-captain {grouped ? 'msg-grouped' : ''} {v === 'dim'
								? 'thread-dim'
								: ''}"
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
										{@render tagOf(tag, item.id)}
									</header>
								{:else if prevAt < 0 || lastTopic(items[prevAt]) !== tag.topic}
									<div class="msg-tagline">{@render tagOf(tag, item.id)}</div>
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
							class="no-scrollbar max-h-80 max-w-[80ch] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground {v ===
							'dim'
								? 'thread-dim'
								: ''}">{item.text}</pre>
					{:else if item.kind === 'notice'}
						<div class="flex flex-col items-start {v === 'dim' ? 'thread-dim' : ''}">
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
						{@const prevAt = previousShown(i)}
						{@const lay = layoutTurn(
							item,
							v === 'dim' || !current,
							grouped,
							prevAt >= 0 ? lastTopic(items[prevAt]) : null
						)}
						<article
							class="msg msg-firstmate {grouped ? 'msg-grouped' : ''} {v === 'dim'
								? 'thread-dim'
								: ''}"
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
										{#if lay.head}{@render tagOf(lay.head.tag, lay.head.key)}{/if}
									</header>
								{/if}
								{#each item.parts as part, pi (part.id)}
									{#if part.kind === 'text'}
										{@const asked = forms.get(part.id)}
										{@const words = replyWords(part)}
										{@const shown = lay.parts.get(part.id)}
										{#if shown?.above}<div class="msg-tagline -mb-1">
												{@render tagOf(shown.above.tag, shown.above.key)}
											</div>{/if}
										{#if words && shown?.secs.length}<div class="bubble-row">
												<div
													class="chat-md bubble bubble-firstmate"
													data-bubble={part.id}
													use:swipeToReply={via ? () => startReply('firstmate', words) : null}
												>
													{#if shown.secs.length > 1}
														{#each shown.secs as sec (sec.key)}
															{#if sec.intro}
																<div class="mb-3">
																	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
																	{@html md(sec.text)}
																</div>
															{:else}
																<div
																	class="thread-section"
																	data-hue={threadHue(sec.tag.topic) ?? undefined}
																>
																	<div class="mb-1">{@render tagOf(sec.tag, sec.key)}</div>
																	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
																	{@html md(sec.text)}
																</div>
															{/if}
														{/each}
													{:else}
														<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
														{@html md(shown.whole ? words : shown.secs[0].text)}
													{/if}{#if reactions.has(part.id)}<span
															class="thumbs-mark"
															role="img"
															aria-label="You gave this a thumbs-up">👍</span
														>{/if}
												</div>
												{#if via}{@render replyButton(
														part.id,
														'firstmate',
														words
													)}{@render thumbsButton(part.id, words)}{/if}
											</div>{/if}
										{#if asked && shown?.secs.length}
											<div
												class="w-full max-w-[min(100%,40rem)] rounded-lg border border-l-[3px] bg-card px-4 pt-0.5 pb-3 sm:px-5 {asked.active
													? 'border-l-sea'
													: asked.decided !== null
														? 'border-l-success/70'
														: 'border-l-hair'}"
												data-chat-form={asked.active
													? 'open'
													: asked.decided !== null
														? 'answered'
														: 'replaced'}
											>
												<DecisionForm
													form={asked.form}
													name={part.id}
													canAnswer={asked.active && !!via && !held}
													decided={asked.decided}
													onAnswer={(a, note) => decide(part.id, a, note)}
												/>
												{#if !asked.active && asked.decided === null}
													<p class="mt-2 text-xs text-muted-foreground">
														A later question from Firstmate replaced this one.
													</p>
												{/if}
											</div>
										{/if}
										{#if shown?.secs.length}
											{#each asks.get(part.id) ?? [] as a, ai (ai)}
												<div
													class="flex w-full max-w-[min(100%,40rem)] items-start gap-3 rounded-lg border border-l-[3px] bg-card px-4 py-3 {a.stored
														? 'border-l-success/70'
														: 'border-l-brass'}"
													data-vault-request={a.stored ? 'stored' : 'open'}
												>
													<KeyRound class="mt-0.5 size-4 shrink-0 text-brass" aria-hidden="true" />
													<div class="min-w-0 flex-1">
														<p class="text-sm">
															Firstmate asks for <span class="font-mono font-medium"
																>{a.request.name}</span
															>
														</p>
														{#if a.request.purpose}<p class="mt-0.5 text-sm text-muted-foreground">
																{a.request.purpose}
															</p>{/if}
														{#if a.stored}<p
																class="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
															>
																<CircleCheck
																	class="size-3.5 text-success"
																	aria-hidden="true"
																/>Stored in the vault
															</p>{/if}
													</div>
													<button
														type="button"
														class="shrink-0 cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
														onclick={() => addSecret(a.request)}
														>{a.stored ? 'Store again…' : `Add ${a.request.name}…`}</button
													>
												</div>
											{/each}
											{#each matchBridgeCards(part.text, pluginEntries) as { entry, card } (`${entry.key}:${card.key}`)}
												<div
													class="max-w-[80ch] rounded-xl border bg-card p-4"
													data-slot="bridge.card"
												>
													<p class="font-medium">{card.title}</p>
													<div class="mt-2"><Blocks blocks={card.blocks} /></div>
												</div>
											{/each}
										{/if}
										{#each previews.get(part.id) ?? [] as pv (pv.task.id)}
											{@const ptag = previewTag(pv.task.id, pv.task.projectId)}
											{#if v === 'dim' || !current || ptag.topic === current}
												<div class="flex flex-col gap-1">
													<div class="msg-tagline">
														{@render tagOf(ptag, `preview:${pv.task.id}`)}
													</div>
													<ChatPreview
														preview={pv}
														project={projectName(pv.task.projectId)}
														{now}
													/>
												</div>
											{/if}
										{/each}
									{:else if part.kind === 'question'}
										<QuestionCard {part} />
									{:else}
										<Activity steps={part.steps} live={isLive(item, pi)} />
										{#each part.steps as step (step.id)}
											{#if apps[step.id]}<ChatApp
													id={step.id}
													app={apps[step.id]}
													bind:open={
														() => !collapsedApps[step.id], (v) => (collapsedApps[step.id] = !v)
													}
												/>{/if}
										{/each}
									{/if}
								{/each}
								{#if lay.hidden}
									<span class="text-xs text-muted-foreground" data-other-threads
										>+ {lay.hidden}
										{lay.hidden === 1 ? 'part' : 'parts'} about other threads</span
									>
								{/if}
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

				{#each placed.end as d (d.id)}{@render decisionEntry(d)}{/each}
				{#each batches.end as b (b.id)}{@render batchEntry(b)}{/each}
				{#each chatPending as p, pi (p.id)}
					{@const grouped = pi > 0 || lastItem?.kind === 'user'}
					{@const reply = parseReply(p.text)}
					{@const sent = parseAttachments(parseThread(reply.body).text)}
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
		{#if vaultNotice}
			<p
				class="mb-2 flex items-start gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm"
				role="status"
				data-vault-notice
			>
				<span class="min-w-0 flex-1">{vaultNotice}</span>
				<button
					class="-my-0.5 shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
					aria-label="Dismiss"
					onclick={() => (vaultNotice = null)}><X class="size-4" /></button
				>
			</p>
		{/if}
		<Composer
			onvault={() => addSecret(null)}
			{via}
			reason={session?.reason ?? null}
			working={working && !waitingOnAnswer}
			{held}
			{token}
			commands={firstmateChat.commands}
			reply={replyTo}
			oncancelreply={() => (replyTo = null)}
			thread={current && current !== UNSORTED
				? { topic: current, name: threadName(current), hue: threadHue(current) }
				: null}
			threads={moveTo.filter((t) => t.topic !== UNSORTED)}
		/>
	</div>
	<VaultAdd
		bind:open={vaultOpen}
		ask={vaultAsk}
		projects={projects.map((p) => p.id)}
		{token}
		onstored={secretStored}
	/>
</section>
