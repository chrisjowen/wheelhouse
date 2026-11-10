<script lang="ts">
	/**
	 * Talking a preview through before any feedback goes out (lib/previewhelper.ts):
	 * a conversation with a helper that sees only this task's preview, its
	 * screenshots, instructions and history. Point (with the page beside it)
	 * names the part of the page the next message is about. The helper answers,
	 * asks and suggests lines for the feedback list underneath, which the
	 * captain adds, edits, removes or writes; Send to Firstmate posts the whole
	 * list as one message for this same task, which also shows in the main chat.
	 * Nothing goes anywhere before that. `pointing` and `attached` are shared
	 * with the LivePreview beside it, which takes the click.
	 */
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import {
		ArrowUp,
		Check,
		ChevronDown,
		Crosshair,
		MessageSquare,
		MonitorPlay,
		Plus,
		Send,
		X
	} from '@lucide/svelte';
	import { markdown } from '$lib/chat/markdown';
	import { previewHelpers } from '$lib/client/previewhelper.svelte';
	import type { Pointer } from '$lib/previewhelper';
	import DictateTextarea from './DictateTextarea.svelte';

	let {
		task,
		url,
		pointing = $bindable(false),
		attached = $bindable(null)
	}: {
		task: { id: string; shortTitle: string };
		url: string;
		pointing?: boolean;
		attached?: { pointer: Pointer; at: { x: number; y: number } } | null;
	} = $props();

	const c = $derived(previewHelpers.view(task.id));
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
	let draft = $state('');
	let own = $state('');
	let listOpen = $state(true);
	let sending = $state(false);
	let thread = $state<HTMLElement | null>(null);
	let box = $state<HTMLDivElement | null>(null);

	onMount(() => previewHelpers.load());

	// Follow the conversation as it grows.
	$effect(() => {
		void c.said.length;
		void c.asking;
		void tick().then(() => thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }));
	});
	// Pointed at something: ready to say what about it.
	$effect(() => {
		if (attached) void tick().then(() => box?.querySelector('textarea')?.focus());
	});

	function ask() {
		const words = draft.trim();
		if ((!words && !attached) || c.asking) return;
		const points = attached?.pointer ?? null;
		draft = '';
		attached = null;
		void previewHelpers.ask(task.id, words, points, token);
	}

	async function send() {
		if (!c.list.length || sending) return;
		sending = true;
		await previewHelpers.send({ id: task.id, title: task.shortTitle }, url, token);
		sending = false;
	}
</script>

<section
	class="flex min-h-0 flex-col rounded-lg border bg-panel"
	aria-label="Talk about this preview"
	data-preview-helper
