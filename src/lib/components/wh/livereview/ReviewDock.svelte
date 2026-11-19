<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { LiveReviewSession } from '$lib/client/livereview.svelte';
	import { spaceToTalk } from '$lib/voice/spacehold';
	import {
		ArrowLeft,
		ArrowUp,
		Check,
		ChevronDown,
		Crosshair,
		Mic,
		Pause,
		Play,
		Radio,
		SquareDashedMousePointer,
		X
	} from '@lucide/svelte';
	import ScribePanel from './ScribePanel.svelte';
	import ReviewPack from './ReviewPack.svelte';

	/**
	 * A live review's panel (the experimental `livereview` feature; see
	 * lib/livereview.ts), framed on the page under review by the recorder the
	 * proxy adds to it, beside its floating button. Nothing is recorded until
	 * the captain asks. One box at the foot takes what the captain types or
	 * says, as a **note** (on the page as a whole, or on a part of it the
	 * captain points at) or as a question to **ask** the scribe; the switch
	 * beside it remembers which. **Start live discussion** (or asking) records
	 * the session and lets the captain talk to the scribe (hold to talk, or hold
	 * Space) while using the page; **Done**, here and on the floating button,
	 * ends it and makes the feedback pack. The verdict sits
	 * at the foot: **Approve** sends the captain's go for this task to Firstmate,
	 * and **Request changes** makes the pack of what to change, for this task's
	 * worker. The scribe answers out loud (in the voice chosen in Settings →
	 * Voice) or in text only. **Wheelhouse** closes the preview's tab, back to
	 * the Wheelhouse it was opened from (`back`).
	 *
	 * `from` is the page's origin (the recording proxy's), the only window it
	 * talks to. The session is kept in this tab, so it carries on when the page
	 * loads again and the panel with it.
	 */
	let {
		taskId,
		title,
		preview,
		from,
		back
	}: { taskId: string; title: string; preview: string; from: string; back: string } = $props();

	// svelte-ignore state_referenced_locally
	const key = `wh-live-review:${taskId}`;
	const kept = {
		get(): string | null {
			try {
				return sessionStorage.getItem(key);
			} catch {
				return null;
			}
		},
		set(v: string | null) {
			try {
				if (v === null) sessionStorage.removeItem(key);
				else sessionStorage.setItem(key, v);
			} catch {
				// storage refused: the session lasts as long as this page
			}
		}
	};

	const tell = (m: Record<string, unknown>) => window.parent.postMessage({ __wh: 1, ...m }, from);

	function fresh(): LiveReviewSession {
		const x = new LiveReviewSession(
			{ id: taskId, title },
			(page.data.sessionToken as string) ?? ''
		);
		x.connect(window.parent, from, preview);
		return x;
	}
	let s = $state.raw(fresh());
	// svelte-ignore state_referenced_locally
	s.restore(kept.get());

	let draft = $state('');

	/** What the box sends: a question for the scribe, or a note; the last choice is remembered. */
	const MODE = 'wh-live-review:composer';
	let mode = $state<'ask' | 'note'>(
		(() => {
			try {
				return localStorage.getItem(MODE) === 'ask' ? 'ask' : 'note';
			} catch {
				return 'note';
			}
		})()
	);
	function setMode(m: 'ask' | 'note') {
		mode = m;
		try {
			localStorage.setItem(MODE, m);
		} catch {
			// storage refused: the choice lasts as long as this page
		}
	}

	onMount(() => {
		tell({ type: 'ready' });
		const keep = () => kept.set(s.save());
		addEventListener('pagehide', keep);
		return () => removeEventListener('pagehide', keep);
	});

	// The floating button shows what the session is doing; the pack wants room.
	$effect(() => {
		tell({
			type: 'state',
			recording: s.on,
			paused: s.paused,
			talking: s.talking,
			started: s.started,
			comments: s.remarks.length,
			pack: !!s.pack,
			canDone: s.canDone,
			approved: !!s.approved
		});
	});
	$effect(() => {
		tell({ type: 'panel', large: !!s.pack });
	});
	// The timeline along the foot of the page while recording: what was done, said and marked.
	$effect(() => {
		const items = [
			...s.events
				.filter((e) => e.type === 'click' || e.type === 'error' || e.type === 'mark')
				.map((e) => ({ t: e.t, kind: e.type })),
			...s.remarks.map((u) => ({ t: u.t0, kind: 'said' }))
		];
		tell({ type: 'timeline', items });
	});
	// Keep the session as it goes, for when the page loads again.
	$effect(() => {
		const json = s.save();
		const t = setTimeout(() => kept.set(json), 300);
		return () => clearTimeout(t);
	});
	// A notice shows for a while, then goes.
	$effect(() => {
		if (!s.notice) return;
		const t = setTimeout(() => (s.notice = null), 6000);
		return () => clearTimeout(t);
	});

	/**
	 * What the box says, with the part picked if there is one: a note kept with
	 * the rest, for the pack, or a question the scribe answers (asking starts
	 * the live discussion, which the scribe needs to answer).
	 */
	function send(e: Event) {
		e.preventDefault();
		if (!draft.trim() || (mode === 'ask' && s.paused)) return;
		stopDictating();
		if (mode === 'note') s.comment(draft);
		else {
			if (!s.on) s.start();
			s.type(draft);
		}
		draft = '';
	}

	/** Request changes: the pack of what to change, for this task's worker; it needs a note first. */
	let noteBox = $state<HTMLTextAreaElement | null>(null);
	function requestChanges() {
		if (s.pack) return;
		stopDictating();
		if (draft.trim()) {
			s.comment(draft);
			draft = '';
		}
		if (!s.remarks.length) {
			s.notice = 'Write or say what to change first, then Request changes.';
			noteBox?.focus();
			return;
		}
		done();
	}

	async function approve() {
		stopDictating();
		const note = draft;
		if (await s.approve(note)) draft = '';
	}

	/** Done: the pack when there is anything to send, else just stop recording. */
	function done() {
		if (s.pack) return;
		stopDictating();
		if (s.remarks.length) {
			void s.end();
			tell({ type: 'panel', open: true });
		} else if (s.on) {
			s.close();
			tell({ type: 'areas', clear: true });
			s.notice = 'Nothing was said, so there is nothing to send.';
		}
	}

	/** On a phone, one control: Record starts with the mic on (no holding); Stop is Done. */
	function quick() {
		if (s.on) return done();
		s.start();
		s.setLocked(true);
	}

	/** After the pack has gone (or was thrown away): a new session, from nothing. */
	function finish() {
		kept.set(null);
		tell({ type: 'areas', clear: true });
		s.close();
		s = fresh();
		draft = '';
	}

	/**
	 * Point at a part of the page for what is being typed or said. Saying it
	 * carries on meanwhile: the part goes with the words, whenever they are sent.
	 */
	function pick() {
		s.pick(!s.picking);
	}
	function unpick() {
		if (s.picking) s.pick(false);
		s.picked = null;
	}
	// The part picked: the box takes the keys, for what to say about it.
	$effect(() => {
		if (s.picked) noteBox?.focus();
	});

	/* ------------------------------------------- saying a comment, not typing it */

	interface Dictation {
		lang: string;
		continuous: boolean;
		interimResults: boolean;
		onresult:
			| ((e: {
					resultIndex: number;
					results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
			  }) => void)
			| null;
		onend: (() => void) | null;
		start(): void;
		stop(): void;
	}
	const Recogniser = (() => {
		const w = globalThis as unknown as Record<string, unknown>;
		return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => Dictation) ?? null;
	})();
	let dictation: Dictation | null = null;
	let dictating = $state(false);
	function dictate() {
		if (dictating) return stopDictating();
		if (!Recogniser) return;
		const rec = new Recogniser();
		rec.lang = navigator.language || 'en-GB';
		rec.continuous = true;
		rec.interimResults = true;
		const before = draft.trim() ? `${draft.trim()} ` : '';
		let finals = '';
		rec.onresult = (e) => {
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const r = e.results[i];
				if (r.isFinal) finals += r[0].transcript;
				else interim += r[0].transcript;
			}
			draft = `${before}${finals}${interim}`.replace(/\s+/g, ' ');
		};
		rec.onend = () => {
			dictating = false;
			dictation = null;
		};
		try {
			rec.start();
			dictation = rec;
			dictating = true;
		} catch {
			s.notice = 'The browser would not start listening. Type the comment instead.';
		}
	}
	function stopDictating() {
		dictation?.stop();
		dictation = null;
		dictating = false;
	}

	/* ------------------------------------------------------------------ keys */

	// The talk key, the same everywhere (lib/voice/spacehold.ts): hold Space for 2 seconds over
	// the panel to talk, with a chime, and let go to stop; the page does the same over itself.
	let dock = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!dock) return;
		return spaceToTalk(dock, {
			start: () => s.keyDown(),
			stop: () => s.keyUp(),
			enabled: () => s.on && !s.paused
		});
	});
	const typingIn = (t: EventTarget | null) =>
		t instanceof HTMLElement &&
		(t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

	function onkeydown(e: KeyboardEvent) {
		if (
			(e.key === 'm' || e.key === 'M') &&
			!e.repeat &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			!typingIn(e.target)
		)
			s.mark();
		if (e.key === 'Escape' && !s.pack) {
			if (s.marking) s.mark(false);
			else if (s.picked || s.picking) unpick();
			else tell({ type: 'panel', open: false });
		}
	}
	function onmessage(e: MessageEvent) {
		if (e.source === window.parent && e.origin === from && e.data?.__wh === 1) {
			if (e.data.type === 'done') return done();
			if (e.data.type === 'quick') return quick();
			if (e.data.type === 'key' && e.data.key === 'Escape') return;
		}
		s.receive(e);
	}

	const clock = $derived.by(() => {
		const sec = Math.floor(s.elapsed / 1000);
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	});
	const comments = $derived(s.remarks.length);
	const line = $derived.by((): [string, string] => {
		if (s.pack) return ['Feedback pack', ' · check it, then send it to Firstmate'];
		if (!s.on)
			return comments
				? [`${comments} comment${comments === 1 ? '' : 's'}`, ' · not recording']
				: ['Not recording', ''];
		if (s.paused) return ['Paused', ' · nothing is recorded until you carry on'];
		if (s.talking)
			return s.locked ? ['Mic on', ' · tap to stop'] : ['Listening', ' · let go when done'];
		if (s.speaking) return ['Scribe speaking', ''];
		if (s.replyBusy) return ['Scribe thinking', ''];
		return ['Recording', ` · ${clock}`];
	});
</script>

<svelte:window {onkeydown} {onmessage} />

<div bind:this={dock} class="flex h-dvh flex-col bg-background text-foreground" data-review-dock>
	<!-- The panel's bar: what this is, the way back to Wheelhouse, and minimise. -->
	<header class="flex shrink-0 items-center gap-2.5 border-b bg-panel px-3 py-2.5">
		<span
			class="grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] {s.on && !s.paused
				? 'border-sea'
				: 'border-hair'}"
			aria-hidden="true"
			><span
				class="size-2 rounded-full {s.talking
					? 'animate-pulse bg-sea'
					: s.on && !s.paused
						? 'animate-pulse bg-sea'
						: 'bg-muted-foreground/60'}"
			></span></span
		>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold" {title}>
				Live review <span class="font-normal text-muted-foreground">· {title}</span>
			</p>
			<p class="truncate text-xs text-muted-foreground" role="status" data-review-status>
				<b class="font-semibold {s.on && !s.paused ? 'text-sea' : 'text-foreground'}">{line[0]}</b
				>{line[1]}
			</p>
		</div>
		<a
			href={back}
			target="_top"
			class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
			title="Close the preview and go back to Wheelhouse"
			onclick={(e) => {
				// The page closes its own tab (it opened in one); a link that still loads is the fallback.
				e.preventDefault();
				tell({ type: 'leave' });
			}}
			data-review-back><ArrowLeft class="size-3.5" aria-hidden="true" />Wheelhouse</a
		>
		<button
			type="button"
			class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Minimise the panel"
			onclick={() => tell({ type: 'panel', open: false })}
			><ChevronDown class="size-4" aria-hidden="true" /></button
		>
	</header>

	{#if s.on}
		<!-- The live discussion: talk, mark, pause and finish; what is said shows below. -->
		<section class="shrink-0 border-b px-3 py-2.5" aria-label="Live discussion">
			<div class="flex gap-1.5">
				<button
					type="button"
					class="inline-flex h-9 flex-1 cursor-pointer touch-none items-center justify-center gap-2 rounded-md border text-sm font-medium select-none disabled:opacity-50 {s.talking
						? 'border-sea bg-sea/15 text-foreground'
						: 'bg-card hover:bg-muted'}"
					title="Or hold Space for 2 seconds anywhere on the page"
					disabled={s.paused}
					oncontextmenu={(e) => e.preventDefault()}
					onpointerdown={(e) => {
						e.preventDefault();
						if (s.locked) s.setLocked(false);
						else s.pressHeld();
					}}
					onpointerup={() => {
						if (!s.locked) s.release();
					}}
					onpointercancel={() => s.release(true)}
					data-review-talk
					><Mic class="size-4" aria-hidden="true" />{s.talking
						? s.locked
							? 'Mic on · tap to stop'
							: 'Let go to finish'
						: 'Hold to talk'}{#if !s.talking}<kbd
							class="ml-1 rounded border px-1 font-mono text-[11px] text-muted-foreground pointer-coarse:hidden"
							>Space</kbd
						>{/if}</button
				>
				<button
					type="button"
					class="h-9 cursor-pointer rounded-md border px-3 text-sm disabled:opacity-50 {s.locked
						? 'border-sea bg-sea/15 text-foreground'
						: 'bg-card text-muted-foreground hover:bg-muted'}"
					aria-pressed={s.locked}
					disabled={s.paused}
					onclick={() => s.setLocked(!s.locked)}>Hands-free</button
				>
			</div>
			<div class="mt-1.5 flex gap-1.5">
				<button
					type="button"
					class="inline-flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-medium disabled:opacity-50 {s.marking
						? 'border-sea bg-sea/15 text-foreground'
						: 'bg-card hover:bg-muted'}"
					title="Drag over the page to mark an area · Esc to stop"
					aria-pressed={s.marking}
					disabled={s.paused}
					onclick={() => s.mark()}
					data-review-mark
					><SquareDashedMousePointer class="size-4 shrink-0" aria-hidden="true" /><span
						class="truncate">{s.marking ? 'Marking · Esc to stop' : 'Mark an area'}</span
					>{#if !s.marking}<kbd
							class="ml-1 rounded border px-1 font-mono text-[11px] text-muted-foreground pointer-coarse:hidden"
							>M</kbd
						>{/if}</button
				>
				<button
					type="button"
					class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 text-sm hover:bg-muted"
					onclick={() => s.setPaused(!s.paused)}
					>{#if s.paused}<Play class="size-4" aria-hidden="true" />Carry on{:else}<Pause
							class="size-4"
							aria-hidden="true"
						/>Pause{/if}</button
				>
				<button
					type="button"
					class="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85"
					onclick={done}
					data-review-done
					><span class="size-2.5 rounded-[2px] bg-primary-foreground" aria-hidden="true"
					></span>Done</button
				>
			</div>
		</section>
	{:else}
		<section class="shrink-0 border-b px-3 py-2.5" aria-label="Live discussion">
			<button
				type="button"
				class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left hover:border-sea/60 hover:bg-muted"
				title="Use the page and talk; the scribe records, answers and takes notes."
				onclick={() => s.start()}
				data-review-start
			>
				<Radio class="size-4.5 shrink-0 text-sea" aria-hidden="true" />
				<span class="min-w-0">
					<b class="block text-sm font-semibold">Start live discussion</b>
					<span class="block truncate text-xs text-muted-foreground"
						>Use the page and talk; the scribe records, answers and takes notes.</span
					>
				</span>
			</button>
		</section>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col">
		<ScribePanel session={s} />
	</div>

	<!-- The one box: a note, or a question for the scribe, typed or said, on a part picked or not. -->
	<form class="shrink-0 border-t px-3 pt-2.5 pb-3" onsubmit={send} data-review-composer>
		{#if s.picking || s.picked}
			<p class="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground" data-review-picked>
				<Crosshair class="size-3.5 shrink-0 text-sea" aria-hidden="true" />
				<span class="min-w-0 truncate"
					>{s.picked ? `On ${s.picked.el.label}` : 'Click the part of the page you mean…'}</span
				>
				{#if s.picked}
					<button
						type="button"
						class="shrink-0 cursor-pointer text-sea hover:underline"
						onclick={pick}>Pick again</button
					>
				{/if}
				<button
					type="button"
					class="ml-auto grid size-5 shrink-0 cursor-pointer place-items-center rounded hover:bg-muted hover:text-foreground"
					aria-label={s.picked ? 'Leave the part out' : 'Stop picking'}
					onclick={unpick}><X class="size-3.5" aria-hidden="true" /></button
				>
			</p>
		{/if}
		<div
			class="rounded-lg border border-input bg-card focus-within:ring-2 focus-within:ring-ring/30"
		>
			<textarea
				bind:this={noteBox}
				class="block field-sizing-content max-h-32 min-h-[2.75rem] w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-sm outline-none placeholder:text-muted-foreground"
				placeholder={mode === 'note'
					? s.picked
						? 'What about it?'
						: 'A note for the worker…'
					: s.paused
						? 'Paused: carry on to ask the scribe'
						: s.on
							? 'Ask the scribe…'
							: 'Ask the scribe (starts the live discussion)…'}
				aria-label={mode === 'note' ? 'Your note' : 'Ask the scribe'}
				bind:value={draft}
				onkeydown={(e) => {
					if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						setMode(mode === 'note' ? 'ask' : 'note');
					} else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && draft.trim()) send(e);
				}}></textarea>
			<div class="flex items-center gap-1 px-1.5 pb-1.5">
				<div
					class="inline-flex shrink-0 overflow-hidden rounded-md border text-xs"
					role="radiogroup"
					tabindex="-1"
					aria-label="Send as"
					title="Switch with ⌘/ or Ctrl+/"
					onkeydown={(e) => {
						if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
						e.preventDefault();
						setMode(mode === 'note' ? 'ask' : 'note');
						(e.currentTarget as HTMLElement)
							.querySelector<HTMLElement>(`[data-review-mode="${mode}"]`)
							?.focus();
					}}
				>
					{#each [['note', 'Note', 'A note for the worker; the scribe files it'], ['ask', 'Ask', 'Ask the scribe; it answers']] as const as [m, label, hint] (m)}
						<button
							type="button"
							role="radio"
							aria-checked={mode === m}
							tabindex={mode === m ? 0 : -1}
							class="cursor-pointer px-2.5 py-1 {mode === m
								? 'bg-sea/15 font-semibold text-sea'
								: 'text-muted-foreground hover:bg-muted'}"
							title={hint}
							onclick={() => setMode(m)}
							data-review-mode={m}>{label}</button
						>
					{/each}
				</div>
				<button
					type="button"
					class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md {s.picking ||
					s.picked
						? 'bg-sea/10 text-sea'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					aria-label="Point at a part"
					aria-pressed={s.picking}
					title="Point at the part of the page this is about (optional)"
					onclick={pick}
					data-review-point><Crosshair class="size-4" aria-hidden="true" /></button
				>
				{#if Recogniser}
					<button
						type="button"
						class="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs {dictating
							? 'bg-sea/10 text-sea'
							: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
						aria-label={dictating ? 'Stop listening' : 'Say it'}
						aria-pressed={dictating}
						title={dictating ? 'Stop listening' : 'Say it instead of typing'}
						onclick={dictate}
						data-review-dictate
						><Mic
							class="size-4 {dictating ? 'animate-pulse' : ''}"
							aria-hidden="true"
						/>{#if dictating}Listening…{/if}</button
					>
				{/if}
				<button
					class="ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
					disabled={!draft.trim() || (mode === 'ask' && s.paused)}
					data-review-submit
					>{mode === 'note' ? 'Add note' : 'Ask'}<ArrowUp
						class="size-3.5"
						aria-hidden="true"
					/></button
				>
			</div>
		</div>
	</form>

	<!-- The verdict: approve the preview, or ask for changes. -->
	<footer
		class="shrink-0 border-t bg-panel px-3 py-2.5"
		aria-label="Your verdict"
		data-review-verdict
	>
		{#if s.approved}
			<div
				class="rounded-lg border border-teal/45 bg-teal/10 px-3 py-2.5 text-sm"
				role="status"
				data-review-approved
			>
				<b class="inline-flex items-center gap-1.5 text-teal"
					><Check class="size-4" aria-hidden="true" />Approved</b
				>
				<p class="mt-1 text-xs text-muted-foreground">
					Sent to Firstmate as your go for this task’s pull request{s.approved.how === 'answer'
						? ', answering its open question'
						: ''}. You can close this tab.
				</p>
			</div>
		{:else}
			<div class="flex gap-2">
				<button
					type="button"
					class="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50"
					disabled={s.approving || !!s.pack}
					onclick={requestChanges}
					data-review-request-changes>Request changes</button
				>
				<button
					type="button"
					class="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
					disabled={s.approving || !!s.pack}
					onclick={approve}
					data-review-approve
					><Check class="size-4" aria-hidden="true" />{s.approving
						? 'Approving…'
						: 'Approve'}</button
				>
			</div>
		{/if}
	</footer>

	{#if s.notice}
		<p
			class="absolute inset-x-3 bottom-3 z-10 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg"
			role="status"
		>
			{s.notice}
		</p>
	{/if}

	{#if s.pack}
		<ReviewPack session={s} onclose={finish} />
	{/if}
</div>
