<script lang="ts">
	import { LoaderCircle, Search, X } from '@lucide/svelte';
	import { firstmateChat } from '$lib/client/chat.svelte';
	import type { ChatSearchHit } from '$lib/types';

	/**
	 * Search across the whole chat archive (every Firstmate session Wheelhouse
	 * has kept, lib/server/chatarchive): the captain's messages and Firstmate's
	 * replies holding every word typed, newest first. Picking one shows it in the
	 * chat (`onReveal`), reading back through the archive as far as it needs.
	 */
	let {
		onReveal,
		onClose
	}: {
		onReveal: (hit: ChatSearchHit) => void;
		onClose: () => void;
	} = $props();

	let query = $state('');
	let hits = $state<ChatSearchHit[] | null>(null);
	let busy = $state(false);
	let failed = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	/** Answers to a query older than the one typed are ignored. */
	let asked = 0;

	$effect(() => input?.focus());

	$effect(() => {
		const q = query.trim();
		if (!q) {
			asked++;
			hits = null;
			failed = false;
			busy = false;
			return;
		}
		const n = ++asked;
		const timer = setTimeout(async () => {
			busy = true;
			const found = await firstmateChat.search(q);
			if (n !== asked) return;
			busy = false;
			failed = found === null;
			hits = found ?? [];
		}, 250);
		return () => clearTimeout(timer);
	});

	const when = (at: string) =>
		new Date(at).toLocaleString([], {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});

	/** The snippet split around each word searched for, to mark the matches. */
	function marked(text: string): { text: string; hit: boolean }[] {
		const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!terms.length) return [{ text, hit: false }];
		const re = new RegExp(
			`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
			'gi'
		);
		return text
			.split(re)
			.filter(Boolean)
			.map((piece) => ({ text: piece, hit: terms.includes(piece.toLowerCase()) }));
	}
</script>

<div class="border-b bg-panel/60 px-4 py-3 sm:px-6 lg:px-10" role="search" data-chat-search>
	<div class="flex items-center gap-2">
		<label class="flex h-9 flex-1 items-center gap-2 rounded-lg border bg-card px-3">
			<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<input
				bind:this={input}
				bind:value={query}
				class="min-w-0 flex-1 bg-transparent text-sm outline-none"
				placeholder="Search every conversation with Firstmate"
				aria-label="Search the chat history"
				onkeydown={(e) => {
					if (e.key === 'Escape') onClose();
				}}
			/>
			{#if busy}<LoaderCircle
					class="size-3.5 shrink-0 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>{/if}
		</label>
		<button
			class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			aria-label="Close search"
			onclick={onClose}><X class="size-4" /></button
		>
	</div>
	{#if failed}
		<p class="mt-2 text-xs text-danger" role="alert">
			The chat history could not be searched. Wheelhouse keeps it only when its state directory is
			outside the Firstmate home.
		</p>
	{:else if hits}
		<p class="mt-2 text-xs text-muted-foreground" aria-live="polite">
			{hits.length === 0
				? 'Nothing in the chat history matches.'
				: hits.length === 1
					? '1 message'
					: `${hits.length}${hits.length >= 50 ? '+' : ''} messages, newest first`}
		</p>
		{#if hits.length}
			<ul
				class="mt-2 no-scrollbar flex max-h-[45vh] flex-col overflow-y-auto rounded-lg border bg-card"
			>
				{#each hits as hit (hit.uuid)}
					<li class="border-b last:border-b-0">
						<button
							class="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted"
							onclick={() => onReveal(hit)}
						>
							<span class="text-xs text-muted-foreground"
								><span class="font-medium text-foreground"
									>{hit.who === 'captain' ? 'You' : 'Firstmate'}</span
								>
								· <time datetime={hit.at}>{when(hit.at)}</time></span
							>
							<span class="line-clamp-2 text-sm"
								>{#each marked(hit.snippet) as piece, i (i)}{#if piece.hit}<mark
											class="rounded-sm bg-sea/20 px-0.5 text-foreground">{piece.text}</mark
										>{:else}{piece.text}{/if}{/each}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
