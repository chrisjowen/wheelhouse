<script lang="ts">
	import { tick } from 'svelte';
	import { ArrowUp, GitPullRequest, Hash, LoaderCircle, Square, SquareSlash } from '@lucide/svelte';
	import { currentFleet } from '$lib/client/live.svelte';
	import { act, sendToInbox } from '$lib/client/chat.svelte';
	import { chipLabel, compose, expandRef, type Piece, type Ref } from '$lib/chat/refs';
	import type { SlashCommand } from '$lib/types';
	import { composerBus } from './bus.svelte';

	/**
	 * The message box, pinned under the chat. Enter sends (Shift+Enter is a new
	 * line); "/" at the start opens Firstmate's and Claude Code's commands; "#"
	 * anywhere opens a picker of tasks and pull requests that inserts a chip,
	 * which reaches Firstmate as the task's id and title (see lib/chat/refs.ts).
	 * While Firstmate works, an empty box offers Stop (Escape in the session);
	 * a message typed meanwhile is queued by Claude Code as in the terminal.
	 * For a Firstmate session running elsewhere, messages go to its inbox
	 * instead, and commands and Stop are not offered.
	 */
	let {
		via,
		reason,
		working,
		token,
		commands
	}: {
		/** session: typed into Wheelhouse's session; inbox: Firstmate's inbox; null: nowhere. */
		via: 'session' | 'inbox' | null;
		/** Why typing is off, shown in place of the placeholder. */
		reason: string | null;
		working: boolean;
		token: string;
		commands: SlashCommand[];
	} = $props();

	const canSend = $derived(via !== null);
	let sentToInbox = $state(false);
	/** The last message was a spec sent from the Spec tab: where to go back to it. */
	let sentSpec = $state<string | null>(null);

	let editor: HTMLDivElement | undefined = $state();
	let empty = $state(true);
	let sending = $state(false);
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

	/** Send through Firstmate's session, or its inbox when it runs elsewhere. */
	async function deliver(text: string): Promise<boolean> {
		sending = true;
		error = null;
		const r =
			via === 'inbox'
				? await sendToInbox(text, token)
				: await act('/api/firstmate/input', token, { text });
		sending = false;
		if (!r.ok) {
			error = r.error;
			return false;
		}
		sentToInbox = via === 'inbox';
		return true;
	}

	// A message sent from another page (the Spec tab), once the box can send it.
	$effect(() => {
		const out = composerBus.outgoing;
		if (!out || !editor || !canSend || sending) return;
		composerBus.outgoing = null;
		void deliver(out.text).then((ok) => {
			sentSpec = ok ? (out.from ?? '/spec') : null;
			if (ok) out.onSent?.();
			else void insertAtEnd(null, out.text);
		});
	});

	async function submit() {
		if (!editor || empty || sending || !canSend) return;
		const text = compose(pieces(editor, editor));
		if (!text) return;
		if (!(await deliver(text))) return;
		sentSpec = null;
		// eslint-disable-next-line svelte/no-dom-manipulating -- the editor's content is the captain's, never Svelte's
		editor.innerHTML = '';
		empty = true;
		menu = null;
		editor.focus();
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

	<div
		class="flex items-end gap-2 rounded-lg border border-input bg-card p-2 pl-4 shadow-sm focus-within:ring-2 focus-within:ring-ring/30 {canSend
			? ''
			: 'opacity-70'}"
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
				disabled={empty || sending || !canSend}
				onclick={submit}
				class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
			>
				{#if sending}<LoaderCircle class="size-4 animate-spin" />{:else}<ArrowUp
						class="size-4"
					/>{/if}
			</button>
		{/if}
	</div>
	{#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>
	{:else if sentSpec}<p class="mt-2 text-xs text-muted-foreground">
			Your spec was sent to Firstmate as one message. <a
				href={sentSpec}
				class="underline underline-offset-2 hover:text-foreground">Back to the spec</a
			>
		</p>
	{:else if composerBus.outgoing && !canSend}<p class="mt-2 text-xs text-muted-foreground">
			Your spec is ready and will be sent as soon as Firstmate can take messages.
		</p>
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
