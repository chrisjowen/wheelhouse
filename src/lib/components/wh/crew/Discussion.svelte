<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowUp,
		CheckCheck,
		CircleX,
		Clock,
		LoaderCircle,
		Pause,
		Play,
		RotateCw,
		SquareTerminal,
		Activity as Pulse,
		UsersRound,
		X
	} from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import {
		canDiscuss,
		discussionEntries,
		type CrewDiscussion,
		type CrewKind,
		type CrewMessage
	} from '$lib/crew';
	import { WorkerChat, discussion as changeDiscussion, sayToWorker } from '$lib/client/crew.svelte';
	import { live } from '$lib/client/live.svelte';
	import { clock } from '$lib/format';
	import { hueOf, initials } from '$lib/bridge';
	import { HARNESS_NAMES, type Harness } from '$lib/harness';
	import type { TaskSummary } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import Activity from '$lib/components/firstmate/Activity.svelte';
	import ConsoleWindow from '../ConsoleWindow.svelte';
	import TaskDecisions from '../inbox/TaskDecisions.svelte';

	/**
	 * A task's Chat: its worker's own conversation, folded as the chat folds
	 * Firstmate's. Read-only by default, with the message box greyed out and
	 * one way in, Chat with crew, which says what talking to the worker
	 * directly means before it opens a crew discussion (lib/crew.ts).
	 *
	 * In a discussion, a SIDEBAR banner says so, the captain's messages sit
	 * among the worker's with their receipts (sending, in its inbox, seen by
	 * the worker; Firstmate told), and the task's open questions sit above,
	 * answered as on the Decisions page, which closes Firstmate's decision too.
	 * Quick actions ask for its status, pause it after its current step (or
	 * resume it) and show its terminal, read-only. End discussion makes the
	 * Chat read-only again.
	 */
	let {
		taskId,
		discussion,
		task,
		token,
		onended
	}: {
		taskId: string;
		/** The open crew discussion on the task; null while the Chat is read-only. */
		discussion: CrewDiscussion | null;
		/** The task in the fleet, while it is there. */
		task: TaskSummary | null;
		token: string;
		/** The captain ended the discussion. */
		onended?: () => void;
	} = $props();

	const id = $derived(taskId);
	let worker = $state<WorkerChat | null>(null);
	$effect(() => {
		const w = new WorkerChat(id);
		worker = w;
		const stop = w.connect();
		return () => {
			stop();
			worker = null;
		};
	});

	let all = $state(false);
	/** Read-only, the conversation's latest entries; more as the captain asks for them. */
	const READ_ONLY_PAGE = 60;
	let shownAll = $state(READ_ONLY_PAGE);
	const view = $derived.by(() => {
		if (discussion)
			return discussionEntries(
				worker?.chat.items ?? [],
				discussion.messages,
				discussion.openedAt,
				all
			);
		const { entries } = discussionEntries(worker?.chat.items ?? [], [], '', true);
		const from = Math.max(0, entries.length - shownAll);
		return { entries: entries.slice(from), earlier: from };
	});
	const showEarlier = () => (discussion ? (all = true) : (shownAll += READ_ONLY_PAGE));
	// Only the captain's own workers at work can be talked to (lib/crew.ts canDiscuss).
	const offer = $derived(
		!task
			? 'Its task has left the fleet.'
			: task.secondMate || task.id.includes('@')
				? 'Chatting with a second mate’s worker comes later.'
				: canDiscuss(task)
					? null
					: 'Its worker is not at work.'
	);
	const harness = $derived(
		(worker?.session?.harness ?? task?.worker?.harness ?? null) as Harness | null
	);
	const harnessName = $derived(harness ? (HARNESS_NAMES[harness] ?? harness) : null);

	let text = $state('');
	let error = $state<string | null>(null);
	let ending = $state(false);
	let terminal = $state(false);
	let asking = $state(false);
	let starting = $state(false);

	/** Open a crew discussion, once the captain has confirmed what it means. */
	async function start() {
		starting = true;
		error = null;
		const r = await changeDiscussion(id, 'open', token);
		starting = false;
		if (r.ok) asking = false;
		else error = r.error;
	}

	async function say(kind: CrewKind, words = '', retryId?: string) {
		error = null;
		const r = await sayToWorker(id, kind, words, token, retryId);
		if (!r.ok) error = r.error;
	}

	function send() {
		const words = text.trim();
		if (!words) return;
		text = '';
		void say('say', words);
		void tick().then(() => toEnd(true));
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}

	async function end() {
		ending = true;
		const r = await changeDiscussion(id, 'close', token);
		ending = false;
		if (r.ok) onended?.();
		else error = r.error;
	}

	// Keep the newest in view while the captain is reading the end.
	let stream = $state<HTMLDivElement | null>(null);
	let atEnd = true;
	function toEnd(force = false) {
		if (stream && (force || atEnd)) stream.scrollTop = stream.scrollHeight;
	}
	$effect(() => {
		void view.entries.length;
		void worker?.records.length;
		void tick().then(() => toEnd());
	});

	const receipt = (m: CrewMessage) =>
		m.delivery === 'sending'
			? 'Sending'
			: m.delivery === 'failed'
				? (m.error ?? 'Not delivered')
				: m.seen
					? `Seen by ${id}`
					: 'In its inbox';
	const QUICK: Record<Exclude<CrewKind, 'say'>, string> = {
		status: 'Asked for status',
		pause: 'Asked to pause',
		resume: 'Asked to resume'
	};