>
	<header class="border-b px-4 py-3">
		<h2 class="flex items-center gap-2 text-base">
			<MessageSquare class="size-4 text-muted-foreground" aria-hidden="true" />Talk it through
		</h2>
		<p class="mt-0.5 text-xs text-muted-foreground">
			A helper that sees only this preview. Nothing goes to Firstmate until you send.
		</p>
	</header>

	<div bind:this={thread} class="no-scrollbar min-h-40 flex-1 overflow-y-auto px-4 py-4">
		<ol class="flex flex-col gap-4">
			<li class="flex gap-2.5">
				<span
					class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-brass bg-card text-sea"
					aria-hidden="true"><MonitorPlay class="size-3.5" /></span
				>
				<!-- Plain markup, not Markdown: this part is drawn on the server too. -->
				<p class="min-w-0 flex-1 text-sm leading-relaxed">
					I can see this preview, its screenshots, the task’s instructions and what the worker has
					done so far. Point at anything, or just say what you think; I will turn it into a list for
					the worker. <strong>Nothing goes to Firstmate until you send it.</strong>
				</p>
			</li>
			{#each c.said as m (m.id)}
				{#if m.who === 'captain'}
					<li class="flex flex-col items-end gap-1" data-said="captain">
						{#if m.points}
							<span
								class="inline-flex max-w-[85%] items-center gap-1 rounded-md bg-sea/10 px-2 py-0.5 text-xs text-sea"
								><Crosshair class="size-3 shrink-0" aria-hidden="true" /><span class="truncate"
									>{m.points.label}</span
								></span
							>
						{/if}
						<p
							class="max-w-[85%] rounded-xl rounded-br-sm border border-[var(--bubble-captain-border)] bg-[var(--bubble-captain)] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap"
						>
							{m.text}
						</p>
					</li>
				{:else}
					<li class="flex gap-2.5" data-said="helper">
						<span
							class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-brass bg-card text-sea"
							aria-hidden="true"><MonitorPlay class="size-3.5" /></span
						>
						<div class="min-w-0 flex-1">
							<div class="chat-md text-sm {m.notice ? 'text-muted-foreground' : ''}">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify in markdown() -->
								{@html markdown(m.text)}
							</div>
							{#if m.notice && c.sent}
								<a href="/" class="text-xs text-sea hover:underline">See it in the chat</a>
							{/if}
							{#each m.suggest ?? [] as s, i (i)}
								<div class="mt-2 rounded-md border bg-card px-3 py-2" data-suggestion>
									<p class="text-sm leading-snug">{s.text}</p>
									<div class="mt-1.5">
										{#if s.added}
											<span class="inline-flex items-center gap-1 text-xs text-success"
												><Check class="size-3.5" aria-hidden="true" />On your list</span
											>
										{:else}
											<button
												class="inline-flex cursor-pointer items-center gap-1 rounded-md bg-sea px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-sea/90"
												onclick={() => previewHelpers.accept(task.id, m.id, i)}
												data-add-to-list
												><Plus class="size-3.5" aria-hidden="true" />Add to the list</button
											>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</li>
				{/if}
			{/each}
			{#if c.asking}
				<li class="flex gap-1 py-1 pl-9" role="status" aria-label="The helper is answering">
					<span
						class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]"
					></span>
					<span
						class="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]"
					></span>
					<span class="size-1.5 animate-bounce rounded-full bg-muted-foreground"></span>
				</li>
			{/if}
			{#if c.error}<li class="text-sm text-danger" role="alert">{c.error}</li>{/if}
		</ol>
	</div>

	<div class="px-3 pb-3" bind:this={box}>
		<div
			class="rounded-lg border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/30"
		>
			{#if attached}
				<div class="flex items-center gap-1.5 px-2.5 pt-2">
					<span
						class="inline-flex min-w-0 items-center gap-1 rounded-md bg-sea/10 px-2 py-0.5 text-xs text-sea"
						data-attached
						><Crosshair class="size-3 shrink-0" aria-hidden="true" /><span class="truncate"
							>{attached.pointer.label}</span
						></span
					>
					<button
						class="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted"
						aria-label="Not about this part"
						onclick={() => (attached = null)}><X class="size-3" /></button
					>
				</div>
			{/if}
			<DictateTextarea
				bind:value={draft}
				rows={2}
				maxlength={4000}
				placeholder={attached ? 'What about it?' : 'What do you think? Ask anything about it'}
				aria-label="Talk about this preview"
				class="no-scrollbar min-h-12 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
						e.preventDefault();
						ask();
					}
				}}
			/>
			<div class="flex items-center gap-1 px-1.5 pb-1.5">
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors {pointing
						? 'bg-sea text-on-accent'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					aria-pressed={pointing}
					title="Click a part of the page to say which part you mean"
					onclick={() => (pointing = !pointing)}
					data-point
					><Crosshair class="size-3.5" aria-hidden="true" />{pointing
						? 'Pointing…'
						: 'Point'}</button
				>
				<button
					aria-label="Say it"
					disabled={(!draft.trim() && !attached) || c.asking}
					onclick={ask}
					class="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-30"
					><ArrowUp class="size-4" /></button
				>
			</div>
		</div>
	</div>

	<!-- The list that goes to Firstmate, as one message. -->
	<section class="border-t bg-card/60" aria-label="Your feedback" data-feedback-list>
		<button
			class="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left"
			aria-expanded={listOpen}
			onclick={() => (listOpen = !listOpen)}
		>
			<h3 class="font-sans text-sm font-medium">Your feedback</h3>
			<span class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
				>{c.list.length}</span
			>
			{#if c.list.length}<span class="text-xs text-muted-foreground">· not sent yet</span>{/if}
			<ChevronDown
				class="ml-auto size-4 text-muted-foreground transition-transform {listOpen
					? 'rotate-180'
					: ''}"
				aria-hidden="true"
			/>
		</button>
		{#if listOpen}
			<div class="no-scrollbar max-h-48 overflow-y-auto px-4">
				{#if c.list.length}
					<ol class="flex flex-col gap-1.5">
						{#each c.list as l, i (l.id)}
							<li class="group flex items-start gap-2 rounded-md border bg-background px-2 py-1">
								<span
									class="mt-0.5 w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
									>{i + 1}.</span
								>
								<div class="min-w-0 flex-1">
									<textarea
										value={l.text}
										rows="1"
										maxlength="500"
										aria-label="Feedback {i + 1}"
										oninput={(e) => previewHelpers.edit(task.id, l.id, e.currentTarget.value)}
										class="no-scrollbar block field-sizing-content w-full resize-none rounded bg-transparent text-sm leading-snug outline-none focus:bg-accent/40"
									></textarea>
									{#if l.points}<p class="text-xs text-muted-foreground">
											Points at {l.points.label}
										</p>{/if}
								</div>
								<button
									class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-60 group-hover:opacity-100 hover:bg-muted hover:text-foreground"
									aria-label="Remove from the list"
									onclick={() => previewHelpers.remove(task.id, l.id)}
									><X class="size-3.5" /></button
								>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-xs text-muted-foreground">
						Empty so far. Add what the helper suggests, or write your own below.
					</p>
				{/if}
				<form
					class="mt-1.5 flex items-center gap-1"
					onsubmit={(e) => {
						e.preventDefault();
						previewHelpers.addOwn(task.id, own);
						own = '';
					}}
				>
					<Plus class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<input
						bind:value={own}
						maxlength="500"
						placeholder="Add your own"
						aria-label="Add your own feedback"
						class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</form>
			</div>
		{/if}
		<div class="flex items-center gap-3 px-4 pt-2 pb-3">
			<button
				class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-sea px-3.5 text-sm font-medium whitespace-nowrap text-on-accent hover:bg-sea/90 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={!c.list.length || sending}
				onclick={send}
				data-send-batch
				><Send class="size-3.5" aria-hidden="true" />{sending
					? 'Sending…'
					: `Send to Firstmate${c.list.length ? ` (${c.list.length})` : ''}`}</button
			>
			<span class="text-xs leading-snug text-muted-foreground">One message, for this same task</span
			>
		</div>
	</section>
</section>
