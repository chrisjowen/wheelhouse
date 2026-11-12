<script lang="ts">
	import { onMount } from 'svelte';
	import type { Terminal } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import {
		TERMINAL_CLOSE,
		TERMINAL_PROTOCOL,
		TERMINAL_PATH,
		TOKEN_PROTOCOL_PREFIX,
		type TerminalMessage
	} from '$lib/terminal';
	import { barKeyInput, keyboardCover, typedInput, type BarKey } from '$lib/terminalkeys';
	import { touch } from '$lib/client/phone.svelte';
	import { Button } from '$lib/components/ui/button';
	import { LoaderCircle, RotateCw } from '@lucide/svelte';
	import TerminalKeyBar from './TerminalKeyBar.svelte';

	/**
	 * The Firstmate session's own terminal, live, for anything the chat cannot
	 * show (see src/lib/server/sessions/terminal.ts). Keystrokes, paste and
	 * resizes go to the session's tmux pane; its output streams back. With tmux's
	 * mouse mode on, the wheel reaches Claude Code's own scrolling. Nothing
	 * reconnects by itself: when the socket closes the captain is told why and
	 * can reconnect. On a touch screen a key bar under it sends the keys a phone's
	 * keyboard lacks (see TerminalKeyBar), and the terminal keeps clear of the
	 * phone's keyboard, which would otherwise cover its bottom rows.
	 */
	let {
		token,
		onclosed,
		path = TERMINAL_PATH,
		label = 'Firstmate’s terminal',
		connecting = 'Connecting to the session…',
		detached = 'The session ended or was detached.',
		claudeKeys = true
	}: {
		token: string;
		/** The socket closed, with its close code. */
		onclosed?: (code: number) => void;
		/** The WebSocket path: the Firstmate session's (default) or setup's own. */
		path?: string;
		label?: string;
		/** What it says while it connects, and once its program exits. */
		connecting?: string;
		detached?: string;
		/** Translate Shift+Enter only for Claude Code's terminal protocol. */
		claudeKeys?: boolean;
	} = $props();

	let host: HTMLDivElement;
	let frame = $state<HTMLDivElement | null>(null);
	let status = $state<'connecting' | 'open' | 'closed'>('connecting');
	let closedBecause = $state<string | null>(null);
	let reconnect = $state<() => void>(() => {});
	/** Ctrl from the key bar, armed for the next key. */
	let ctrl = $state(false);
	let pressKey = $state<(key: BarKey) => void>(() => {});
	/** How much of the terminal the phone's keyboard covers, in pixels. */
	let cover = $state(0);

	// The phone's keyboard shrinks only the visual viewport, so the terminal pads its bottom
	// by what the keyboard covers: the key bar and the prompt sit just above the keyboard.
	$effect(() => {
		const el = frame;
		const vv = window.visualViewport;
		if (!touch.current || !el || !vv) {
			cover = 0;
			return;
		}
		const update = () => (cover = keyboardCover(el.getBoundingClientRect().bottom, vv));
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		const observer = new ResizeObserver(update);
		observer.observe(el);
		update();
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
			observer.disconnect();
		};
	});

	const FONT_SIZE = 13;
	// Claude Code's TUI is drawn for a dark terminal, so the surface is dark in both themes.
	// Its shade is the theme's --console token, re-read when the theme changes.
	const theme = () => {
		const background =
			getComputedStyle(document.documentElement).getPropertyValue('--console').trim() || '#0b1120';
		return {
			background,
			foreground: '#cbd5e1',
			cursor: '#cbd5e1',
			cursorAccent: background,
			selectionBackground: '#334155',
			scrollbarSliderBackground: 'transparent',
			scrollbarSliderHoverBackground: 'transparent',
			scrollbarSliderActiveBackground: 'transparent'
		};
	};

	onMount(() => {
		let disposed = false;
		let ws: WebSocket | null = null;
		let term: Terminal | null = null;
		let fit: FitAddon | null = null;
		let observer: ResizeObserver | null = null;
		let themeWatch: MutationObserver | null = null;

		const send = (m: TerminalMessage) => {
			if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
		};
		const input = (r: { data: string; ctrl: boolean }) => {
			ctrl = r.ctrl;
			if (r.data) send({ type: 'input', data: r.data });
		};
		pressKey = (key) =>
			input(
				barKeyInput(key, {
					ctrl,
					applicationCursor: term?.modes.applicationCursorKeysMode ?? false
				})
			);

		const connect = () => {
			if (!term || disposed) return;
			const t = term;
			ws?.close();
			t.reset();
			status = 'connecting';
			closedBecause = null;
			const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const url = `${scheme}//${location.host}${path}?cols=${t.cols}&rows=${t.rows}`;
			const socket = new WebSocket(url, [TERMINAL_PROTOCOL, TOKEN_PROTOCOL_PREFIX + token]);
			socket.binaryType = 'arraybuffer';
			ws = socket;
			socket.onopen = () => {
				status = 'open';
				send({ type: 'resize', cols: t.cols, rows: t.rows });
				t.focus();
			};
			socket.onmessage = (e) => {
				if (e.data instanceof ArrayBuffer) t.write(new Uint8Array(e.data));
			};
			socket.onclose = (e) => {
				if (ws !== socket || disposed) return;
				status = 'closed';
				closedBecause =
					e.code === TERMINAL_CLOSE.detached
						? detached
						: e.code === TERMINAL_CLOSE.shutdown
							? e.reason || 'Wheelhouse closed.'
							: e.reason ||
								'Wheelhouse refused or lost the connection. If the session is still running, reconnect; if Wheelhouse restarted, reload the page.';
				onclosed?.(e.code);
			};
		};
		reconnect = connect;

		void (async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit')
			]);
			if (disposed) return;
			// Measure cells in the page's monospace font, not a fallback still on screen while it loads.
			const fontFamily = getComputedStyle(host).fontFamily;
			await document.fonts?.load(`${FONT_SIZE}px ${fontFamily}`).catch(() => {});
			if (disposed) return;
			term = new Terminal({
				fontFamily,
				fontSize: FONT_SIZE,
				lineHeight: 1.15,
				cursorBlink: true,
				// tmux keeps the history (and its client is always on the alternate screen), so
				// xterm keeps none: no scrollbar, and no gutter reserved for one.
				scrollback: 0,
				macOptionClickForcesSelection: true,
				allowProposedApi: false,
				theme: theme()
			});
			fit = new FitAddon();
			term.loadAddon(fit);
			term.open(host);
			fit.fit();
			term.onData((data) => input(typedInput(data, ctrl)));
			term.onBinary((data) => send({ type: 'input', data }));
			term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
			// Enter submits as in any terminal; Shift+Enter is Claude Code's newline (ESC CR).
			term.attachCustomKeyEventHandler((e) => {
				if (
					claudeKeys &&
					e.key === 'Enter' &&
					e.shiftKey &&
					!e.altKey &&
					!e.ctrlKey &&
					!e.metaKey
				) {
					if (e.type === 'keydown') send({ type: 'input', data: '\x1b\r' });
					return false;
				}
				return true;
			});
			observer = new ResizeObserver(() => fit?.fit());
			observer.observe(host);
			themeWatch = new MutationObserver(() => {
				if (term) term.options.theme = theme();
			});
			themeWatch.observe(document.documentElement, { attributeFilter: ['class'] });
			connect();
		})();

		return () => {
			disposed = true;
			observer?.disconnect();
			themeWatch?.disconnect();
			ws?.close();
			term?.dispose();
		};
	});
