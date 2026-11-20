<script lang="ts">
	import {
		ArrowRight,
		AudioLines,
		Check,
		ChevronRight,
		FileText,
		GitPullRequest,
		LoaderCircle,
		Send
	} from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { liveCall, type CrewReply, type LiveEntry } from '$lib/client/livecall.svelte';
	import { parseReply } from '$lib/live/reply';
	import { groupCatchUp } from '$lib/live/catchup';
	import { dotClass, textClass, tone } from '$lib/components/wh/tone';
	import type { TaskSummary } from '$lib/types';
	import LiveVisual from './LiveVisual.svelte';
	import LiveScout from './LiveScout.svelte';

	/**
	 * Live mode in the chat's own feed: the captain's words as their usual
	 * bubbles (with a way to fix what was misheard), the discussion crew as its
	 * own participant (its reply lit as it is spoken, and what it puts up drawn
	 * under it, hand-offs and scouts among it), notices, scout reports as they
	 * come in, and at the end the Captain's briefing (unless the captain just
	 * quit) with the hand-offs still waiting attached, which the captain sends
	 * to Firstmate from here, with a catch-up of what moved on the fleet
	 * meanwhile, gathered by task.
	 */
	let {
		tasks,
		token,
		now,
		projectName,
		onsendbrief
	}: {
		tasks: TaskSummary[];
		token: string;
		now: number;
		projectName: (id: string | null) => string | null;
		/** Send the briefing to Firstmate as the captain's message; false when it cannot be sent. */
		onsendbrief: (text: string) => Promise<boolean>;
	} = $props();

	const time = (iso: string) =>
		new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	let fixing = $state<string | null>(null);
	let fixText = $state('');

	/** The reply's parts, with each prose part's place in the spoken text. */
	function parts(r: CrewReply) {
		let off = 0;
		let block = 0;
		return parseReply(r.text).map((p) => {
			if (p.type === 'prose') {
				const start = off;
				off += p.text.length + 1;
				return { ...p, start };
			}
			return { ...p, start: -1, index: p.closed ? block++ : -1 };
		});
	}
	const speaking = (r: CrewReply) => liveCall.state === 'speaking' && r.spoken < r.queued;

	const taskOf = (id: string) => tasks.find((t) => t.id === id) ?? null;
	const prLabel = (pr: { url: string; number: number | null }) =>
		pr.number == null ? 'PR' : `#${pr.number}`;
	let sending = $state<string | null>(null);
	async function send(e: Extract<LiveEntry, { kind: 'brief' }>) {
		sending = e.id;
		if (await onsendbrief(liveCall.briefText(e))) liveCall.markSent(e);
		sending = null;
	}
</script>

