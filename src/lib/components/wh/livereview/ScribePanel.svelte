<script lang="ts">
	import { tick } from 'svelte';
	import { mmss, type Note } from '$lib/livereview';
	import { KIND, SEVERITY } from './kinds';
	import type { LiveReviewSession } from '$lib/client/livereview.svelte';
	import {
		ArrowUp,
		Check,
		Crosshair,
		FileText,
		Keyboard,
		Link,
		Mic,
		MousePointerClick,
		PenLine,
		TriangleAlert,
		X
	} from '@lucide/svelte';

	/**
	 * The scribe beside a live review (LiveReview.svelte): Talk (what the
	 * captain said and the scribe's answers), Notes (the notes for the worker,
	 * each with the moment, the part of the page and its screenshot) and
	 * Everything (every event and remark in order). At the foot, hold to talk,
	 * hands-free, and a box to type to the scribe instead.
	 */
	let { session: s, onhide }: { session: LiveReviewSession; onhide: () => void } = $props();

	let tab = $state<'talk' | 'notes' | 'log'>('talk');
	let draft = $state('');
	let body = $state<HTMLElement | null>(null);
	let hot = $state<string | null>(null);

	const notes = $derived(s.notes.map((n) => ({ n, a: s.about(n) })).sort((x, y) => y.a.t - x.a.t));
	const filed = $derived(new Set(s.notes.flatMap((n) => n.utterances)));
	const log = $derived(
		[
			...s.events.map((e) => ({
				t: e.t,
				kind: e.type as string,
				text: e.label,
				sub: e.type === 'nav' ? '' : e.page
			})),
			...s.remarks.map((u) => ({ t: u.t0, kind: 'said', text: `“${u.text}”`, sub: u.page })),
			...s.convo
				.filter((c) => c.who === 'scribe')
				.map((c) => ({ t: c.t, kind: 'scribe', text: c.text, sub: 'the scribe' }))
		].sort((a, b) => a.t - b.t)
	);

	// Follow the conversation as it grows.
	$effect(() => {
		void s.convo.length;
		void s.replyBusy;
		if (tab === 'talk')
			void tick().then(() => body?.scrollTo({ top: body.scrollHeight, behavior: 'smooth' }));
	});

	function noteFor(uid: string): Note | undefined {
		return s.notes.find((n) => n.utterances.includes(uid));
	}

	function goTo(id: string) {
		tab = 'notes';
		hot = id;
		void tick().then(() =>
			document.querySelector(`[data-note="${id}"]`)?.scrollIntoView({ block: 'center' })
		);
		setTimeout(() => (hot = null), 1600);
	}

	function submit(e: Event) {
		e.preventDefault();
		s.type(draft);
		draft = '';
	}
</script>

{#snippet scribeMark(size = 'size-6')}
	<span
		class="grid {size} shrink-0 place-items-center rounded-full border-[1.5px] border-brass text-sea"
		aria-hidden="true"><PenLine class="size-3" /></span
	>
{/snippet}

<header class="flex items-start gap-3 px-4 pt-4 pb-2">
	<span
		class="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-brass text-sea {s.notesBusy ||
		s.replyBusy
			? 'animate-pulse'
			: ''}"
		aria-hidden="true"><PenLine class="size-4" /></span
	>
	<div class="min-w-0 flex-1">
		<h2 class="font-title text-2xl leading-none">Scribe</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			{s.mode === 'talk'
				? 'Talk to me or just think aloud. I take notes as you go; nothing goes to Firstmate until you end.'
				: 'Notes only: I listen and write, and stay quiet. Nothing goes to Firstmate until you end.'}
		</p>
	</div>
	<button
		class="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent md:hidden"
		aria-label="Hide the scribe"
		onclick={onhide}><X class="size-4" /></button
	>
</header>

