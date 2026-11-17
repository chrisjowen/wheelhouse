<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { zoom, type Box } from '$lib/motion';
	import { fullscreen } from '$lib/fullscreen.svelte';
	import { LiveReviewSession } from '$lib/client/livereview.svelte';
	import {
		FileText,
		LogOut,
		Mic,
		NotebookPen,
		Pause,
		PenLine,
		Play,
		RotateCw,
		SlidersHorizontal
	} from '@lucide/svelte';
	import ReviewTimeline from './ReviewTimeline.svelte';
	import ScribePanel from './ScribePanel.svelte';
	import ReviewPack from './ReviewPack.svelte';

	/**
	 * A live review session on a task's preview, the whole screen (the
	 * experimental `livereview` feature; see lib/livereview.ts): the session bar
	 * (modelled on Live mode's), the preview under review in a frame of its own,
	 * the timeline under it, and the scribe beside it. The captain uses the page
	 * and holds ⌥ Option to talk (tap it twice to keep the mic on); the scribe
	 * answers when asked and keeps notes. End makes the feedback pack
	 * (ReviewPack), which goes to Firstmate for this task. `from` is where it was
	 * opened from: it grows out of that place.
	 */
	let {
		taskId,
		title,
		from = null,
		onclose
	}: { taskId: string; title: string; from?: Box | null; onclose: () => void } = $props();

	// The session belongs to this view for as long as it is open.
	// svelte-ignore state_referenced_locally
	const s = new LiveReviewSession({ id: taskId, title }, (page.data.sessionToken as string) ?? '');
	let frame = $state<HTMLIFrameElement | null>(null);
	let menu = $state<'settings' | 'end' | null>(null);
	let coach = $state(true);
	let sheet = $state(false);
	let dialog = $state<HTMLElement | null>(null);

	$effect(() => s.attach(frame));

	onMount(() => {
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		dialog?.focus();
		const hide = setTimeout(() => (coach = false), 12000);
		void s.open().then(() => {
			if (!s.problem) s.start();
		});
		return () => {
			clearTimeout(hide);
			s.close();
			document.body.style.overflow = overflow;
		};
	});

	// A notice shows for a while, then goes.
	$effect(() => {
		if (!s.notice) return;
		const t = setTimeout(() => (s.notice = null), 6000);
		return () => clearTimeout(t);
	});

	const editable = (t: EventTarget | null) =>
		t instanceof HTMLElement &&
		(t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Alt' && !e.repeat) {
			e.preventDefault();
			s.keyDown();
		} else if (e.key !== 'Alt') s.chorded();
		if (e.key === 'Escape') {
			if (menu) menu = null;
			else if (!editable(e.target) && !s.pack) menu = 'end';
		}
	}
	function onkeyup(e: KeyboardEvent) {
		if (e.key === 'Alt') {
			e.preventDefault();
			s.keyUp();
		}
	}

	const clock = $derived.by(() => {
		const sec = Math.floor(s.elapsed / 1000);
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	});
	const touch = $derived(
		typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
	);
	const line = $derived.by((): [string, string] => {
		if (s.problem) return ['Not recording', ` · ${s.problem}`];
		if (!s.on) return ['Opening the preview…', ''];
		if (s.paused) return ['Paused', ' · nothing is recorded until you carry on'];
		if (s.talking)
			return s.locked
				? ['Mic on', ' · tap ⌥ Option to turn it off']
				: ['Listening', ' · let go of ⌥ Option when you are done'];
		if (s.speaking) return ['Scribe speaking', ' · hold ⌥ Option to cut in'];
		if (s.replyBusy) return ['Scribe thinking', ' · answering you'];
		if (!s.canHear) return ['Recording', ' · type to the scribe (this browser cannot hear speech)'];
		return [
			'Recording',
			touch
				? ' · hold the button to talk'
				: s.mode === 'talk'
					? ' · hold ⌥ Option to talk, or ask the scribe anything'
					: ' · hold ⌥ Option to talk, or tap it twice for hands-free'
		];
	});
	const ring = $derived(
		s.talking
			? 'ring-[3px] ring-sea'
			: s.paused || !s.on
				? 'ring-1 ring-input'
				: 'ring-2 ring-danger/70'
	);
	const caption = $derived(
		s.talking
			? {
					who: 'captain' as const,
					text: s.hearing?.finals ?? '',
					interim: s.hearing?.interim ?? ''
				}
			: s.scribeSays
				? { who: 'scribe' as const, text: s.scribeSays, interim: '' }
				: null
	);
