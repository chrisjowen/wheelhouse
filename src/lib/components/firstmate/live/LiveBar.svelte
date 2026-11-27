<script lang="ts">
	import {
		Anchor,
		FileText,
		LogOut,
		Minimize2,
		Moon,
		SlidersHorizontal,
		Sun,
		TriangleAlert
	} from '@lucide/svelte';
	import { liveCall, type LiveState } from '$lib/client/livecall.svelte';
	import { theme, toggleTheme } from '$lib/client/theme.svelte';
	import { BROWSER } from '$lib/voice/settings';

	/**
	 * Live mode's bar across the top: the logo and Live, who the captain is
	 * talking to, how long for and whose turn it is; with voice on, a level
	 * meter that follows whoever is speaking and the call's voice settings
	 * (push to talk or always on, headphones, speed; voices and providers are
	 * chosen in Settings → Voice); the way out to the app while the call
	 * carries on (the header brings it back); light or dark; and End, which
	 * asks whether to end with the Captain's briefing, sent to Firstmate
	 * straight away, or just quit without one. Quitting with hand-offs for
	 * Firstmate still waiting asks first, since they would be discarded.
	 */

	let canvas = $state<HTMLCanvasElement | null>(null);
	let open = $state(false);
	let clock = $state('00:00');
	let showContext = $state(false);
	let touch = $state(false);
	$effect(() => {
		const coarse = matchMedia('(pointer: coarse), (max-width: 640px)');
		touch = coarse.matches;
		const changed = () => (touch = coarse.matches);
		coarse.addEventListener('change', changed);
		return () => coarse.removeEventListener('change', changed);
	});
	let contextDialog = $state<HTMLDialogElement | null>(null);
	/** Just quit was chosen with hand-offs still waiting: confirm discarding them. */
	let confirmQuit = $state(false);
	$effect(() => {
		if (!liveCall.choosingEnd) confirmQuit = false;
	});
	const waiting = $derived(liveCall.waitingHandoffs);
	function quit() {
		if (waiting && !confirmQuit) confirmQuit = true;
		else void liveCall.end(false);
	}

	const ptt = $derived(liveCall.prefs.input === 'ptt');
	const voice = $derived(liveCall.voiceOn);
	const LINES: Record<LiveState, string> = {
		off: 'Ended',
		starting: 'Briefing the crew on the fleet…',
		ready: 'Your turn',
		listening: 'Listening · talk any time',
		muted: 'Microphone off · type, or press M',
		hearing: 'Hearing you',
		transcribing: 'Transcribing what you said…',
		thinking: 'Thinking',
		speaking: 'Speaking',
		ending: 'Ending…'
	};
	const line = $derived(
		liveCall.state === 'ending' && liveCall.briefing
			? 'Writing the Captain’s briefing…'
			: LINES[liveCall.state]
	);
	const hint = $derived(
		!voice
			? liveCall.state === 'ready'
				? ' · type below'
				: ''
			: liveCall.state === 'ready'
				? touch
					? ' · hold to talk'
					: ' · hold Space for 2 s to talk'
				: liveCall.state === 'hearing'
					? ptt
						? ` · let go${touch ? '' : ' of Space'} to send`
						: ' · pause when you are done'
					: liveCall.state === 'thinking' || liveCall.state === 'speaking'
						? ptt
							? ` · hold${touch ? '' : ' Space'} to cut in`
							: ' · talk to cut in'
						: ''
	);
	const voiceName = $derived.by(() => {
		const v = liveCall.voice;
		if (!v || v.effective.speak === BROWSER) return 'Browser voice';
		const p = v.providers.find((x) => x.id === v.effective.speak);
		return `${p?.voices.find((x) => x.id === v.effective.voice)?.name ?? p?.voices[0]?.name ?? ''} · ${p?.label ?? ''}`;
	});

	$effect(() => {
		const tick = setInterval(() => {
			const s = liveCall.startedAt ? Math.floor((Date.now() - liveCall.startedAt) / 1000) : 0;
			clock = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
		}, 1000);
		return () => clearInterval(tick);
	});

	// The meter: fixed bars, eased toward the level, so nothing on the page moves but the bars.
	$effect(() => {
		const c = canvas;
		if (!c) return;
		const g = c.getContext('2d');
		if (!g) return;
		const bars = new Array(14).fill(0);
		let shown = 0;
		let frame = 0;
		const draw = () => {
			const target = liveCall.level();
			shown += (target - shown) * (target > shown ? 0.25 : 0.07);
			const css = getComputedStyle(c);
			const state = liveCall.state;
			const colour =
				state === 'speaking'
					? css.getPropertyValue('--foreground')
					: state === 'thinking' || state === 'transcribing' || state === 'starting'
						? css.getPropertyValue('--sea')
						: state === 'hearing' || state === 'listening'
							? css.getPropertyValue('--teal')
							: css.getPropertyValue('--muted-foreground');
			const { width: W, height: H } = c;
			g.clearRect(0, 0, W, H);
			const t = performance.now() / 1000;
			const bw = W / (bars.length * 1.8);
			const gap = (W - bars.length * bw) / (bars.length - 1);
			g.fillStyle = colour.trim() || '#8e9aa6';
			for (let i = 0; i < bars.length; i++) {
				const busy = state === 'thinking' || state === 'transcribing' || state === 'starting';
				const want = busy
					? 0.18 + 0.25 * Math.max(0, Math.sin(t * 4 - i * 0.6))
					: shown * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.9 + t * 1.4)));
				bars[i] += (want - bars[i]) * 0.25;
				const h = Math.max(bw, bars[i] * H);
				g.globalAlpha = 0.35 + bars[i] * 0.65;
				g.beginPath();
				g.roundRect(i * (bw + gap), (H - h) / 2, bw, h, bw / 2);
				g.fill();
			}
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		if (showContext) contextDialog?.showModal();
		else contextDialog?.close();
	});
