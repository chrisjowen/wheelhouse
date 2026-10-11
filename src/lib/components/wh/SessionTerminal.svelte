<script lang="ts">
	import { onMount } from 'svelte';
	import type { Terminal } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import {
		TERMINAL_CLOSE,
		TERMINAL_PROTOCOL,
		TOKEN_PROTOCOL_PREFIX,
		terminalPath,
		type TerminalMessage
	} from '$lib/sessions';
	import { Button } from '$lib/components/ui/button';
	import { LoaderCircle, RotateCw } from '@lucide/svelte';

	/**
	 * A live, interactive terminal attached to one of the captain's sessions over
	 * a WebSocket (see src/lib/server/sessions/terminal.ts). Keystrokes, paste and
	 * resizes go to the session's tmux pane; its output streams back. With tmux's
	 * mouse mode on, the wheel reaches Claude Code's own scrolling (or tmux's
	 * history for a plain screen). Nothing reconnects by itself: when the socket
	 * closes the captain is told why and can reconnect.
	 */
	let { id, token, onclosed }: { id: string; token: string; onclosed?: () => void } = $props();

	let host: HTMLDivElement;
	let status = $state<'connecting' | 'open' | 'closed'>('connecting');
	let closedBecause = $state<string | null>(null);
	let reconnect = $state<() => void>(() => {});

	const FONT_SIZE = 13;
	// Claude Code's TUI is drawn for a dark terminal, so the surface is dark in both themes.
	const theme = {
		background: '#0b1120',
		foreground: '#cbd5e1',
		cursor: '#cbd5e1',
		cursorAccent: '#0b1120',
		selectionBackground: '#334155',
		scrollbarSliderBackground: 'transparent',
		scrollbarSliderHoverBackground: 'transparent',
		scrollbarSliderActiveBackground: 'transparent'
	};

	onMount(() => {
		let disposed = false;
		let ws: WebSocket | null = null;
		let term: Terminal | null = null;
		let fit: FitAddon | null = null;
		let observer: ResizeObserver | null = null;

		const send = (m: TerminalMessage) => {
			if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
		};

		const connect = () => {
			if (!term || disposed) return;
			const t = term;
			ws?.close();
			t.reset();
			status = 'connecting';
			closedBecause = null;
			const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
			const url = `${scheme}//${location.host}${terminalPath(id)}?cols=${t.cols}&rows=${t.rows}`;
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
						? 'The session ended or was detached.'
						: e.code === TERMINAL_CLOSE.shutdown
							? 'Wheelhouse closed.'
							: e.reason ||
								'Wheelhouse refused or lost the connection. If the session is still running, reconnect; if Wheelhouse restarted, reload the page.';
				onclosed?.();
			};
		};
		reconnect = connect;

		void (async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit')
			]);
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
				theme
			});
			fit = new FitAddon();
			term.loadAddon(fit);
			term.open(host);
			fit.fit();
			term.onData((data) => send({ type: 'input', data }));
			term.onBinary((data) => send({ type: 'input', data }));
			term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
			// Enter submits as in any terminal; Shift+Enter is Claude Code's newline (ESC CR).
			term.attachCustomKeyEventHandler((e) => {
				if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
					if (e.type === 'keydown') send({ type: 'input', data: '\x1b\r' });
					return false;
				}
				return true;
			});
			observer = new ResizeObserver(() => fit?.fit());
			observer.observe(host);
			connect();
		})();

		return () => {
			disposed = true;
			observer?.disconnect();
			ws?.close();
			term?.dispose();
		};
	});
</script>

<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#0b1120]">
	<div
		bind:this={host}
		class="session-terminal min-h-0 flex-1 font-mono"
		aria-label="Session terminal"
	></div>
	{#if status !== 'open'}
		<div
			class="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0b1120]/95 px-4 py-3 text-sm text-slate-300"
			role="status"
		>
			{#if status === 'connecting'}
				<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
				<span>Connecting to the session…</span>
			{:else}
				<span class="min-w-0 flex-1">{closedBecause}</span>
				<Button size="sm" variant="secondary" onclick={() => reconnect()}
					><RotateCw />Reconnect</Button
				>
			{/if}
		</div>
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
		background-color: #0b1120 !important;
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
		background-color: #0b1120;
	}
</style>