</script>

<section
	class="flex h-full min-h-0 flex-col"
	aria-label={discussion ? `Crew discussion with ${id}` : `${id}’s conversation`}
	data-discussion={discussion ? id : undefined}
	data-task-chat={id}
>
	<header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5">
		<span class="mate-avatar" data-hue={hueOf(id)} aria-hidden="true">{initials(id)}</span>
		<div class="min-w-0 flex-1">
			<p class="flex items-baseline gap-2">
				<a
					class="font-mono text-sm font-semibold hover:underline"
					href="/tasks/{encodeURIComponent(id)}">{id}</a
				>
				<span class="truncate text-sm text-muted-foreground"
					>{task?.title ?? discussion?.title ?? ''}</span
				>
			</p>
			<p class="text-xs text-muted-foreground">
				{harnessName ?? 'Worker'}{task ? ` · ${task.statusLabel}` : ' · no longer in the fleet'}
			</p>
		</div>
		{#if discussion}
			<Button variant="outline" size="sm" onclick={end} disabled={ending} data-end-discussion
				>{#if ending}<LoaderCircle class="animate-spin" />{:else}<X />{/if}End discussion</Button
			>
		{:else}
			<span class="text-xs text-muted-foreground">Read-only</span>
		{/if}
	</header>

	{#if discussion}
		<p class="crew-banner" role="note">
			<span class="crew-tag">Sidebar</span>
			<span
				>You’re talking to <b>{id}</b> directly. It can answer you here, and Firstmate gets a note of
				each message.</span
			>
		</p>
	{:else}
		<p class="crew-banner crew-banner-read" role="note">
			<span class="crew-tag">Read-only</span>
			<span>{id}’s own conversation. You’re watching; Firstmate steers it.</span>
		</p>
	{/if}
	{#if discussion?.paused}
		<p class="crew-banner crew-banner-paused" role="status">
			<span class="crew-tag">Paused</span><span
				>You asked {id} to stop after its current step. It waits until you resume it.</span
			>
		</p>
	{/if}

	<div
		class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5"
		bind:this={stream}
		onscroll={() => {
			if (stream) atEnd = stream.scrollTop + stream.clientHeight >= stream.scrollHeight - 40;
		}}
		aria-live="polite"
		data-discussion-feed
	>
		{#if task && discussion}<div class="-mt-5"><TaskDecisions {task} now={live.now} /></div>{/if}
		{#if worker?.session?.reason}
			<p class="mt-4 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground" role="status">
				{worker.session.reason}
			</p>
		{:else if worker?.synced && !worker.source}
			<p class="mt-4 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground" role="status">
				Wheelhouse has not found {id}’s conversation yet.{discussion
					? ' What you send still reaches it.'
					: ''}
			</p>
		{/if}
		{#if view.earlier}
			<button
				class="mx-auto mt-4 block cursor-pointer text-sm text-sea hover:underline"
				onclick={showEarlier}
				data-show-earlier>Show its earlier work ({view.earlier})</button
			>
		{/if}
		<div class="mt-5 flex flex-col gap-6">
			{#each view.entries as e, i (e.kind === 'captain' ? `c-${e.message.id}` : `${e.kind}-${e.item.id}-${i}`)}
				{#if e.kind === 'captain'}
					{@const m = e.message}
					<article class="msg msg-captain" aria-label="You, {clock(m.at)}" data-crew-message={m.id}>
						<span class="captain-avatar">C</span>
						<div class="min-w-0 flex-1">
							<header class="msg-head">
								<span class="crew-tag">Sidebar</span><time datetime={m.at}>{clock(m.at)}</time>
							</header>
							{#if m.kind === 'say'}
								<div class="bubble-row"><div class="bubble bubble-captain">{m.text}</div></div>
							{:else}
								<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
									{#if m.kind === 'pause'}<Pause
											class="size-3.5"
											aria-hidden="true"
										/>{:else if m.kind === 'resume'}<Play
											class="size-3.5"
											aria-hidden="true"
										/>{:else}<Pulse class="size-3.5" aria-hidden="true" />{/if}{QUICK[m.kind]}
								</p>
							{/if}
							<p
								class="mt-1 flex flex-wrap items-center justify-end gap-x-2 font-mono text-[0.72rem] {m.delivery ===
								'failed'
									? 'text-danger'
									: 'text-muted-foreground'}"
								data-receipt={m.delivery === 'sent' ? (m.seen ? 'seen' : 'sent') : m.delivery}
							>
								{#if m.delivery === 'sending'}<LoaderCircle
										class="size-3 animate-spin"
										aria-hidden="true"
									/>
								{:else if m.delivery === 'failed'}<CircleX class="size-3" aria-hidden="true" />
								{:else if m.seen}<CheckCheck class="size-3 text-success" aria-hidden="true" />
								{:else}<Clock class="size-3" aria-hidden="true" />{/if}
								<span>{receipt(m)}</span>
								{#if m.delivery === 'failed'}
									<button
										class="inline-flex cursor-pointer items-center gap-1 font-sans font-medium hover:underline"
										onclick={() => say(m.kind, m.text, m.id)}
										><RotateCw class="size-3" aria-hidden="true" />Send again</button
									>
								{:else if m.delivery === 'sent'}
									<span
										>· {m.told === 'sent'
											? 'Firstmate told'
											: m.told === 'sending'
												? 'telling Firstmate'
												: m.told === 'off'
													? 'Firstmate not told (messaging is off)'
													: 'Firstmate could not be told'}</span
									>
								{/if}
							</p>
						</div>
					</article>
				{:else if e.kind === 'firstmate'}
					<details class="crew-note">
						<summary>Typed into its session · <time datetime={e.at}>{clock(e.at)}</time></summary>
						<p class="mt-2 whitespace-pre-wrap">{e.item.text}</p>
					</details>
				{:else if e.item.kind === 'turn'}
					{@const item = e.item}
					<article class="msg msg-firstmate" aria-label="{id}, {clock(item.at)}">
						<span class="mate-avatar msg-avatar" data-hue={hueOf(id)} aria-hidden="true"
							>{initials(id)}</span
						>
						<div class="flex min-w-0 flex-1 flex-col gap-2">
							<header class="msg-head">
								<span class="msg-name font-mono">{id}</span>{#if harnessName}<span
										>{harnessName}</span
									>{/if}<time datetime={item.at}>{clock(item.at)}</time>
							</header>
							{#each item.parts as part, pi (part.id)}
								{#if part.kind === 'text' && part.text.trim()}
									<div class="bubble-row">
										<div class="chat-md bubble bubble-firstmate">
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
											{@html markdown(part.text)}
										</div>
									</div>
								{:else if part.kind === 'activity'}
									<Activity
										steps={part.steps}
										live={!item.done &&
											pi === item.parts.length - 1 &&
											i === view.entries.length - 1}
									/>
								{:else if part.kind === 'question'}
									<p class="rounded-lg border px-4 py-3 text-sm">
										It asked in its session: {part.questions.map((q) => q.question).join(' ')}
										<span class="text-muted-foreground"
											>Answer in its terminal, or tell it here.</span
										>
									</p>
								{/if}
							{/each}
						</div>
					</article>
				{:else if e.item.kind === 'output'}
					<pre
						class="no-scrollbar max-h-60 max-w-[80ch] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{e
							.item.text}</pre>
				{:else if e.item.kind === 'notice'}
					<p class="text-xs text-muted-foreground">{e.item.title} · {clock(e.item.at)}</p>
				{/if}
			{/each}
		</div>
	</div>

	{#if terminal && task}
		<div class="border-t px-4 py-3 sm:px-5" data-discussion-terminal>
			<p class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
				<SquareTerminal class="size-3.5" aria-hidden="true" />Its terminal, read-only. Type to it
				here, not there: what you send goes through its inbox.
			</p>
			<ConsoleWindow {task} lines={16} />
		</div>
	{/if}

	{#if !discussion}
		<div class="border-t px-4 pt-3 pb-4 sm:px-5">
			<div
				class="flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 py-2 pr-2 pl-4"
				data-chat-locked
			>
				<span class="flex-1 text-muted-foreground/80"
					>Read-only · talk to Firstmate about this task, or</span
				>
				<Button
					variant="outline"
					size="sm"
					disabled={!!offer}
					title={offer ?? undefined}
					onclick={() => (asking = true)}
					data-chat-with-crew><UsersRound />Chat with crew</Button
				>
			</div>
			<p class="mt-1.5 text-xs text-muted-foreground">
				{offer ?? 'You’ll be asked to confirm first: you talk to the worker directly.'}
			</p>
			{#if error}<p class="mt-1 text-sm text-danger" role="alert">{error}</p>{/if}
		</div>
		<Dialog.Root bind:open={asking}>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title class="font-display text-lg">Talk to {id} directly?</Dialog.Title>
					<Dialog.Description>
						You’ll message this task’s worker yourself, outside Firstmate’s usual relay. What you
						say goes to its inbox as yours, it can answer you here, and Firstmate gets a note of
						each message so it stays in step. End the discussion when you’re done; most of the time,
						talk to Firstmate.
					</Dialog.Description>
				</Dialog.Header>
				{#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
				<Dialog.Footer>
					<Dialog.Close>
						{#snippet child({ props })}<Button {...props} variant="ghost">Cancel</Button>{/snippet}
					</Dialog.Close>
					<Button onclick={start} disabled={starting} data-crew-confirm
						>{#if starting}<LoaderCircle class="animate-spin" />{/if}Start the discussion</Button
					>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{:else}
		<div class="border-t px-4 pt-3 pb-4 sm:px-5">
			<div class="mb-2 flex flex-wrap gap-2">
				<Button variant="outline" size="sm" onclick={() => say('status')} data-quick="status"
					><Pulse />Ask for status</Button
				>
				{#if discussion.paused}
					<Button variant="outline" size="sm" onclick={() => say('resume')} data-quick="resume"
						><Play />Resume</Button
					>
				{:else}
					<Button variant="outline" size="sm" onclick={() => say('pause')} data-quick="pause"
						><Pause />Pause after this step</Button
					>
				{/if}
				{#if task}
					<Button
						variant="outline"
						size="sm"
						aria-pressed={terminal}
						onclick={() => (terminal = !terminal)}
						data-quick="terminal"
						><SquareTerminal />{terminal ? 'Hide' : 'Show'} its terminal</Button
					>
				{/if}
			</div>
			<form
				class="flex items-end gap-2 rounded-xl border bg-card px-3 py-2 focus-within:ring-3 focus-within:ring-ring/50"
				onsubmit={(e) => {
					e.preventDefault();
					send();
				}}
			>
				<textarea
					class="field-sizing-content max-h-48 min-h-10 flex-1 resize-none bg-transparent py-1.5 outline-none placeholder:text-muted-foreground"
					placeholder="Message {id} directly"
					aria-label="Message {id} directly"
					bind:value={text}
					{onkeydown}
					data-discussion-input></textarea>
				<Button
					type="submit"
					size="icon"
					class="rounded-full"
					disabled={!text.trim()}
					aria-label="Send"><ArrowUp /></Button
				>
			</form>
			<p class="mt-1.5 text-xs text-muted-foreground">
				Goes to its inbox as yours; Firstmate gets a note.
			</p>
			{#if error}<p class="mt-1 text-sm text-danger" role="alert">{error}</p>{/if}
		</div>
	{/if}
</section>

<style>
	.crew-banner {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--sea) 8%, transparent);
		padding: 0.6rem 1.25rem;
		font-size: var(--text-sm);
	}
	.crew-banner-read {
		background: color-mix(in srgb, var(--muted) 45%, transparent);
	}
	.crew-banner-read .crew-tag {
		border-color: var(--border);
		color: var(--muted-foreground);
	}
	.crew-banner-paused {
		background: color-mix(in srgb, var(--warning) 10%, transparent);
	}
	.crew-tag {
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--sea) 55%, transparent);
		border-radius: 0.25rem;
		padding: 0 0.4rem;
		color: var(--sea);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.crew-banner-paused .crew-tag {
		border-color: color-mix(in srgb, var(--warning) 55%, transparent);
		color: var(--warning);
	}
	.crew-note {
		align-self: center;
		max-width: 80ch;
		font-size: var(--text-xs);
		color: var(--muted-foreground);
	}
	.crew-note summary {
		cursor: pointer;
	}
	.msg-avatar {
		width: 2rem;
		height: 2rem;
	}
</style>