{#each liveCall.entries as e (e.id)}
	{#if e.kind === 'notice'}
		<p
			class="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"
			data-live-notice
		>
			<AudioLines class="size-3.5 shrink-0 text-sea" aria-hidden="true" />{e.text}
		</p>
	{:else if e.kind === 'scout' && !e.report}
		<article class="msg msg-captain" aria-label="You, {time(e.at)}" data-live-captain="scout">
			<span class="captain-avatar">C</span>
			<div class="flex min-w-0 flex-1 flex-col items-end gap-2">
				<header class="msg-head">
					<span class="msg-name">You</span><time datetime={e.at}>{time(e.at)}</time>
					<span
						class="rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
						>LIVE</span
					>
				</header>
				<LiveScout scoutKey={e.scout} />
			</div>
		</article>
	{:else if e.kind === 'captain'}
		<article
			class="msg msg-captain"
			aria-label="You, {time(e.at)}"
			data-live-captain={e.pending ? 'pending' : 'sent'}
		>
			<span class="captain-avatar">C</span>
			<div class="min-w-0 flex-1">
				<header class="msg-head">
					<span class="msg-name">You</span><time datetime={e.at}>{time(e.at)}</time>
					<span
						class="rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
						>LIVE</span
					>
					{#if e.how === 'typed' || e.how === 'fixed'}<span
							class="rounded border px-1 font-mono text-[0.65rem] tracking-wider"
							>{e.how.toUpperCase()}</span
						>{/if}
				</header>
				{#if fixing === e.id}
					<form
						class="flex w-full max-w-[min(85%,62ch)] gap-2"
						onsubmit={(ev) => {
							ev.preventDefault();
							if (e.kind === 'captain') liveCall.fix(e, fixText);
							fixing = null;
						}}
					>
						<input
							class="min-w-0 flex-1 rounded-md border border-sea bg-card px-3 py-1.5 text-sm"
							bind:value={fixText}
							aria-label="What you said"
						/>
						<button class="cursor-pointer rounded-md bg-sea px-3 text-sm font-medium text-on-accent"
							>Send fix</button
						>
					</form>
				{:else}
					<div class="bubble bubble-captain {e.pending ? 'border-dashed opacity-60' : ''}">
						{e.text}
					</div>
					{#if !e.pending && e.how !== 'typed'}
						<button
							class="mt-1 cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
							onclick={() => {
								fixing = e.id;
								fixText = e.kind === 'captain' ? e.text : '';
							}}>Fix what I said</button
						>
					{/if}
				{/if}
			</div>
		</article>
	{:else}
		<article class="msg msg-firstmate" aria-label="Discussion crew, {time(e.at)}" data-live-crew>
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-brass bg-sea/10 text-sea"
			>
				<AudioLines class="size-4" aria-hidden="true" />
			</span>
			<div class="flex min-w-0 flex-1 flex-col items-start gap-2">
				<header class="msg-head">
					<span class="msg-name">Discussion crew</span><time datetime={e.at}>{time(e.at)}</time>
					<span
						class="rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
						>LIVE</span
					>
				</header>
				{#if e.kind === 'writing'}
					<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
						<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />{e.briefing
							? 'Writing the Captain’s briefing for Firstmate…'
							: 'Ending the discussion…'}
					</p>
				{:else if e.kind === 'scout'}
					<LiveScout scoutKey={e.scout} report />
				{:else if e.kind === 'brief'}
					{#if e.briefing || e.handoffs.length}
						<div
							class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border border-sea/45 bg-card"
							data-live-brief
						>
							<div
								class="flex items-center gap-2 border-b border-sea/25 bg-sea/10 px-4 py-2.5 text-sm font-semibold text-sea"
							>
								<FileText class="size-4" aria-hidden="true" />Captain’s briefing · for Firstmate
								<span class="ml-auto font-mono text-[0.7rem] font-normal">{e.minutes} min</span>
							</div>
							<div class="chat-md bg-paper px-5 py-4 font-reading text-ink">
								{#if e.briefing}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
									{@html markdown(e.briefing)}
								{/if}
								{#if e.handoffs.length}
									<h2>Hand-offs from the call</h2>
									<ul data-live-brief-handoffs>
										{#each e.handoffs as n, ni (ni)}<li>{n}</li>{/each}
									</ul>
								{/if}
							</div>
							<div class="flex items-center gap-3 border-t border-hair px-4 py-2.5">
								<span class="text-xs text-muted-foreground"
									>{e.sent
										? 'Sent to Firstmate.'
										: 'Read it over, then send it to Firstmate as your message.'}</span
								>
								<button
									class="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-md bg-sea px-3 py-1.5 text-sm font-medium text-on-accent disabled:cursor-default disabled:opacity-50"
									disabled={e.sent || sending === e.id}
									onclick={() => e.kind === 'brief' && send(e)}
									><Send class="size-3.5" aria-hidden="true" />{e.sent
										? 'Sent'
										: 'Send to Firstmate'}</button
								>
							</div>
						</div>
					{:else if e.quit}
						<p class="text-sm text-muted-foreground" data-live-quit>
							Ended without a briefing. Firstmate hears nothing of the discussion.
						</p>
					{:else}
						<div class="bubble bubble-firstmate">
							Nothing was discussed, so there is no briefing to hand over.
						</div>
					{/if}
					{@const groups = groupCatchUp(e.catchUp)}
					{@const asks = groups.reduce((n, g) => n + g.decisions.length, 0)}
					<section
						class="w-full max-w-[min(100%,44rem)] overflow-hidden rounded-xl border bg-card"
						aria-label="While you talked"
						data-live-catchup
					>
						<header
							class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b px-4 py-2.5 text-sm"
						>
							<b class="font-semibold">While you talked</b>
							<span class="font-mono text-xs text-muted-foreground tabular-nums"
								>{e.minutes} min</span
							>
							<span class="ml-auto text-xs text-muted-foreground">
								{#if groups.length}
									{groups.length} task{groups.length === 1 ? '' : 's'} changed
									{#if asks}·
										<b class="font-semibold text-sea"
											>{asks} decision{asks === 1 ? '' : 's'} for you</b
										>{/if}
								{:else}
									{e.fleet.live} under way · {e.fleet.decisions} decision{e.fleet.decisions === 1
										? ''
										: 's'} open
								{/if}
							</span>
						</header>
						{#if groups.length}
							<ul class="divide-y">
								{#each groups as g (g.task)}
									{@const t = taskOf(g.task)}
									{@const project = projectName(t?.projectId ?? g.project)}
									<li
										class="px-4 py-3 {g.decisions.length
											? 'border-l-[3px] border-l-sea bg-sea/5 pl-[calc(1rem-3px)]'
											: ''}"
										data-catchup-task={g.task}
									>
										<div class="flex min-w-0 items-baseline gap-2">
											<span
												class="size-2 shrink-0 translate-y-[-1px] rounded-full {t
													? dotClass[tone(t)]
													: 'bg-muted-foreground'}"
												aria-hidden="true"
											></span>
											{#if t}
												<a
													class="min-w-0 truncate font-medium hover:underline"
													href="/tasks/{encodeURIComponent(g.task)}">{g.title || g.task}</a
												>
											{:else}
												<span class="min-w-0 truncate font-medium">{g.title || g.task}</span>
											{/if}
											{#if project}<span class="shrink-0 text-xs text-muted-foreground"
													>{project}</span
												>{/if}
											{#if t?.pr}
												<a
													class="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-xs text-sea hover:underline"
													href={t.pr.url}
													target="_blank"
													rel="noreferrer"
													><GitPullRequest class="size-3" aria-hidden="true" />{prLabel(t.pr)}</a
												>
											{/if}
										</div>
										{#if g.moved}
											<p class="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4 text-xs">
												{#if g.moved.from}
													<span class="text-muted-foreground">{g.moved.from}</span>
													<ArrowRight class="size-3 text-muted-foreground" aria-label="to" />
												{:else}
													<span class="text-muted-foreground">New task</span>
													<ArrowRight class="size-3 text-muted-foreground" aria-label="now" />
												{/if}
												{#if g.moved.to}
													<span
														class="rounded-full border px-2 py-px font-medium {t
															? textClass[tone(t)]
															: ''}">{g.moved.to}</span
													>
												{:else}
													<span class="text-muted-foreground">{g.moved.text}</span>
												{/if}
											</p>
										{/if}
										{#each g.decisions as d, di (di)}
											<details class="group mt-1.5 pl-4 text-sm" data-catchup-decision>
												<summary
													class="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden"
												>
													<span
														class="shrink-0 rounded border border-sea/50 px-1 font-mono text-[0.65rem] tracking-wider text-sea"
														>FOR YOU</span
													>
													<span class="min-w-0 flex-1 truncate group-open:whitespace-normal"
														>{d.summary}</span
													>
													<ChevronRight
														class="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform group-open:rotate-90"
														aria-hidden="true"
													/>
												</summary>
												{#if d.text && d.text !== d.summary}
													<div
														class="chat-md mt-2 rounded-md border bg-paper px-3 py-2 font-reading text-[0.85rem] text-ink"
													>
														<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
														{@html markdown(d.text)}
													</div>
												{/if}
											</details>
										{/each}
										{#each g.cleared as c, ci (ci)}
											<p
												class="mt-1.5 flex items-baseline gap-1.5 pl-4 text-xs text-muted-foreground"
											>
												<Check
													class="size-3 shrink-0 translate-y-0.5 text-success"
													aria-hidden="true"
												/>
												<span class="min-w-0 truncate"
													>Decision settled{c.text && c.text !== c.summary
														? `: ${c.text}`
														: ''}</span
												>
											</p>
										{/each}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-4 py-3 text-sm text-muted-foreground">
								Nothing changed state. Firstmate is still on watch.
							</p>
						{/if}
					</section>
				{:else if e.kind === 'crew'}
					{#each parts(e) as p, i (i)}
						{#if p.type === 'prose'}
							{@const shown = e.interrupted
								? p.text.slice(0, Math.max(0, e.spoken - p.start))
								: p.text}
							{#if shown.trim()}
								{#if speaking(e) || e.streaming}
									{@const lit = Math.max(0, Math.min(shown.length, e.spoken - p.start))}
									<div class="bubble bubble-firstmate border-sea/30">
										{shown.slice(0, lit)}<span class="text-muted-foreground"
											>{shown.slice(lit)}</span
										>
									</div>
								{:else}
									<div class="chat-md bubble bubble-firstmate border-sea/30">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
										{@html markdown(shown.trim())}
									</div>
								{/if}
							{/if}
						{:else if 'index' in p && p.index >= 0 && e.visuals[p.index]}
							<LiveVisual
								visual={e.visuals[p.index]}
								key="{e.id}:{p.index}"
								{tasks}
								{token}
								{now}
								{projectName}
							/>
						{:else if !e.interrupted}
							<p class="flex items-center gap-2 text-sm text-muted-foreground">
								<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Putting something up…
							</p>
						{/if}
					{/each}
					{#if !e.text && e.streaming}
						<div class="flex gap-1 py-2" role="status" aria-label="The discussion crew is thinking">
							<span class="size-1.5 animate-bounce rounded-full bg-sea [animation-delay:-0.3s]"
							></span>
							<span class="size-1.5 animate-bounce rounded-full bg-sea [animation-delay:-0.15s]"
							></span>
							<span class="size-1.5 animate-bounce rounded-full bg-sea"></span>
						</div>
					{/if}
					{#if e.interrupted}<span class="worked-for w-full">Interrupted</span>{/if}
				{/if}
			</div>
		</article>
	{/if}
{/each}