</script>

<svelte:window
	onclick={(e) => {
		const at = e.target as HTMLElement;
		if (open && !at.closest('[data-live-settings]')) open = false;
		// A click that swapped the menu's own contents leaves its target detached: still inside.
		if (
			liveCall.choosingEnd &&
			at.isConnected &&
			!at.closest('[data-live-end], [data-live-toggle]')
		)
			liveCall.choosingEnd = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && liveCall.choosingEnd) liveCall.choosingEnd = false;
	}}
/>

<header
	class="sticky top-0 z-30 flex h-15 shrink-0 items-center gap-3 border-b border-hair/60 bg-background/80 px-3 backdrop-blur max-md:h-14 sm:px-5"
	data-live-bar
>
	<span class="flex shrink-0 items-center gap-2.5" aria-label="Wheelhouse Live">
		<span class="logo-mark"><Anchor class="size-5" aria-hidden="true" /></span><span
			class="font-title text-[1.6rem] leading-none">Live</span
		>
	</span>
	<div class="min-w-0 flex-1 border-l border-hair/70 pl-3">
		<p class="flex items-baseline gap-2 text-sm whitespace-nowrap">
			<b class="font-semibold">Discussion crew</b>
			{#if liveCall.on}<span class="font-mono text-xs text-muted-foreground tabular-nums"
					>{clock}</span
				>{/if}
			{#if voice}<span class="hidden truncate text-xs text-muted-foreground sm:inline"
					>{voiceName}</span
				>{/if}
		</p>
		<p class="h-[1.15rem] truncate text-xs text-muted-foreground" role="status">
			<b class="font-semibold text-sea">{line}</b>{hint}
		</p>
	</div>
	{#if voice}
		<canvas
			bind:this={canvas}
			width="184"
			height="52"
			class="h-[22px] w-[56px] shrink-0 sm:h-[26px] sm:w-[92px]"
			aria-hidden="true"
		></canvas>
	{/if}
	<button
		type="button"
		class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground max-md:hidden"
		aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
		onclick={toggleTheme}
		>{#if theme.dark}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}</button
	>
	{#if liveCall.on}
		<button
			type="button"
			class="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
			title="Back to the app; the call carries on, and the header’s Live brings it back"
			aria-label="Step out to the app"
			onclick={() => liveCall.stepOut()}
			data-live-step-out
			><Minimize2 class="size-4" aria-hidden="true" /><span class="max-md:hidden">Step out</span
			></button
		>
	{/if}
	<div class="relative" data-live-settings class:hidden={!liveCall.on}>
		<button
			class="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Live mode settings"
			aria-expanded={open}
			onclick={() => (open = !open)}><SlidersHorizontal class="size-4" /></button
		>
		{#if open}
			<div
				class="absolute top-full right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-sm shadow-lg"
			>
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Microphone</p>
				<div class="mt-2 grid grid-cols-2 overflow-hidden rounded-md border">
					{#each [['ptt', 'Push to talk'], ['always', 'Always on']] as [id, label] (id)}
						<button
							class="cursor-pointer px-2 py-1.5 {liveCall.prefs.input === id
								? 'bg-sea/15 font-semibold text-sea'
								: 'text-muted-foreground hover:bg-muted'}"
							aria-pressed={liveCall.prefs.input === id}
							onclick={() => liveCall.setPrefs({ input: id as 'ptt' | 'always' })}>{label}</button
						>
					{/each}
				</div>
				<p class="mt-2 text-xs text-muted-foreground">
					{ptt
						? 'Hold Space for 2 seconds (or the mic button) while you talk, with the pointer over the chat; let go to send. Pressing cuts the crew off.'
						: 'Listens all the time and sends when you pause; talk over the crew to cut it off. M mutes.'}
				</p>
				<label class="mt-3 flex cursor-pointer items-center gap-2 text-sm">
					<input
						type="checkbox"
						class="accent-primary"
						checked={liveCall.prefs.headphones}
						onchange={(e) => liveCall.setPrefs({ headphones: e.currentTarget.checked })}
					/>
					On headphones: any sound from me cuts in at once
				</label>
				<label class="mt-3 flex items-center gap-2 text-sm">
					Speed
					<select
						class="ml-auto rounded-md border bg-card px-2 py-1"
						value={String(liveCall.prefs.speed)}
						onchange={(e) => liveCall.setPrefs({ speed: Number(e.currentTarget.value) })}
					>
						{#each ['0.9', '1', '1.1', '1.2'] as s (s)}<option value={s}>{s}×</option>{/each}
					</select>
				</label>
				<div class="mt-3 flex gap-3 border-t pt-3 text-xs">
					<a class="text-sea hover:underline" href="/settings/voice">Voices in Settings → Voice</a>
					<button
						class="ml-auto cursor-pointer text-muted-foreground hover:text-foreground hover:underline"
						onclick={() => ((showContext = true), (open = false))}>What the crew was told</button
					>
				</div>
			</div>
		{/if}
	</div>
	<div class="relative" data-live-end class:hidden={!liveCall.on}>
		<button
			type="button"
			data-live-end-button
			class="h-8 shrink-0 cursor-pointer rounded-md border border-danger/50 px-3 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50 {liveCall.choosingEnd
				? 'bg-danger/10'
				: ''}"
			aria-expanded={liveCall.choosingEnd}
			aria-haspopup="menu"
			disabled={liveCall.state === 'ending' || liveCall.state === 'starting'}
			onclick={() => (liveCall.choosingEnd = !liveCall.choosingEnd)}>End</button
		>
		{#if liveCall.choosingEnd}
			<div
				class="absolute top-full right-0 z-30 mt-2 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-sm shadow-lg"
				role="menu"
				aria-label="End the discussion"
				data-live-end-choice
			>
				<p
					class="border-b px-4 py-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
				>
					End the discussion
				</p>
				<button
					class="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-muted"
					role="menuitem"
					onclick={() => void liveCall.end(true)}
					data-live-end-brief
				>
					<FileText class="mt-0.5 size-4 shrink-0 text-sea" aria-hidden="true" />
					<span>
						<b class="block font-semibold">End and send the briefing</b>
						<span class="block text-xs leading-snug text-muted-foreground"
							>The crew writes a Captain’s briefing{waiting
								? `, with ${waiting} waiting hand-off${waiting === 1 ? '' : 's'}`
								: ''}, and it goes to Firstmate straight away. The chat shows the briefing, not the
							whole discussion.</span
						>
					</span>
				</button>
				{#if confirmQuit}
					<div class="border-t bg-danger/5 px-4 py-3" data-live-quit-confirm>
						<p class="flex items-start gap-2 text-sm">
							<TriangleAlert class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
							<span
								>{waiting} hand-off{waiting === 1 ? '' : 's'} for Firstmate {waiting === 1
									? 'has'
									: 'have'} not been sent. Quitting discards {waiting === 1 ? 'it' : 'them'}.</span
							>
						</p>
						<div class="mt-3 flex justify-end gap-2">
							<button
								class="h-8 cursor-pointer rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
								onclick={() => (confirmQuit = false)}>Back</button
							>
							<button
								class="h-8 cursor-pointer rounded-md bg-danger px-3 text-xs font-medium text-white"
								role="menuitem"
								onclick={quit}>Discard and quit</button
							>
						</div>
					</div>
				{:else}
					<button
						class="flex w-full cursor-pointer items-start gap-3 border-t px-4 py-3 text-left hover:bg-muted"
						role="menuitem"
						onclick={quit}
					>
						<LogOut class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span>
							<b class="block font-semibold">Just quit</b>
							<span class="block text-xs leading-snug text-muted-foreground"
								>End now. No briefing; Firstmate hears nothing of it{waiting
									? `, and ${waiting} waiting hand-off${waiting === 1 ? ' is' : 's are'} discarded`
									: ''}.</span
							>
						</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>
</header>

<dialog
	bind:this={contextDialog}
	class="m-auto w-[min(56rem,92vw)] rounded-xl border bg-popover p-0 text-foreground backdrop:bg-black/60"
	onclose={() => (showContext = false)}
>
	<div class="flex items-center border-b px-4 py-3 text-sm">
		<b class="font-semibold">What the discussion crew was told</b>
		<button
			class="ml-auto cursor-pointer text-muted-foreground hover:text-foreground"
			onclick={() => (showContext = false)}>Close</button
		>
	</div>
	<pre
		class="max-h-[70vh] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{liveCall.context}</pre>
</dialog>
