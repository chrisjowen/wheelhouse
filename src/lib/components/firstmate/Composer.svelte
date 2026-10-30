<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowUp,
		GitPullRequest,
		Hash,
		LoaderCircle,
		Reply,
		Square,
		SquareSlash,
		X
	} from '@lucide/svelte';
	import { currentFleet } from '$lib/client/live.svelte';
	import { act, firstmateChat } from '$lib/client/chat.svelte';
	import { chipLabel, compose, expandRef, type Piece, type Ref } from '$lib/chat/refs';
	import { composeReply, type ReplyTo } from '$lib/chat/reply';
	import type { SlashCommand } from '$lib/types';
	import { dictation, editableTarget } from '$lib/voice/dictation.svelte';
	import MicButton from '$lib/components/wh/MicButton.svelte';
	import { composerBus } from './bus.svelte';

	/**
	 * The message box, pinned under the chat. Enter sends (Shift+Enter is a new
	 * line); "/" at the start opens Firstmate's and Claude Code's commands; "#"
	 * anywhere opens a picker of tasks and pull requests that inserts a chip,
	 * which reaches Firstmate as the task's id and title (see lib/chat/refs.ts).
	 * While Firstmate works, an empty box offers Stop (Escape in the session);
	 * a message typed meanwhile is queued by Claude Code as in the terminal.
	 * The mic dictates into the box (see MicButton); dictated words wait there
	 * like typed ones until the captain sends them.
	 * For a Firstmate session running elsewhere, messages go to its inbox
	 * instead, and commands and Stop are not offered. While a menu is open in the
	 * session (`held`), a message waits in the box rather than landing in it.
	 * Replying to a message shows its quote above the box until it is sent or
	 * cancelled (Escape); the message carries the quote (see lib/chat/reply.ts).
	 */
	let {
		via,
		reason,
		working,
		held = null,
		token,
		commands,
		reply = null,
		oncancelreply
	}: {
		/** session: typed into Wheelhouse's session; inbox: Firstmate's inbox; null: nowhere. */
		via: 'session' | 'inbox' | null;
		/** Why typing is off, shown in place of the placeholder. */
		reason: string | null;
		working: boolean;
		/** Why sending waits for now (a menu is open in the session), or null. */
		held?: string | null;
		token: string;
		commands: SlashCommand[];
		/** The message being replied to, or null. */
		reply?: ReplyTo | null;
		oncancelreply?: () => void;
	} = $props();

	// Starting a reply puts the caret in the box, ready for the answer.
	$effect(() => {
		if (reply && editor && canSend) editor.focus();
	});

	const canSend = $derived(via !== null);
	let sentToInbox = $state(false);

	let editor: HTMLDivElement | undefined = $state();
	let empty = $state(true);
	let stopping = $state(false);
	let error = $state<string | null>(null);

	type Menu = { kind: '/' | '#'; query: string; node: Text; start: number; end: number };
	let menu = $state<Menu | null>(null);
	let active = $state(0);

	const fleet = $derived(currentFleet());
	const refs = $derived.by((): Ref[] => {
		const name = (id: string) => fleet?.projects.find((p) => p.id === id)?.name ?? null;
		const out: Ref[] = [];
		for (const t of fleet?.tasks ?? []) {
			const project = name(t.projectId);
			out.push({ kind: 'task', id: t.id, title: t.shortTitle, project, url: null });
			const url = t.attention?.url ?? t.pr?.url;
			if (url) out.push({ kind: 'pr', id: t.id, title: t.shortTitle, project, url });
		}
		return out;
	});

	type Item = { kind: 'command'; c: SlashCommand } | { kind: 'ref'; r: Ref };
	const items = $derived.by((): Item[] => {
		if (!menu) return [];
		const q = menu.query.toLowerCase();
		if (menu.kind === '/') {
			if (via !== 'session') return [];
			return commands
				.filter((c) => c.name.toLowerCase().includes(q))
				.sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
				.map((c) => ({ kind: 'command' as const, c }));
		}
		return refs
			.filter((r) =>
				`${r.title} ${r.project ?? ''} ${r.id} ${r.url ?? ''}`.toLowerCase().includes(q)
			)
			.slice(0, 8)
			.map((r) => ({ kind: 'ref' as const, r }));
	});

	function refresh() {
		if (!editor) return;
		empty = !editor.textContent?.trim() && !editor.querySelector('[data-ref]');
		const sel = window.getSelection();
		const node = sel?.anchorNode;
		if (!sel || !sel.isCollapsed || !(node instanceof Text) || !editor.contains(node)) {
			menu = null;
			return;
		}
		const before = node.data.slice(0, sel.anchorOffset);
		const m = before.match(/(?:^|[\s\u00a0])([/#])([\w.:-]*)$/);
		if (!m) {
			menu = null;
			return;
		}
		const start = sel.anchorOffset - m[2].length - 1;
		// "/" commands only at the very start of the message, as in Claude Code.
		if (m[1] === '/') {
			const range = document.createRange();
			range.setStart(editor, 0);
			range.setEnd(node, start);
			if (range.toString().trim() || range.cloneContents().querySelector('[data-ref]')) {
				menu = null;
				return;
			}
		}
		const kind = m[1] as '/' | '#';
		if (!menu || menu.kind !== kind || menu.query !== m[2]) active = 0;
		menu = { kind, query: m[2], node, start, end: sel.anchorOffset };
	}

	function caretAfter(n: Node) {
		const r = document.createRange();
		r.setStartAfter(n);
		r.collapse(true);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	}

	function chip(ref: Ref): HTMLSpanElement {
		const s = document.createElement('span');
		s.contentEditable = 'false';
		s.dataset.ref = JSON.stringify(ref);
		s.className = 'ref-chip';
		s.textContent = chipLabel(ref);
		s.title = expandRef(ref);
		return s;
	}

	function choose(item: Item) {
		if (!menu || !editor) return;
		const { node, start, end } = menu;
		const r = document.createRange();
		r.setStart(node, start);
		r.setEnd(node, end);
		r.deleteContents();
		let last: Node;
		if (item.kind === 'command') {
			last = document.createTextNode(`/${item.c.name}\u00a0`);
			r.insertNode(last);
		} else {
			last = document.createTextNode('\u00a0');
			r.insertNode(last);
			r.insertNode(chip(item.r));
		}
		caretAfter(last);
		menu = null;
		refresh();
	}

	/** "Chat about this" from a rail card: append the task's chip and focus the box. */
	async function insertAtEnd(ref: Ref | null, draft: string | null = null) {
		if (!editor || !canSend) return;
		editor.focus();
		const text = editor.textContent ?? '';
		// eslint-disable-next-line svelte/no-dom-manipulating -- the editor's content is the captain's, never Svelte's
		if (text && !/[\s\u00a0]$/.test(text)) editor.append(document.createTextNode(' '));
		const nodes: Node[] = ref ? [chip(ref), document.createTextNode('\u00a0')] : [];
		if (draft) nodes.push(document.createTextNode(draft));
		if (!nodes.length) return;
		// eslint-disable-next-line svelte/no-dom-manipulating -- the editor's content is the captain's, never Svelte's
		editor.append(...nodes);
		await tick();
		caretAfter(nodes[nodes.length - 1]);
		refresh();
	}

	// Taken once the box can take it (the session may still be loading when it arrives).
	$effect(() => {
		const ref = composerBus.pending;
		const draft = composerBus.draft;
		if ((ref || draft) && editor && canSend) {
			composerBus.pending = null;
			composerBus.draft = null;
			void insertAtEnd(ref, draft);
		}
	});

	/** The editor's content as text runs and chips, in order. */
	function pieces(n: Node, root: Node): Piece[] {
		if (n instanceof Text) return [n.data];
		if (!(n instanceof HTMLElement)) return [];
		if (n.dataset.ref) return [JSON.parse(n.dataset.ref) as Ref];
		if (n.tagName === 'BR') return ['\n'];
		const inner = [...n.childNodes].flatMap((c) => pieces(c, root));
		return n !== root && n.tagName === 'DIV' ? ['\n', ...inner] : inner;
	}

	/**
	 * Send through Firstmate's session, or its inbox when it runs elsewhere. The chat
	 * shows the message at once as a pending bubble, with a retry if it fails.
	 */
	async function deliver(text: string): Promise<boolean> {
		if (!via) return false;
		error = null;
		const r = await firstmateChat.send(text, via, token, working);
		if (!r.ok) return false;
		sentToInbox = via === 'inbox';
		return true;
	}

	async function submit() {
		if (editor?.querySelector('[data-dictation]')) dictation.commit();
		if (!editor || empty || !canSend || held) return;
		const words = compose(pieces(editor, editor));
		if (!words) return;
		const text = reply ? composeReply(reply, words) : words;
		oncancelreply?.();
		// Cleared at once: the message shows in the chat as pending, with a retry if it fails.
		// eslint-disable-next-line svelte/no-dom-manipulating -- the editor's content is the captain's, never Svelte's
		editor.innerHTML = '';
		empty = true;
		menu = null;
		editor.focus();
		await deliver(text);
	}

	async function stop() {
		stopping = true;
		error = null;
		const r = await act('/api/firstmate/interrupt', token);
		stopping = false;
		if (!r.ok) error = r.error;
	}

	function onkeydown(e: KeyboardEvent) {
		if (menu && items.length) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				choose(items[active]);
				return;
			}
		}
		if (menu && e.key === 'Escape') {
			e.preventDefault();
			menu = null;
			return;
		}
		if (reply && e.key === 'Escape') {
			e.preventDefault();
			oncancelreply?.();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void submit();
		}
	}

	function onpaste(e: ClipboardEvent) {
		e.preventDefault();
		document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
	}

	const placeholder = $derived(
		via === 'session'
			? 'Message Firstmate · / for commands · # to mention a task'
			: via === 'inbox'
				? 'Message Firstmate’s inbox · # to mention a task'
				: (reason ?? 'Firstmate is not running here.')
	);
</script>

<div class="relative">
	{#if menu && items.length}
		<div
			class="absolute right-0 bottom-full left-0 z-20 mb-2 no-scrollbar max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg"
			role="listbox"
			aria-label={menu.kind === '/' ? 'Commands' : 'Tasks and pull requests'}
		>
			{#each items as item, i (item.kind === 'command' ? item.c.name : `${item.r.kind}:${item.r.id}`)}
				{@const prev = items[i - 1]}
				{#if item.kind === 'command' && (!prev || (prev.kind === 'command' && prev.c.source !== item.c.source))}
					<div class="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
						{item.c.source === 'firstmate' ? 'Firstmate' : 'Claude Code'}
					</div>
				{/if}
				<button
					role="option"
					aria-selected={i === active}
					class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm {i ===
					active
						? 'bg-muted'
						: ''}"
					onmousedown={(e) => {
						e.preventDefault();
						choose(item);
					}}
					onmouseenter={() => (active = i)}
				>
					{#if item.kind === 'command'}
						<SquareSlash class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="shrink-0 font-medium">/{item.c.name}</span>
						<span class="min-w-0 truncate text-muted-foreground">{item.c.description}</span>
					{:else}
						{#if item.r.kind === 'pr'}
							<GitPullRequest class="size-4 shrink-0 text-sea" aria-hidden="true" />
						{:else}
							<Hash class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						{/if}
						<span class="min-w-0 truncate"
							>{item.r.kind === 'pr' ? `Pull request · ${item.r.title}` : item.r.title}</span
						>
						{#if item.r.project}<span class="ml-auto shrink-0 text-xs text-muted-foreground"
								>{item.r.project}</span
							>{/if}
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if reply}
		<div class="reply-draft" role="group" aria-label="Replying to a message">
			<Reply class="size-4 shrink-0 text-sea" aria-hidden="true" />
			<div class="min-w-0 flex-1">
				<p class="text-xs font-medium text-sea">
					Replying to {reply.who === 'firstmate' ? 'Firstmate' : 'yourself'}
				</p>
				<p class="truncate text-sm text-muted-foreground">{reply.snippet}</p>
			</div>
			<button
				class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Cancel the reply"
				title="Cancel the reply (Esc)"
				onclick={() => oncancelreply?.()}><X class="size-4" /></button
			>
		</div>
	{/if}
	<div
		class="flex items-end gap-2 rounded-lg border border-input bg-card p-2 pl-4 shadow-sm focus-within:ring-2 focus-within:ring-ring/30 {canSend
			? ''
			: 'opacity-70'} {reply ? 'rounded-t-none' : ''}"
	>
		<div
			bind:this={editor}
			contenteditable={canSend ? 'true' : 'false'}
			role="textbox"
			tabindex={canSend ? 0 : -1}
			aria-multiline="true"
			aria-label="Message Firstmate"
			aria-disabled={!canSend}
			data-placeholder={placeholder}
			class="editor no-scrollbar max-h-48 min-h-10 flex-1 overflow-y-auto py-2 text-base leading-relaxed whitespace-pre-wrap outline-none {empty
				? 'is-empty'
				: ''} {canSend ? '' : 'cursor-not-allowed'}"
			oninput={refresh}
			onkeyup={(e) => {
				if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) refresh();
			}}
			onclick={refresh}
			onblur={() => setTimeout(() => (menu = null), 100)}
			{onkeydown}
			{onpaste}
		></div>
		<MicButton
			field={editor}
			target={() => editableTarget(editor!, refresh)}
			label="Dictate a message"
			disabled={!canSend}
		/>
		{#if working && empty && via === 'session'}
			<button
				aria-label="Stop Firstmate"
				title="Stop what Firstmate is doing (Escape)"
				disabled={stopping}
				onclick={stop}
				class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
			>
				{#if stopping}<LoaderCircle class="size-4 animate-spin" />{:else}<Square
						class="size-3.5 fill-current"
					/>{/if}
			</button>
		{:else}
			<button
				aria-label="Send"
				disabled={empty || !canSend || !!held}
				onclick={submit}
				class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
			>
				<ArrowUp class="size-4" />
			</button>
		{/if}
	</div>
	{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{:else if held}<p class="mt-2 text-xs text-muted-foreground" data-held>{held}</p>
	{:else if via === 'inbox'}<p class="mt-2 text-xs text-muted-foreground">
			{sentToInbox
				? 'Sent to Firstmate’s inbox. It reads it at its next turn, and its reply appears here.'
				: 'Firstmate runs in another terminal, so messages go to its inbox.'}
		</p>{/if}
</div>

<style>
	.editor.is-empty::before {
		content: attr(data-placeholder);
		color: var(--muted-foreground);
		pointer-events: none;
		position: absolute;
	}
	.editor :global(.dictation-forming) {
		color: var(--muted-foreground);
	}
	.editor :global(.ref-chip) {
		display: inline-block;
		margin: 0 1px;
		padding: 0 0.45em;
		border-radius: 0.375rem;
		background: color-mix(in oklab, var(--sea) 14%, transparent);
		color: var(--sea);
		font-size: 0.875em;
		font-weight: 500;
		line-height: 1.6;
		white-space: nowrap;
		user-select: all;
	}
</style>