<div class="flex gap-5 border-b px-4 text-sm" role="tablist">
	{#each [['talk', 'Talk', s.remarks.length], ['notes', 'Notes', s.notes.length], ['log', 'Everything', log.length]] as const as [id, label, count] (id)}
		<button
			role="tab"
			aria-selected={tab === id}
			class="-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 py-2 {tab === id
				? 'border-sea font-medium text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = id)}
			>{label}<span class="rounded-full bg-muted px-1.5 font-mono text-[11px] text-muted-foreground"
				>{count}</span
			></button
		>
	{/each}
</div>

<div bind:this={body} class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
	{#if tab === 'talk'}
		<ol class="flex flex-col gap-3.5">
			<li class="flex gap-2.5">
				{@render scribeMark()}
				<p class="font-reading text-[15px] leading-relaxed text-muted-foreground">
					{s.mode === 'talk'
						? 'I’m right here with you. Ask me anything about this preview (“what’s this page for?”), or just say what you notice as you go. I’ll answer when you ask, and keep the notes for the worker.'
						: 'Notes only: I’m listening and writing, and I’ll stay quiet. Switch to “Talk with me” if you want answers.'}
				</p>
			</li>
			{#each s.convo as c, i (i)}
				{#if c.who === 'captain'}
					{@const u = s.remarks.find((r) => r.id === c.uid)}
					{@const note = noteFor(c.uid)}
					{@const about = u?.anchor
						? s.events.find((e) => e.id === u.anchor)?.el?.label
						: u?.pointing?.label}
					<li class="flex flex-col items-end gap-1" data-said="captain">
						<p
							class="max-w-[90%] rounded-xl rounded-br-sm border border-[var(--bubble-captain-border)] bg-[var(--bubble-captain)] px-3 py-1.5 text-sm leading-relaxed"
						>
							{c.text}
						</p>
						<span
							class="flex flex-wrap justify-end gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted-foreground"
						>
							<span class="font-mono">{mmss(c.t)}</span>
							{#if about}<span class="inline-flex items-center gap-1"
									>{#if u?.anchor}<MousePointerClick class="size-3" />{:else}<Crosshair
											class="size-3"
										/>{/if}{about}</span
								>{/if}
							{#if note}<button
									class="inline-flex cursor-pointer items-center gap-1 text-sea hover:underline"
									onclick={() => goTo(note.id)}
									><Check class="size-3" />Noted as {KIND[note.kind].word.toLowerCase()}</button
								>{/if}
						</span>
					</li>
				{:else}
					<li class="flex gap-2.5" data-said="scribe">
						{@render scribeMark()}
						<p
							class="min-w-0 {c.error
								? 'text-sm text-muted-foreground'
								: 'font-reading text-[16.5px] leading-snug'}"
						>
							<span class="mb-0.5 block font-mono text-[10px] tracking-[0.14em] text-sea uppercase"
								>Scribe</span
							>{c.text}
						</p>
					</li>
				{/if}
			{/each}
			{#if s.replyBusy}
				<li class="flex items-center gap-2 pl-8 text-sm text-muted-foreground" role="status">
					<span class="size-1.5 animate-bounce rounded-full bg-sea"></span>The scribe is thinking…
				</li>
			{/if}
		</ol>
	{:else if tab === 'notes'}
		{#if s.heard && !s.notesBusy}
			<p class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
				<Check class="size-3.5 text-teal" />{s.heard}
			</p>
		{/if}
		{#if s.notesBusy}
			<p class="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<span class="size-1.5 animate-bounce rounded-full bg-sea"></span>The scribe is writing…
			</p>
		{/if}
		{#each s.remarks.filter((u) => !filed.has(u.id)).reverse() as u (u.id)}
			<div class="mb-2.5 rounded-lg border border-dashed px-3 py-2.5">
				<p class="text-xs text-muted-foreground">
					<Mic class="inline size-3" /> Heard · {mmss(u.t0)}
				</p>
				<p
					class="mt-1 border-l-2 border-sea/60 pl-2.5 font-reading text-[15px] text-muted-foreground italic"
				>
					“{u.text}”
				</p>
			</div>
		{/each}
		{#if !notes.length && !s.remarks.length}
			<p class="font-reading text-[17px] italic">“Just use it, and say what you notice.”</p>
			<p class="mt-2 text-sm text-muted-foreground">
				Each note keeps the moment, the part of the page and a screenshot, for the worker.
			</p>
		{/if}
		{#each notes as { n, a } (n.id)}
			{@const k = KIND[n.kind]}
			<button
				type="button"
				class="mb-2.5 block w-full cursor-pointer rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-sea/50 {hot ===
					n.id || s.fresh.includes(n.id)
					? 'border-sea'
					: ''}"
				data-note={n.id}
				onclick={() => s.highlight(a.el?.selector)}
			>
				<span class="flex items-center gap-2 text-xs">
					<span
						class="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.12em] uppercase {k.tone}"
						><k.icon class="size-3.5" />{k.word}</span
					>
					<span class="rounded-full border px-2 text-[11px] text-muted-foreground"
						>{SEVERITY[n.severity]}</span
					>
					<span class="ml-auto font-mono text-[11px] text-muted-foreground">{mmss(a.t)}</span>
				</span>
				<span class="mt-1.5 block text-sm leading-snug">{n.text}</span>
				{#if n.quote}<span
						class="mt-1.5 block border-l-2 border-sea/60 pl-2.5 font-reading text-[15px] text-muted-foreground italic"
						>“{n.quote}”</span
					>{/if}
				{#if a.shotId}
					{#await s.outlined(a.shotId) then url}
						{#if url}<img
								src={url}
								alt="The page at {mmss(a.t)}"
								class="mt-2 aspect-[16/9] w-full rounded-md border object-cover object-top"
							/>{/if}
					{/await}
				{/if}
				<span class="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
					{#if a.el}<span class="flex items-center gap-1 text-foreground"
							>{#if a.clicked}<MousePointerClick class="size-3 shrink-0" />{:else}<Crosshair
									class="size-3 shrink-0"
								/>{/if}<span class="truncate">{a.el.label}</span></span
						>{/if}
					{#if a.page}<span class="flex items-center gap-1"
							><FileText class="size-3 shrink-0" /><span class="truncate">{a.page}</span></span
						>{/if}
				</span>
			</button>
		{/each}
	{:else}
		<ol class="text-sm">
			{#each log as item, i (i)}
				<li class="grid grid-cols-[2.75rem_1rem_1fr] gap-2 border-b border-hair py-1.5">
					<span class="font-mono text-[11px] leading-6 text-muted-foreground">{mmss(item.t)}</span>
					<span
						class="pt-1 {item.kind === 'error'
							? 'text-danger'
							: item.kind === 'said' || item.kind === 'scribe'
								? 'text-sea'
								: 'text-muted-foreground'}"
					>
						{#if item.kind === 'click'}<MousePointerClick
								class="size-3.5"
							/>{:else if item.kind === 'input' || item.kind === 'choose'}<Keyboard
								class="size-3.5"
							/>{:else if item.kind === 'error'}<TriangleAlert
								class="size-3.5"
							/>{:else if item.kind === 'said'}<Mic
								class="size-3.5"
							/>{:else if item.kind === 'scribe'}<PenLine class="size-3.5" />{:else}<Link
								class="size-3.5"
							/>{/if}
					</span>
					<span
						class="min-w-0 break-words {item.kind === 'said' || item.kind === 'scribe'
							? 'font-reading text-[15px]'
							: ''}"
						>{item.text}{#if item.sub}<span class="block text-[11.5px] text-muted-foreground"
								>{item.sub}</span
							>{/if}</span
					>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<div class="flex flex-col gap-2 border-t p-3">
	<div class="flex gap-2 max-md:hidden">
		<button
			class="inline-flex h-11 flex-1 cursor-pointer touch-none items-center justify-center gap-2 rounded-full border font-semibold select-none {s.talking
				? 'border-sea bg-sea text-on-accent'
				: 'border-sea/55 bg-sea/10 text-sea'}"
			disabled={!s.on || s.paused}
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
			><Mic class="size-4" aria-hidden="true" />{s.talking
				? s.locked
					? 'Mic on · tap to stop'
					: 'Let go to finish'
				: 'Hold to talk'}</button
		>
		<button
			class="h-11 cursor-pointer rounded-full border px-3.5 text-sm {s.locked
				? 'border-teal bg-teal/10 text-teal'
				: 'text-muted-foreground hover:bg-muted'}"
			aria-pressed={s.locked}
			disabled={!s.on || s.paused}
			onclick={() => s.setLocked(!s.locked)}>{s.locked ? 'Mic on' : 'Hands-free'}</button
		>
	</div>
	<form
		class="flex items-center gap-1.5 rounded-lg border border-input bg-card py-0.5 pr-1 pl-3 focus-within:ring-2 focus-within:ring-ring/30"
		onsubmit={submit}
	>
		<input
			class="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
			placeholder="Or type to the scribe…"
			autocomplete="off"
			aria-label="Type to the scribe"
			bind:value={draft}
			disabled={!s.on || s.paused}
		/>
		<button
			class="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Say it"
			disabled={!draft.trim()}><ArrowUp class="size-4" /></button
		>
	</form>
</div>
