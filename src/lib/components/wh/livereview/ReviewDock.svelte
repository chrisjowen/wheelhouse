<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { LiveReviewSession } from '$lib/client/livereview.svelte';
	import { spaceToTalk } from '$lib/voice/spacehold';
	import {
		ArrowLeft,
		Check,
		ChevronDown,
		Crosshair,
		Mic,
		Pause,
		Play,
		Radio,
		SquareDashedMousePointer
	} from '@lucide/svelte';
	import ScribePanel from './ScribePanel.svelte';
	import ReviewPack from './ReviewPack.svelte';

	/**
	 * A live review's panel (the experimental `livereview` feature; see
	 * lib/livereview.ts), framed on the page under review by the recorder the
	 * proxy adds to it, beside its floating button. Nothing is recorded until
	 * the captain asks: the **note** box takes a typed or spoken note on the page
	 * as a whole, or on a part of it the captain points at; **Start live
	 * discussion** records the session and lets the captain talk to the scribe
	 * (hold to talk, or hold Space) while using the page; **Done**, here and on
	 * the floating button, ends it and makes the feedback pack. The verdict sits
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
	const composing = $derived(!!s.picked);

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

	/** A note on the page as a whole (or the part picked): kept with the rest, for the pack. */
	function addNote(e: Event) {
		e.preventDefault();
		stopDictating();
		s.comment(draft);
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

	// The comment box takes the keys as soon as it opens: it is what the captain just asked for.
	const focusNow = (node: HTMLElement) => node.focus();

	/** Point at a part of the page for the note (what is typed so far stays). */
	function comment() {
		stopDictating();
		s.pick(true);
	}
	function cancelComment() {
		stopDictating();
		s.picked = null;
	}

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
			else if (composing) cancelComment();
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
			<p class="truncate text-sm font-semibold">Live review</p>
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

	<section class="shrink-0 border-b p-3" aria-label="What to do">
		<p class="mb-2.5 truncate text-xs text-muted-foreground">
			Reviewing <span class="font-medium text-foreground">{title}</span>
		</p>
		{#snippet sayIt()}
			{#if Recogniser}
				<button
					type="button"
					class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs {dictating
						? 'border-sea bg-sea/10 text-sea'
						: 'text-muted-foreground hover:bg-muted'}"
					aria-pressed={dictating}
					onclick={dictate}
					><Mic class="size-3.5" aria-hidden="true" />{dictating ? 'Listening…' : 'Say it'}</button
				>
			{/if}
		{/snippet}
		{#if composing}
			<form class="rounded-lg border bg-card p-2.5" onsubmit={addNote} data-review-comment>
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Crosshair class="size-3.5 shrink-0 text-sea" aria-hidden="true" />
					<span class="truncate"
						>{s.picked ? `On ${s.picked.el.label}` : 'On this page as a whole'}</span
					>
					<button
						type="button"
						class="ml-auto shrink-0 cursor-pointer text-sea hover:underline"
						onclick={comment}>Pick again</button
					>
				</p>
				<textarea
					class="mt-2 block min-h-[4.5rem] w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
					placeholder="What about it?"
					aria-label="Your comment"
					bind:value={draft}
					use:focusNow
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && draft.trim()) addNote(e);
					}}></textarea>
				<div class="mt-2 flex items-center gap-2">
					{@render sayIt()}
					<button
						type="button"
						class="ml-auto h-8 cursor-pointer rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted"
						onclick={cancelComment}>Cancel</button
					>
					<button
						class="h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
						disabled={!draft.trim()}
						data-review-add-comment>Add comment</button
					>
				</div>
			</form>
		{:else}
			<form class="rounded-lg border bg-card p-2.5" onsubmit={addNote} data-review-note>
				<label for="review-note" class="text-xs text-muted-foreground"
					>A note on this page, or anything about it</label
				>
				<textarea
					id="review-note"
					bind:this={noteBox}
					class="mt-1.5 block {s.on
						? 'min-h-[2.75rem]'
						: 'min-h-[4.5rem]'} w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
					placeholder="Type what you think…"
					bind:value={draft}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && draft.trim()) addNote(e);
					}}></textarea>
				<div class="mt-2 flex items-center gap-2">
					{@render sayIt()}
					<button
						type="button"
						class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs text-muted-foreground hover:bg-muted"
						title="Pick the part of the page the note is about (optional)"
						onclick={comment}
						data-review-comment-start
						><Crosshair class="size-3.5" aria-hidden="true" />Point at a part</button
					>
					<button
						class="ml-auto h-8 cursor-pointer rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
						disabled={!draft.trim()}
						data-review-add-note>Add note</button
					>
				</div>
			</form>
		{/if}
		{#if composing}
			<!-- Picking a part: the note box is the comment on it, above. -->
		{:else if s.on}
			<div class="mt-2.5 flex gap-2">
				<button
					type="button"
					class="inline-flex h-10 flex-1 cursor-pointer touch-none items-center justify-center gap-2 rounded-md border text-sm font-medium select-none disabled:opacity-50 {s.talking
						? 'border-sea bg-sea/15 text-foreground'
						: 'bg-card hover:bg-muted'}"
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
						: 'Hold to talk'}</button
				>
				<button
					type="button"
					class="h-10 cursor-pointer rounded-md border px-3 text-sm disabled:opacity-50 {s.locked
						? 'border-sea bg-sea/15 text-foreground'
						: 'bg-card text-muted-foreground hover:bg-muted'}"
					aria-pressed={s.locked}
					disabled={s.paused}
					onclick={() => s.setLocked(!s.locked)}>Hands-free</button
				>
			</div>
			<p class="mt-1.5 text-center text-[11px] text-muted-foreground pointer-coarse:hidden">
				or hold <kbd class="rounded border px-1 font-mono">Space</kbd> for 2 seconds anywhere on the page
			</p>
			<button
				type="button"
				class="mt-2.5 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-medium disabled:opacity-50 {s.marking
					? 'border-sea bg-sea/15 text-foreground'
					: 'bg-card hover:bg-muted'}"
				aria-pressed={s.marking}
				disabled={s.paused}
				onclick={() => s.mark()}
				data-review-mark
				><SquareDashedMousePointer class="size-4" aria-hidden="true" />{s.marking
					? 'Marking: drag over the page · Esc to stop'
					: 'Mark an area'}<kbd
					class="ml-1 rounded border px-1 font-mono text-[11px] text-muted-foreground pointer-coarse:hidden"
					>M</kbd
				></button
			>
			<div class="mt-2.5 flex gap-2">
				<button
					type="button"
					class="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/85"
					onclick={done}
					data-review-done
					><span class="size-2.5 rounded-[2px] bg-primary-foreground" aria-hidden="true"
					></span>Done</button
				>
				<button
					type="button"
					class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm hover:bg-muted"
					onclick={() => s.setPaused(!s.paused)}
					>{#if s.paused}<Play class="size-4" aria-hidden="true" />Carry on{:else}<Pause
							class="size-4"
							aria-hidden="true"
						/>Pause{/if}</button
				>
			</div>
		{:else}
			<button
				type="button"
				class="mt-2.5 flex w-full cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left hover:border-sea/60 hover:bg-muted"
				onclick={() => s.start()}
				data-review-start
			>
				<Radio class="mt-0.5 size-5 shrink-0 text-sea" aria-hidden="true" />
				<span>
					<b class="block text-sm font-semibold">Start live discussion</b>
					<span class="text-xs leading-snug text-muted-foreground"
						>Use the page and talk; the scribe records, answers and takes notes.</span
					>
				</span>
			</button>
		{/if}
		<div class="mt-3 flex items-center gap-2 text-xs">
			<span class="text-muted-foreground">The scribe answers</span>
			<div class="ml-auto grid grid-cols-2 overflow-hidden rounded-md border" role="group">
				{#each [[true, 'Out loud'], [false, 'In text only']] as const as [on, label] (label)}
					<button
						type="button"
						class="cursor-pointer px-2.5 py-1 {s.speak === on
							? 'bg-sea/15 font-semibold text-sea'
							: 'text-muted-foreground hover:bg-muted'}"
						aria-pressed={s.speak === on}
						onclick={() => (s.speak = on)}
						data-review-voice={on ? 'on' : 'off'}>{label}</button
					>
				{/each}
			</div>
		</div>
	</section>

	<div class="flex min-h-0 flex-1 flex-col">
		<ScribePanel session={s} />
	</div>

	<!-- The verdict: approve the preview, or ask for changes. -->
	<footer class="shrink-0 border-t bg-panel p-3" aria-label="Your verdict" data-review-verdict>
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
					class="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50"
					disabled={s.approving || !!s.pack}
					onclick={requestChanges}
					data-review-request-changes>Request changes</button
				>
				<button
					type="button"
					class="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-50"
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