</script>

<svelte:window
	{onkeydown}
	{onkeyup}
	onmessage={(e) => s.receive(e)}
	onclick={(e) => {
		if (menu && !(e.target as HTMLElement).closest('[data-review-menu]')) menu = null;
	}}
/>

<div
	bind:this={dialog}
	class="fixed inset-0 z-50 flex flex-col bg-background outline-none"
	role="dialog"
	aria-modal="true"
	aria-label="Live review of {title}"
	tabindex="-1"
	data-live-review
	transition:zoom={{ from }}
	use:fullscreen
>
	<!-- The session bar: who is recording, for how long, whose turn it is, and End. -->
	<div
		class="flex shrink-0 items-center gap-3 border-b border-sea/25 bg-sea/5 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4"
		data-review-bar
	>
		<span
			class="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-brass bg-sea/10"
			aria-hidden="true"
			><span
				class="size-2.5 rounded-full {s.talking
					? 'animate-pulse bg-sea'
					: s.on && !s.paused
						? 'animate-pulse bg-danger'
						: 'bg-muted-foreground'}"
			></span></span
		>
		<div class="min-w-0 flex-1">
			<p class="flex items-baseline gap-2 text-sm whitespace-nowrap">
				<b class="font-semibold">Live review</b>
				<span class="font-mono text-xs text-muted-foreground tabular-nums">{clock}</span>
				<span class="hidden truncate text-xs text-muted-foreground sm:inline">of {title}</span>
			</p>
			<p class="h-[1.15rem] truncate text-xs text-muted-foreground" role="status">
				<b
					class="font-semibold {s.talking || s.speaking || s.replyBusy
						? 'text-sea'
						: s.on && !s.paused && !s.problem
							? 'text-danger'
							: ''}">{line[0]}</b
				>{line[1]}
			</p>
		</div>
		<div
			class="grid grid-cols-2 overflow-hidden rounded-md border text-xs max-md:hidden"
			role="group"
			aria-label="What the scribe does"
		>
			{#each [['talk', 'Talk with me'], ['notes', 'Notes only']] as [id, label] (id)}
				<button
					class="cursor-pointer px-2.5 py-1.5 {s.mode === id
						? 'bg-sea/15 font-semibold text-sea'
						: 'text-muted-foreground hover:bg-muted'}"
					aria-pressed={s.mode === id}
					onclick={() => s.setMode(id as 'talk' | 'notes')}>{label}</button
				>
			{/each}
		</div>
		<div class="relative" data-review-menu>
			<button
				class="grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Session settings"
				aria-expanded={menu === 'settings'}
				onclick={() => (menu = menu === 'settings' ? null : 'settings')}
				><SlidersHorizontal class="size-4" /></button
			>
			{#if menu === 'settings'}
				<div
					class="absolute top-full right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-sm shadow-lg"
				>
					<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
						The scribe
					</p>
					<div class="mt-2 grid grid-cols-2 overflow-hidden rounded-md border md:hidden">
						{#each [['talk', 'Talk with me'], ['notes', 'Notes only']] as [id, label] (id)}
							<button
								class="cursor-pointer px-2 py-1.5 {s.mode === id
									? 'bg-sea/15 font-semibold text-sea'
									: 'text-muted-foreground'}"
								aria-pressed={s.mode === id}
								onclick={() => s.setMode(id as 'talk' | 'notes')}>{label}</button
							>
						{/each}
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						Talk with me: ask it anything (“what’s this page for?”) and it answers out loud, while
						it takes notes. Notes only: it listens, writes and stays quiet.
					</p>
					<label class="mt-3 flex cursor-pointer items-center gap-2">
						<input type="checkbox" class="accent-primary" bind:checked={s.speak} />
						Speak its answers out loud
					</label>
					<p class="mt-4 text-xs font-medium tracking-wider text-muted-foreground uppercase">
						Recording
					</p>
					<label class="mt-2 flex cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							class="accent-primary"
							checked={s.mask}
							onchange={(e) => s.setMask(e.currentTarget.checked)}
						/>
						Hide what I type (record only that I typed)
					</label>
					<label class="mt-2 flex cursor-pointer items-center gap-2">
						<input type="checkbox" class="accent-primary" bind:checked={s.shootClicks} />
						A screenshot at every click
					</label>
					<p class="mt-3 border-t pt-3 text-xs text-muted-foreground">
						Hold ⌥ Option to talk, or tap it twice to keep the mic on until you tap again. Speech
						uses the browser’s recogniser; the scribe runs on this computer.
					</p>
				</div>
			{/if}
		</div>
		<button
			class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm hover:bg-muted disabled:opacity-50"
			disabled={!s.on || !!s.pack}
			onclick={() => s.setPaused(!s.paused)}
			>{#if s.paused}<Play class="size-4" aria-hidden="true" /><span class="max-sm:sr-only"
					>Carry on</span
				>{:else}<Pause class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">Pause</span
				>{/if}</button
		>
		<div class="relative" data-review-menu>
			<button
				class="h-8 shrink-0 cursor-pointer rounded-md border border-danger/50 px-3 text-sm font-medium text-danger hover:bg-danger/10 {menu ===
				'end'
					? 'bg-danger/10'
					: ''}"
				aria-expanded={menu === 'end'}
				aria-haspopup="menu"
				onclick={() => (menu = menu === 'end' ? null : 'end')}
				data-review-end>End</button
			>
			{#if menu === 'end'}
				<div
					class="absolute top-full right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-sm shadow-lg"
					role="menu"
					aria-label="End the session"
				>
					<p
						class="border-b px-4 py-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
					>
						End the session
					</p>
					{#if s.remarks.length}
						<button
							class="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-muted"
							role="menuitem"
							onclick={() => {
								menu = null;
								void s.end();
							}}
							data-review-make-pack
						>
							<FileText class="mt-0.5 size-4 shrink-0 text-sea" aria-hidden="true" />
							<span>
								<b class="block font-semibold">End and make the pack</b>
								<span class="block text-xs leading-snug text-muted-foreground"
									>Your notes become a feedback pack you check before it goes to Firstmate.</span
								>
							</span>
						</button>
					{/if}
					<button
						class="flex w-full cursor-pointer items-start gap-3 border-t px-4 py-3 text-left hover:bg-muted"
						role="menuitem"
						onclick={onclose}
						data-review-quit
					>
						<LogOut class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span>
							<b class="block font-semibold">{s.remarks.length ? 'Just quit' : 'Close'}</b>
							<span class="block text-xs leading-snug text-muted-foreground"
								>{s.remarks.length
									? 'Throw the session away. Firstmate hears nothing of it.'
									: 'Nothing was said, so there is nothing to send.'}</span
							>
						</span>
					</button>
				</div>
			{/if}
		</div>
	</div>

	<div class="relative flex min-h-0 flex-1">
		<div class="flex min-w-0 flex-1 flex-col gap-2 p-3 max-md:p-0">
			<!-- The preview under review, framed so it is never mistaken for Wheelhouse. -->
			<div
				class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-[1.5px] border-sea/50 bg-card shadow-sm max-md:rounded-none max-md:border-x-0"
			>
				<div
					class="flex shrink-0 items-center gap-2.5 border-b border-sea/30 bg-sea/5 px-3 py-1.5 text-xs"
				>
					<span
						class="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] whitespace-nowrap text-sea uppercase"
						><span
							class="size-1.5 rounded-full {s.on && !s.paused
								? 'animate-pulse bg-danger'
								: 'bg-sea'}"
						></span>Preview under review</span
					>
					<span class="truncate font-medium max-md:hidden">{title}</span>
					<span class="min-w-0 flex-1 truncate font-mono text-muted-foreground"
						>{s.frameUrl ?? ''}</span
					>
					<button
						class="grid size-7 shrink-0 cursor-pointer place-items-center rounded hover:bg-accent"
						aria-label="Reload the preview"
						onclick={() => frame?.contentWindow?.location.replace(s.frameUrl ?? '')}
						disabled={!s.frameUrl}><RotateCw class="size-3.5" /></button
					>
				</div>
				<div class="relative min-h-0 flex-1 bg-white">
					{#if s.frameUrl}
						<iframe
							bind:this={frame}
							src={s.frameUrl}
							title="Preview of {title}, recorded"
							sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-modals"
							referrerpolicy="no-referrer"
							class="size-full border-0 bg-white"
						></iframe>
					{:else}
						<div
							class="grid size-full place-items-center p-6 text-center text-sm text-muted-foreground"
						>
							{s.problem ?? 'Opening the preview…'}
						</div>
					{/if}
					<div
						class="pointer-events-none absolute inset-0 transition-shadow {ring} ring-inset"
					></div>
					{#if caption}
						<!-- What is being heard, or what the scribe says, over the page. -->
						<div
							class="pointer-events-none absolute bottom-4 left-1/2 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-2xl border px-4 py-3 text-[#eef1f3] shadow-2xl backdrop-blur {caption.who ===
							'scribe'
								? 'border-[#e8b04a]/45 bg-[#142130]/95'
								: 'border-transparent bg-[#0b1118]/90'}"
							aria-live="polite"
							data-review-caption
						>
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full {caption.who ===
								'scribe'
									? 'border-[1.5px] border-[#e8b04a] text-[#e8b04a]'
									: 'bg-[#e8b04a] text-[#1a1203]'}"
								>{#if caption.who === 'scribe'}<PenLine class="size-3.5" />{:else}<Mic
										class="size-3.5"
									/>{/if}</span
							>
							<p class="min-w-0 font-reading text-[17px] leading-snug">
								{#if caption.text || caption.interim}{caption.text}
									<span class="text-[#8e9aa6]">{caption.interim}</span>{:else}Listening…{/if}
							</p>
						</div>
					{/if}
					{#if coach && s.on}
						<div
							class="absolute top-3 left-1/2 flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-end gap-3 rounded-lg border border-l-[3px] border-l-sea bg-popover px-3.5 py-2.5 text-sm shadow-lg"
						>
							<p>
								<b>Recording.</b> Use the page as you normally would. Hold
								<kbd class="rounded border px-1 font-mono text-xs">⌥ Option</kbd> and talk: say what strikes
								you, or ask the scribe anything and it answers. Say “this” or “here” to mean what your
								pointer is on.
							</p>
							<button
								class="shrink-0 cursor-pointer text-xs text-sea hover:underline"
								onclick={() => (coach = false)}>Got it</button
							>
						</div>
					{/if}
				</div>
			</div>
			<div class="max-md:hidden"><ReviewTimeline session={s} /></div>
		</div>

		<aside
			class="flex w-[24rem] shrink-0 flex-col border-l bg-panel max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:h-[85%] max-md:w-auto max-md:rounded-t-2xl max-md:border-t max-md:border-l-0 max-md:shadow-2xl xl:w-[26rem] {sheet
				? ''
				: 'max-md:hidden'}"
			aria-label="The scribe"
		>
			<ScribePanel session={s} onhide={() => (sheet = false)} />
		</aside>
	</div>

	<!-- On a phone: a wide hold-to-talk bar under the thumb, and the scribe's notes as a sheet. -->
	<div
		class="flex shrink-0 items-center gap-2 border-t bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] md:hidden"
	>
		<button
			class="inline-flex h-14 flex-1 touch-none items-center justify-center gap-2 rounded-full border text-base font-semibold select-none {s.talking
				? 'border-sea bg-sea text-on-accent'
				: 'border-sea/55 bg-sea/10 text-sea'}"
			oncontextmenu={(e) => e.preventDefault()}
			onpointerdown={(e) => {
				e.preventDefault();
				s.pressHeld();
			}}
			onpointerup={() => s.release()}
			onpointercancel={() => s.release(true)}
			><Mic class="size-5" aria-hidden="true" />{s.talking
				? 'Let go to finish'
				: 'Hold to talk'}</button
		>
		<button
			class="relative grid size-14 place-items-center rounded-2xl border text-sea"
			aria-label="The scribe’s notes"
			onclick={() => (sheet = !sheet)}
			><NotebookPen class="size-5" /><span
				class="absolute top-1 right-1 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground"
				>{s.notes.length}</span
			></button
		>
	</div>

	{#if s.notice}
		<p
			class="fixed bottom-6 left-1/2 z-[60] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border bg-popover px-4 py-2.5 text-sm shadow-lg"
			role="status"
		>
			{s.notice}
		</p>
	{/if}

	{#if s.pack}
		<ReviewPack session={s} {onclose} />
	{/if}
</div>