</script>

<div
	bind:this={frame}
	class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-console"
	style:padding-bottom={cover ? `${cover}px` : null}
>
	<div class="relative flex min-h-0 flex-1 flex-col">
		<div
			bind:this={host}
			class="session-terminal min-h-0 flex-1 font-mono"
			aria-label={label}
		></div>
		{#if status !== 'open'}
			<div
				class="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-console/95 px-4 py-3 text-sm text-slate-300"
				role="status"
			>
				{#if status === 'connecting'}
					<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
					<span>{connecting}</span>
				{:else}
					<span class="min-w-0 flex-1">{closedBecause}</span>
					<Button size="sm" variant="secondary" onclick={() => reconnect()}
						><RotateCw />Reconnect</Button
					>
				{/if}
			</div>
		{/if}
	</div>
	{#if touch.current}
		<TerminalKeyBar
			{ctrl}
			disabled={status !== 'open'}
			onkey={(key) => pressKey(key)}
			onctrl={() => (ctrl = !ctrl)}
		/>
	{/if}
</div>

<style>
	/* No visible scrollbars on the terminal surface; the wheel scrolls inside the session. */
	.session-terminal :global(.xterm-viewport),
	.session-terminal :global(.xterm-scrollable-element) {
		scrollbar-width: none;
	}
	/* xterm's viewport covers the padding too and is black by default. */
	.session-terminal :global(.xterm-viewport) {
		background-color: var(--console) !important;
	}
	.session-terminal :global(.xterm-viewport::-webkit-scrollbar),
	.session-terminal :global(.xterm-scrollable-element::-webkit-scrollbar) {
		display: none;
	}
	.session-terminal :global(.xterm .scrollbar) {
		display: none !important;
	}
	/* Padding on .xterm itself, which the fit addon subtracts (it ignores the parent's). */
	.session-terminal :global(.xterm) {
		height: 100%;
		padding: 0.5rem 0.75rem;
		background-color: var(--console);
	}
</style>
