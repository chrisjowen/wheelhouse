<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { mmss, plural, SEVERITIES } from '$lib/livereview';
	import type { LiveReviewSession } from '$lib/client/livereview.svelte';
	import {
		CircleHelp,
		Check,
		MousePointerClick,
		FileText,
		Mic,
		Send,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { KIND, SEVERITY } from './kinds';

	/**
	 * The feedback pack at the end of a live review (ReviewDock.svelte): a
	 * summary and one point per change, each with its screenshot, the part of
	 * the page, the captain's words and the moment, all editable; and beside
	 * them the message exactly as Firstmate will get it. It opens at once from
	 * the notes as they stand and takes the scribe's tidier version when it
	 * arrives (unless the captain has started editing). Request changes keeps
	 * the session and screenshots as files and sends the message to Firstmate
	 * for this task's worker.
	 */
	let { session: s, onclose }: { session: LiveReviewSession; onclose: () => void } = $props();

	const p = $derived(s.pack!);
	const st = $derived(s.stats());
	const included = $derived(p.points.filter((x) => x.include).length);
	const message = $derived(s.message(null));
	const edited = () => {
		if (s.pack) s.pack.edited = true;
	};
</script>

<div class="fixed inset-0 z-[55] bg-black/55" transition:fade={{ duration: 200 }}></div>
<section
	class="fixed inset-y-0 right-0 z-[56] flex w-[min(74rem,96vw)] flex-col border-l bg-background shadow-2xl max-md:w-screen"
	aria-label="Feedback pack"
	transition:fly={{ x: 40, duration: 320 }}
	data-review-pack
>
	<header class="flex items-start justify-between gap-4 border-b px-6 pt-5 pb-3 max-md:px-4">
		<div class="min-w-0">
			<p class="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
				Feedback pack · for Firstmate
			</p>
			<h2 class="mt-1 line-clamp-2 font-title text-3xl">
				Live review of <em class="text-sea">{s.title}</em>
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				{s.taskId} · {mmss(p.duration)} · {plural(st.remarks, 'remark')} · {plural(
					st.clicks,
					'click'
				)}
				· {plural(st.pages, 'page')} · {plural(st.shots, 'screenshot')}{p.tidying
					? ' · the scribe is tidying'
					: p.from === 'scribe'
						? ' · tidied by the scribe'
						: ''}
			</p>
		</div>
		<button
			class="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label={p.sent ? 'Close' : 'Back to the session'}
			onclick={() => (p.sent ? onclose() : s.resume())}><X class="size-5" /></button
		>
	</header>

	<div class="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_25rem]">
		<div class="min-w-0 px-6 py-5 max-md:px-4">
			{#if p.tidying}
				<p
					class="mb-4 rounded-lg border border-dashed border-sea/45 px-3 py-2 text-sm text-muted-foreground"
					role="status"
				>
					<span class="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-sea"></span>The
					scribe is tidying these into clearer points; they update here in a moment. You can send
					now if you like.
				</p>
			{:else if p.better}
				<p
					class="mb-4 rounded-lg border border-dashed border-sea/45 px-3 py-2 text-sm text-muted-foreground"
				>
					The scribe’s tidied version is ready.
					<button class="cursor-pointer text-sea hover:underline" onclick={() => s.useBetter()}
						>Use it instead of my edits</button
					>
				</p>
			{:else if p.tidyFailed}
				<p class="mb-4 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
					The scribe could not tidy this one ({p.tidyFailed}); these are its notes as they stood.
				</p>
			{/if}
			<p class="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
				In short
			</p>
			<p
				class="mt-1 mb-6 max-w-[70ch] rounded font-reading text-lg leading-relaxed outline-none focus:ring-2 focus:ring-sea/40"
				contenteditable="true"
				bind:textContent={p.summary}
				oninput={edited}
			></p>
			<p class="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
				{plural(p.points.length, 'point')} for the worker
				<span class="font-sans tracking-normal normal-case">· click any words to change them</span>
			</p>
			{#each p.points as x, i (x.key)}
				{@const k = KIND[x.kind]}
				<div
					class="grid gap-4 border-t py-4 md:grid-cols-[17rem_minmax(0,1fr)] {x.include
						? ''
						: 'opacity-45'}"
					data-pack-point
				>
					{#if x.shotId}
						{#await s.outlined(x.shotId) then url}
							{#if url}<img
									src={url}
									alt="The page for point {i + 1}"
									class="aspect-[16/10] w-full rounded-md border object-cover object-top"
								/>{:else}<div
									class="grid aspect-[16/10] place-items-center rounded-md border bg-muted text-xs text-muted-foreground"
								>
									No screenshot
								</div>{/if}
						{/await}
					{:else}
						<div
							class="grid aspect-[16/10] place-items-center rounded-md border bg-muted text-xs text-muted-foreground"
						>
							No screenshot
						</div>
					{/if}
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2 text-xs">
							<span class="font-mono text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
							<select
								class="rounded-full border bg-card px-2 py-0.5"
								bind:value={x.severity}
								onchange={edited}
								aria-label="How much it matters"
							>
								{#each SEVERITIES as sev (sev)}<option value={sev}
										>{sev === 'none' ? 'Keep as is' : SEVERITY[sev]}</option
									>{/each}
							</select>
							<span
								class="inline-flex items-center gap-1 font-mono text-[10.5px] tracking-[0.12em] uppercase {k.tone}"
								><k.icon class="size-3.5" />{k.word}</span
							>
							<label class="ml-auto inline-flex cursor-pointer items-center gap-1.5">
								<input
									type="checkbox"
									class="accent-primary"
									bind:checked={x.include}
									onchange={edited}
								/>
								Include
							</label>
						</div>
						<h3
							class="mt-1.5 rounded text-base font-semibold outline-none focus:ring-2 focus:ring-sea/40"
							contenteditable="true"
							bind:textContent={x.title}
							oninput={edited}
						></h3>
						<p
							class="mt-1 rounded text-sm outline-none focus:ring-2 focus:ring-sea/40"
							contenteditable="true"
							bind:textContent={x.detail}
							oninput={edited}
						></p>
						{#if x.quote}<p
								class="mt-2 border-l-2 border-sea/60 pl-2.5 font-reading text-[15px] text-muted-foreground italic"
							>
								“{x.quote}”
							</p>{/if}
						<p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							{#if x.el}<span class="inline-flex items-center gap-1"
									><MousePointerClick class="size-3" />{x.el.label}</span
								>{/if}
							{#if x.page}<span class="inline-flex items-center gap-1"
									><FileText class="size-3" />{x.page}</span
								>{/if}
							<span class="inline-flex items-center gap-1"><Mic class="size-3" />{mmss(x.t)}</span>
						</p>
					</div>
				</div>
			{/each}
			{#if p.errors.length}
				<p class="mt-6 font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
					Also seen on the page
				</p>
				<ul class="mt-1 text-sm">
					{#each p.errors as e (e)}<li class="flex gap-2 border-t border-hair py-1.5">
							<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-danger" />{e}
						</li>{/each}
				</ul>
			{/if}
			{#if p.openQuestions.length}
				<p class="mt-6 font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
					Open questions
				</p>
				<ul class="mt-1 text-sm">
					{#each p.openQuestions as q (q)}<li class="flex gap-2 border-t border-hair py-1.5">
							<CircleHelp class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{q}
						</li>{/each}
				</ul>
			{/if}
		</div>

		<aside
			class="border-l bg-panel px-5 py-5 max-md:border-t max-md:border-l-0 md:sticky md:top-0 md:self-start"
		>
			<div class="grid grid-cols-3 gap-2">
				{#each [[included, 'points'], [st.shots, 'screenshots'], [mmss(p.duration), 'recorded']] as [n, word] (word)}
					<div class="rounded-lg border bg-card px-2.5 py-2">
						<b class="block font-title text-2xl leading-tight font-normal">{n}</b>
						<span class="text-xs text-muted-foreground">{word}</span>
					</div>
				{/each}
			</div>
			<p class="mt-5 font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground uppercase">
				As Firstmate gets it
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				One message for {s.taskId}, passed to the same worker, with the screenshots and the whole
				session kept as files it names.
			</p>
			<pre
				class="mt-2 max-h-[46vh] overflow-auto rounded-lg border bg-card p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">{message}</pre>
			{#if p.error}<p class="mt-2 text-sm text-danger" role="alert">{p.error}</p>{/if}
			{#if p.sent}
				<div
					class="mt-3 rounded-lg border border-teal/45 bg-teal/10 px-3 py-2.5 text-sm"
					role="status"
				>
					<b class="inline-flex items-center gap-1.5 text-teal"
						><Check class="size-4" />Changes requested</b
					>
					<p class="mt-1 text-xs text-muted-foreground">
						Sent to Firstmate, which passes the pack to this task’s worker. The session and
						screenshots are kept in
						<span class="font-mono break-all">{p.sent.dir}</span>.
					</p>
				</div>
				<button
					class="mt-3 h-9 cursor-pointer rounded-md border px-3 text-sm hover:bg-muted"
					onclick={onclose}>Close</button
				>
			{:else}
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-sea px-3.5 text-sm font-semibold text-on-accent hover:bg-sea/90 disabled:opacity-50"
						disabled={!included || p.sending}
						onclick={() => void s.send()}
						data-review-send
						><Send class="size-4" aria-hidden="true" />{p.sending
							? 'Sending…'
							: 'Request changes'}</button
					>
					<button
						class="h-9 cursor-pointer rounded-md border px-3 text-sm hover:bg-muted"
						onclick={() => s.resume()}>Back to the session</button
					>
					<button
						class="h-9 cursor-pointer rounded-md px-3 text-sm text-muted-foreground hover:bg-muted"
						onclick={onclose}>Throw away</button
					>
				</div>
			{/if}
		</aside>
	</div>
</section>
